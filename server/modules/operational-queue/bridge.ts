// Engagement-Center → call-list bridge (Batch 11c).
//
// When the ENGAGEMENT_TO_CALL_LIST_BRIDGE env flag is ON, a successful
// engagement-board assignment ALSO writes (or finds) the corresponding
// scheduler_assignments row so that:
//   - the Scheduler Portal's call list immediately includes the patient
//   - the Team Portal / SA Care Technician call list immediately includes
//     the patient
// without waiting for the next morning rebuild.
//
// When the flag is OFF (default), production behavior is exactly
// unchanged. The caller in engagementAssignmentBoard.ts only invokes
// the bridge under an explicit env-flag check (see route handler).
//
// Safety rules (per Batch 11c spec):
//   - Never throws to the caller. All errors are returned as a typed
//     outcome variant so the parent engagement-board assignment cannot
//     fail because of the bridge.
//   - Never creates a duplicate active scheduler_assignments row. The
//     partial unique index `uq_scheduler_assignments_active_per_patient_day`
//     on `(patient_screening_id, as_of_date) WHERE status = 'active'`
//     remains the source of truth; the bridge checks for an existing
//     active row before inserting.
//   - Never modifies an existing active row (even if the scheduler id
//     differs). The engagement-board assignment is the SOURCE OF TRUTH for
//     team-member assignment; the call list reflects a daily snapshot.
//     Conflict-guard semantics from the engagement-board route are
//     preserved by NOT touching an existing active row from the bridge.

import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  patientScreenings,
  schedulerAssignments,
  screeningBatches,
} from "@shared/schema";
import {
  isEngagementToCallListBridgeEnabled,
} from "./bridge-flag";

// Re-export so existing callers (bridge.ts users) still get the helper
// from this module; the flag itself lives in bridge-flag.ts (DB-free).
export { isEngagementToCallListBridgeEnabled };

export type EngagementToCallListBridgeInput = {
  // patient_screenings.id
  patientScreeningId: number;
  // outreach_schedulers.id (the engagement-board assignedTeamMemberId)
  schedulerId: number;
  // Optional free-form reason. Stored on scheduler_assignments.reason.
  reason?: string | null;
};

export type EngagementToCallListBridgeOutcome =
  | { kind: "disabled" }
  | {
      kind: "skipped";
      reason:
        | "no_patient"
        | "no_batch"
        | "no_schedule_date"
        | "internal_error";
      message?: string;
    }
  | { kind: "already_active"; schedulerAssignmentId: number }
  | { kind: "created"; schedulerAssignmentId: number };

/**
 * Bridge an engagement-board assignment into a scheduler_assignments row.
 *
 * Pre-check: if the flag is OFF, returns `{ kind: "disabled" }` without
 * touching the DB. Routes SHOULD ALSO check the flag before invoking
 * this helper so the dynamic import + this function call only happen
 * when the bridge is enabled — preserving "exactly-unchanged behaviour
 * with flag off" verbatim.
 *
 * Returns a discriminated outcome. Never throws to the caller; internal
 * errors map to `{ kind: "skipped", reason: "internal_error", message }`.
 */
export async function bridgeEngagementAssignmentToCallList(
  input: EngagementToCallListBridgeInput,
): Promise<EngagementToCallListBridgeOutcome> {
  if (!isEngagementToCallListBridgeEnabled()) {
    return { kind: "disabled" };
  }

  try {
    // 1. Resolve patient + facility + batch id.
    const [patient] = await db
      .select({
        id: patientScreenings.id,
        batchId: patientScreenings.batchId,
        facility: patientScreenings.facility,
      })
      .from(patientScreenings)
      .where(eq(patientScreenings.id, input.patientScreeningId))
      .limit(1);
    if (!patient) {
      return { kind: "skipped", reason: "no_patient" };
    }

    // 2. Resolve scheduleDate via the batch.
    if (patient.batchId === null || patient.batchId === undefined) {
      return { kind: "skipped", reason: "no_batch" };
    }
    const [batch] = await db
      .select({ scheduleDate: screeningBatches.scheduleDate })
      .from(screeningBatches)
      .where(eq(screeningBatches.id, patient.batchId))
      .limit(1);
    const scheduleDate = batch?.scheduleDate ?? null;
    if (!scheduleDate) {
      return { kind: "skipped", reason: "no_schedule_date" };
    }

    // 3. Check for an existing active scheduler_assignments row for
    //    this (patient, scheduleDate). The partial unique index
    //    `uq_scheduler_assignments_active_per_patient_day` enforces
    //    only-one-active anyway, but we want to RETURN the existing id
    //    rather than rely on a write that would conflict.
    const existing = await db
      .select({ id: schedulerAssignments.id })
      .from(schedulerAssignments)
      .where(
        and(
          eq(schedulerAssignments.patientScreeningId, input.patientScreeningId),
          eq(schedulerAssignments.asOfDate, scheduleDate),
          eq(schedulerAssignments.status, "active"),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      return {
        kind: "already_active",
        schedulerAssignmentId: existing[0].id,
      };
    }

    // 4. Insert. source = "manual" (the engagement-board assignment is
    //    an operator action). reason carries the bridge marker so
    //    downstream auditors can attribute the row to the bridge path.
    const reasonText =
      input.reason && input.reason.trim().length > 0
        ? `engagement_board_bridge: ${input.reason.trim()}`
        : "engagement_board_bridge";

    const [created] = await db
      .insert(schedulerAssignments)
      .values({
        patientScreeningId: input.patientScreeningId,
        schedulerId: input.schedulerId,
        asOfDate: scheduleDate,
        source: "manual",
        reason: reasonText,
        status: "active",
      })
      .returning({ id: schedulerAssignments.id });

    return { kind: "created", schedulerAssignmentId: created.id };
  } catch (err) {
    // Never throw to the parent engagement-board assignment.
    return {
      kind: "skipped",
      reason: "internal_error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
