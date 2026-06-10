// recordCallResult engagement-center preview flag + parity helper
// (Batch H Step 2).
//
// DEFAULT: OFF. When OFF the existing route behaves unchanged.
//
// When the flag is ON, the existing POST /api/engagement-center/call-result
// handler additionally runs the canonical recordCallResult planner in
// preview mode and logs a single PHI-safe parity line so operators can
// audit whether the canonical service would have produced the same
// intended side effects. The route's actual writes are unchanged.
//
// PURITY CONTRACT
//   - Pure env-accessor for the flag (no DB / no Express).
//   - The parity helper imports the dormant recordCallResult planner,
//     calls it (no I/O), compares the planner envelope to the route's
//     observed side effects, and emits ONE structured line to
//     console.info containing ONLY non-PHI labels (outcome, surface,
//     boolean parity flags). Never throws. Never mutates request state.
//
// HARD-STOPS
//   - No response shape change.
//   - No new side effects.
//   - No blocking behavior — preview is best-effort.
//   - PHI must NEVER appear in the parity log. Inputs to the helper
//     are filtered down to the planner's non-PHI shape at the caller.
//
// REFERENCED CONTRACTS
//   - docs/architecture/call-list-runtime-implementation-plan.md §2
//     (this PR — engagement-center preview path).
//   - tests/fixtures/callResultCanonicalization.fixture.ts (Batch B).

import {
  recordCallResult,
  type CallResultOutcome,
  type RecordCallResultOutcome,
  CALL_RESULT_OUTCOMES,
} from "./recordCallResult";

const FLAG_ENV = "USE_RECORD_CALL_RESULT_ENGAGEMENT_PREVIEW";

/**
 * Truthy values: `"1"`, `"true"`, `"yes"`. Anything else (including
 * unset) disables the preview. Mirrors the Bundle 14 / Batch I flag
 * accessor pattern.
 */
export function isRecordCallResultEngagementPreviewEnabled(): boolean {
  const v = process.env[FLAG_ENV];
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Subset of the route's observed side effects we can compare against
 * the planner envelope WITHOUT pulling in PHI. All booleans / labels.
 */
export type EngagementCallResultObservedEnvelope = {
  outcome: string;
  routeAppointmentStatus?: string | null;
  routeEngagementStatusTransition?: string | null;
  routeAssignmentCompleted?: boolean;
  routeFollowUpTaskCreated?: boolean;
  routeTriageCaseUpserted?: boolean;
  routeNextActionAtSet?: boolean;
};

function isCanonicalOutcome(o: string): o is CallResultOutcome {
  return (CALL_RESULT_OUTCOMES as ReadonlyArray<string>).includes(o);
}

/**
 * Run the canonical planner in preview mode and emit ONE PHI-safe
 * parity line. Never throws.
 *
 * NOTE: This function is intentionally synchronous and pure
 * (no I/O). Callers must guard it with
 * `isRecordCallResultEngagementPreviewEnabled()`.
 */
export function runEngagementCallResultPreview(
  input: {
    patientScreeningId: string | null;
    outcome: string;
    callbackAt?: string | null;
  },
  observed: EngagementCallResultObservedEnvelope,
): void {
  try {
    if (input.patientScreeningId == null || input.patientScreeningId === "") {
      return;
    }
    if (!isCanonicalOutcome(input.outcome)) {
      // Outcome is outside the canonical set the planner knows
      // (e.g. reschedule, cancelled, no_show). Skip silently — those
      // outcomes are intentionally out of scope for the canonical
      // service until a later batch extends the fixture.
      return;
    }

    const planned: RecordCallResultOutcome = recordCallResult({
      patientScreeningId: input.patientScreeningId,
      outcome: input.outcome,
      sourceSurface: "engagement_center_route",
      callbackAt: input.callbackAt ?? null,
    });

    const mismatches: string[] = [];
    if (
      observed.routeAssignmentCompleted !== undefined &&
      observed.routeAssignmentCompleted !== planned.assignmentCompleted
    ) {
      mismatches.push("assignmentCompleted");
    }
    if (
      observed.routeFollowUpTaskCreated !== undefined &&
      observed.routeFollowUpTaskCreated !== planned.followUpTaskRequired
    ) {
      mismatches.push("followUpTaskRequired");
    }
    if (
      observed.routeTriageCaseUpserted !== undefined &&
      observed.routeTriageCaseUpserted !== planned.triageCaseRequired
    ) {
      mismatches.push("triageCaseRequired");
    }
    if (
      observed.routeNextActionAtSet !== undefined &&
      observed.routeNextActionAtSet !== (planned.executionCaseNextActionAt !== null)
    ) {
      mismatches.push("executionCaseNextActionAt");
    }
    if (
      observed.routeAppointmentStatus !== undefined &&
      observed.routeAppointmentStatus !== null &&
      observed.routeAppointmentStatus !== planned.appointmentStatus
    ) {
      mismatches.push("appointmentStatus");
    }

    const parity = mismatches.length === 0 ? "match" : `mismatch:${mismatches.join(",")}`;

    // PHI-safe single-line parity report. Contains only outcome label
    // (not PHI), source-surface label, boolean parity flags, and the
    // parity verdict. Patient identifiers (name, dob, screeningId,
    // executionCaseId) are NOT included.
    console.info(
      "[record-call-result-preview] " +
        `surface=engagement_center_route outcome=${planned.outcome} ` +
        `plannedAssignmentCompleted=${planned.assignmentCompleted} ` +
        `plannedFollowUpTaskRequired=${planned.followUpTaskRequired} ` +
        `plannedTriageCaseRequired=${planned.triageCaseRequired} ` +
        `plannedAppointmentStatus=${planned.appointmentStatus} ` +
        `plannedEngagementStatus=${planned.executionCaseEngagementStatus ?? "null"} ` +
        `parity=${parity}`,
    );
  } catch (_err) {
    // Preview is best-effort. Never propagate to the route.
  }
}
