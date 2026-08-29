// Deactivated-user recovery (Phase 3E / decision K19).
//
// When a team member is deactivated we must NOT leave their active call cases
// stranded until the next absenceWatcher pass. This releases + redistributes
// their owned cases canonically (the SAME spine as PTO/absence — 3A), lets the
// distribution engine place what it can, and tags anything that could not be
// placed with a structured `deactivated_owner` needs-coverage category so the
// manager sees exactly why.

import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { patientExecutionCases } from "@shared/schema/executionCase";
import { storage } from "../../storage";
import { releaseAndRedistributeCanonical } from "./absenceRedistribution";
import { needsCoverageRepository } from "../../repositories/needsCoverage.repo";
import { callHandoffsRepository } from "../../repositories/callHandoffs.repo";
import { engagementCallSettingsRepository } from "../../repositories/engagementCallSettings.repo";
import { appendJourneyEvent } from "../journey/appendJourneyEvent";
import { resolveManagersOfUser } from "../teams/managerScope";
import { notifyManagerException, clearHandoffNotifications } from "../notifications/notificationService";

export interface DeactivatedUserRecoveryResult {
  userId: string;
  schedulerIds: number[];
  released: number;
  redistributed: number;
  unplaced: number;
  // Phase 6C — broader work-type recovery beyond calls.
  teamTasksReleased: number;   // open TEAM tasks returned to the pool
  personalTasksFlagged: number; // open team-less tasks surfaced to managers
  handoffsCancelled: number;    // inbound open handoffs cancelled
}

/**
 * Release + canonically redistribute every active case owned by any roster
 * member linked to `userId`. Cases that cannot be re-placed are recorded in
 * NEEDS COVERAGE with category `deactivated_owner`. Safe to call from the
 * deactivate route (does not depend on absenceWatcher).
 */
export async function recoverDeactivatedUser(
  userId: string,
  actorUserId: string | null = null,
): Promise<DeactivatedUserRecoveryResult> {
  const schedulers = (await storage.getOutreachSchedulers()).filter(
    (s) => s.userId === userId,
  );
  const schedulerIds = schedulers.map((s) => s.id);

  const result: DeactivatedUserRecoveryResult = {
    userId,
    schedulerIds,
    released: 0,
    redistributed: 0,
    unplaced: 0,
    teamTasksReleased: 0,
    personalTasksFlagged: 0,
    handoffsCancelled: 0,
  };
  // NOTE: call-ownership recovery below is gated on the user having roster
  // (scheduler) rows. Task + handoff recovery is NOT — a deactivated user may
  // own tasks / have inbound handoffs without being a call scheduler — so those
  // run unconditionally (after this block).

  // Mark the deactivated member's call settings inactive FIRST so the
  // canonical distribution engine (which reads engagement_call_settings.active)
  // excludes them as a redistribution target — otherwise the greedy planner
  // could hand a released case straight back to the deactivated member. Upsert
  // so a member with no settings row still gets an explicit active=false
  // (the gather logic defaults a MISSING row to active=true).
  for (const sid of schedulerIds) {
    await engagementCallSettingsRepository.upsert(sid, { active: false });
  }

  for (const sched of schedulers) {
    // Snapshot the cases this member owns BEFORE release so we can identify
    // which ones remain unassigned afterwards (→ deactivated_owner coverage).
    const ownedBefore = await db
      .select({
        id: patientExecutionCases.id,
        patientScreeningId: patientExecutionCases.patientScreeningId,
        facilityId: patientExecutionCases.facilityId,
      })
      .from(patientExecutionCases)
      .where(
        and(
          eq(patientExecutionCases.assignedTeamMemberId, sched.id),
          eq(patientExecutionCases.lifecycleStatus, "active"),
        ),
      );

    const summary = await releaseAndRedistributeCanonical(
      sched.id,
      `deactivated_user:${userId}`,
      actorUserId,
    );
    result.released += summary.released;
    result.redistributed += summary.redistributed;

    // Any of this member's released cases still unassigned → deactivated_owner.
    for (const c of ownedBefore) {
      const [row] = await db
        .select({ owner: patientExecutionCases.assignedTeamMemberId })
        .from(patientExecutionCases)
        .where(eq(patientExecutionCases.id, c.id))
        .limit(1);
      if (row && row.owner == null) {
        result.unplaced += 1;
        await needsCoverageRepository.upsert({
          executionCaseId: c.id,
          patientScreeningId: c.patientScreeningId ?? null,
          facilityId: c.facilityId ?? null,
          category: "deactivated_owner",
          reason: `Owner deactivated (user ${userId}); no eligible team member available to take over.`,
          source: "system",
        });
      }
    }
  }

  // ── TASKS (Phase 6C, req 11) ──
  // Open TEAM tasks go back to their team pool (any active member can claim
  // them). Open PERSONAL (team-less) tasks stay assigned but are surfaced to
  // the user's manager(s) so they can reassign — we never delete work.
  let openTasks: Awaited<ReturnType<typeof storage.getOpenTasksByAssignee>> = [];
  try {
    openTasks = await storage.getOpenTasksByAssignee(userId);
    const released = await storage.releaseTeamTasksForUser(userId);
    result.teamTasksReleased = released.length;
    result.personalTasksFlagged = openTasks.filter((t) => t.assignedTeamId == null).length;
  } catch (err) {
    console.error(
      "[deactivated-user-recovery] task release failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }

  // ── HANDOFFS (Phase 6C, req 11) ──
  // Inbound OPEN handoffs to the deactivated user are no longer actionable by
  // them — cancel (kept for audit) and clear their stale notifications.
  let cancelledHandoffs: Awaited<ReturnType<typeof callHandoffsRepository.cancelOpenForRecipient>> = [];
  try {
    cancelledHandoffs = await callHandoffsRepository.cancelOpenForRecipient(
      userId,
      `recipient_deactivated:${userId}`,
      actorUserId,
    );
    result.handoffsCancelled = cancelledHandoffs.length;
    for (const h of cancelledHandoffs) {
      await clearHandoffNotifications(userId, h.id);
    }
  } catch (err) {
    console.error(
      "[deactivated-user-recovery] handoff cancel failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }

  // ── MESSAGING access (Phase 6C, req 11/16) ──
  // Revoke active conversation memberships (defense-in-depth beyond session
  // gating). History is preserved; the user simply cannot send/read as an
  // active member anymore.
  try {
    const { deactivateAllConversationMembershipsForUser } = await import(
      "../messaging/teamChannelService"
    );
    await deactivateAllConversationMembershipsForUser(userId);
  } catch (err) {
    console.error(
      "[deactivated-user-recovery] messaging membership revoke failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }

  // ── Notify the user's manager(s) (Phase 6C) ──
  // One consolidated HIGH-signal notification per manager summarizing the work
  // released so they can pick up personal tasks / re-place cancelled handoffs.
  try {
    const managerIds = await resolveManagersOfUser(userId);
    const deactivatedUser = await storage.getUser(userId);
    const uname = deactivatedUser?.username ?? userId;
    if (
      managerIds.length > 0 &&
      (result.unplaced > 0 || result.personalTasksFlagged > 0 || result.handoffsCancelled > 0 || result.teamTasksReleased > 0)
    ) {
      const parts: string[] = [];
      if (result.released > 0) parts.push(`${result.released} call(s) released`);
      if (result.unplaced > 0) parts.push(`${result.unplaced} to needs-coverage`);
      if (result.teamTasksReleased > 0) parts.push(`${result.teamTasksReleased} team task(s) returned to pool`);
      if (result.personalTasksFlagged > 0) parts.push(`${result.personalTasksFlagged} personal task(s) need reassignment`);
      if (result.handoffsCancelled > 0) parts.push(`${result.handoffsCancelled} inbound handoff(s) cancelled`);
      for (const mgrId of managerIds) {
        await notifyManagerException({
          recipientUserId: mgrId,
          type: "user_deactivated_work_released",
          title: `Work released — ${uname} was deactivated`,
          shortBody: parts.join("; "),
          dedupeKey: `deactivated_work:${userId}`,
          metadata: {
            deactivatedUserId: userId,
            released: result.released,
            unplaced: result.unplaced,
            teamTasksReleased: result.teamTasksReleased,
            personalTasksFlagged: result.personalTasksFlagged,
            handoffsCancelled: result.handoffsCancelled,
          },
        });
      }
    }
  } catch (err) {
    console.error(
      "[deactivated-user-recovery] manager notification failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }

  // Audit the recovery at the account level (PHI-safe — no patient identity).
  try {
    await appendJourneyEvent({
      patientName: "n/a",
      eventType: "engagement_assignment_changed",
      eventSource: "deactivated_user_recovery",
      actorUserId: actorUserId ?? undefined,
      summary: `Deactivated-user recovery: released ${result.released}, redistributed ${result.redistributed}, ${result.unplaced} to needs-coverage; ${result.teamTasksReleased} team tasks to pool, ${result.personalTasksFlagged} personal tasks flagged, ${result.handoffsCancelled} handoffs cancelled.`,
      metadata: {
        deactivatedUserId: userId,
        schedulerIds,
        released: result.released,
        redistributed: result.redistributed,
        unplaced: result.unplaced,
        teamTasksReleased: result.teamTasksReleased,
        personalTasksFlagged: result.personalTasksFlagged,
        handoffsCancelled: result.handoffsCancelled,
      },
    });
  } catch {
    // Best-effort audit.
  }

  return result;
}
