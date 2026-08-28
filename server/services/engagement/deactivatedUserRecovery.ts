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
import { engagementCallSettingsRepository } from "../../repositories/engagementCallSettings.repo";
import { appendJourneyEvent } from "../journey/appendJourneyEvent";

export interface DeactivatedUserRecoveryResult {
  userId: string;
  schedulerIds: number[];
  released: number;
  redistributed: number;
  unplaced: number;
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
  };
  if (schedulerIds.length === 0) return result;

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

  // Audit the recovery at the account level (PHI-safe — no patient identity).
  try {
    await appendJourneyEvent({
      patientName: "n/a",
      eventType: "engagement_assignment_changed",
      eventSource: "deactivated_user_recovery",
      actorUserId: actorUserId ?? undefined,
      summary: `Deactivated-user recovery: released ${result.released}, redistributed ${result.redistributed}, ${result.unplaced} to needs-coverage.`,
      metadata: {
        deactivatedUserId: userId,
        schedulerIds,
        released: result.released,
        redistributed: result.redistributed,
        unplaced: result.unplaced,
      },
    });
  } catch {
    // Best-effort audit.
  }

  return result;
}
