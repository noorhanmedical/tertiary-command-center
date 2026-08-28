// Canonical absence redistribution — operates on patient_execution_cases.
//
// When a team member becomes absent (detected by absenceWatcher or triggered
// by admin action), this service:
//   1. NULLs assignedTeamMemberId on the absent member's active cases
//   2. Emits journey events recording the release
//   3. Runs applyDistribution() to reassign those now-unassigned cases
//
// This is the CANONICAL path — it modifies the SAME ownership field that
// the Engagement Center, Team Portal PCS queue, and OSP all read from.
// The legacy releaseAndRedistribute() in callListEngine.ts is superseded.

import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { patientExecutionCases } from "@shared/schema/executionCase";
import { appendJourneyEvent } from "../journey/appendJourneyEvent";
import { applyDistribution } from "./distributionService";

export type CanonicalRedistributionResult = {
  schedulerId: number;
  released: number;
  redistributed: number;
  unplaced: number;
  reason: string;
};

/**
 * Release all active execution cases currently assigned to `schedulerId`,
 * then run the canonical distribution engine to reassign them.
 *
 * This is safe to call from:
 *   - absenceWatcher auto-execute
 *   - admin approve-absence route
 *   - admin manual redistribute
 */
export async function releaseAndRedistributeCanonical(
  schedulerId: number,
  reason: string,
  actorUserId: string | null = null,
): Promise<CanonicalRedistributionResult> {
  // 1. Find all active execution cases assigned to this team member.
  const activeCases = await db.select({
    id: patientExecutionCases.id,
    patientName: patientExecutionCases.patientName,
    patientDob: patientExecutionCases.patientDob,
    patientScreeningId: patientExecutionCases.patientScreeningId,
  }).from(patientExecutionCases).where(
    and(
      eq(patientExecutionCases.assignedTeamMemberId, schedulerId),
      eq(patientExecutionCases.lifecycleStatus, "active"),
    ),
  );

  if (activeCases.length === 0) {
    return { schedulerId, released: 0, redistributed: 0, unplaced: 0, reason };
  }

  // 2. NULL out assignedTeamMemberId on all those cases (release).
  const now = new Date();
  await db.update(patientExecutionCases).set({
    assignedTeamMemberId: null,
    assignedRole: null,
    engagementStatus: "new",
    updatedAt: now,
  }).where(
    and(
      eq(patientExecutionCases.assignedTeamMemberId, schedulerId),
      eq(patientExecutionCases.lifecycleStatus, "active"),
    ),
  );

  // 3. Emit journey events for each released case.
  for (const c of activeCases) {
    try {
      await appendJourneyEvent({
        patientScreeningId: c.patientScreeningId,
        executionCaseId: c.id,
        actorUserId,
        patientName: c.patientName,
        patientDob: c.patientDob,
        eventType: "engagement_assignment_changed",
        eventSource: "absence_redistribution",
        summary: `Released from absent team member (scheduler #${schedulerId}). Reason: ${reason}`,
        metadata: {
          previousSchedulerId: schedulerId,
          reason,
          action: "release",
        },
      });
    } catch {
      // Best-effort audit — never blocks the operational flow.
    }
  }

  // 4. Run the canonical distribution engine to reassign the now-unassigned cases.
  //    applyDistribution operates over ALL currently-unassigned eligible cases,
  //    not only the ones we just released, so we cannot infer this call's
  //    outcome from distResult.applied.length alone. Instead we measure the
  //    fate of *our* released case ids specifically.
  const releasedIds = activeCases.map((c) => c.id);
  const distResult = await applyDistribution(actorUserId, "scheduler");
  const appliedReleasedIds = new Set(
    distResult.applied
      .filter((a) => releasedIds.includes(a.executionCaseId))
      .map((a) => a.executionCaseId),
  );

  // A released case counts as redistributed only if it landed on a DIFFERENT
  // team member. If the greedy planner handed it back to the same (still
  // eligible) member, that is neither a redistribution nor an unplaced case —
  // it simply stayed put, so we exclude it from both tallies.
  const stillOwnedByOriginal = await db.select({ id: patientExecutionCases.id })
    .from(patientExecutionCases)
    .where(
      and(
        eq(patientExecutionCases.assignedTeamMemberId, schedulerId),
        eq(patientExecutionCases.lifecycleStatus, "active"),
      ),
    );
  const retainedIds = new Set(
    stillOwnedByOriginal.map((r) => r.id).filter((id) => releasedIds.includes(id)),
  );

  const redistributed = [...appliedReleasedIds].filter((id) => !retainedIds.has(id)).length;
  const unplaced = releasedIds.filter(
    (id) => !appliedReleasedIds.has(id) && !retainedIds.has(id),
  ).length;

  return {
    schedulerId,
    released: activeCases.length,
    redistributed,
    unplaced,
    reason,
  };
}
