// recordCallResult outreach-call preview flag + parity helper
// (Batch H Step 3).
//
// DEFAULT: OFF. When OFF the existing route behaves unchanged.
//
// When the flag is ON, the existing POST /api/outreach/calls handler
// additionally runs the canonical recordCallResult planner in preview
// mode and logs a single PHI-safe parity line so operators can audit
// whether the canonical service would have produced the same intended
// side effects. The route's actual writes are unchanged.
//
// PURITY CONTRACT (mirrors recordCallResultEngagementPreviewFlag.ts)
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
//   - PHI must NEVER appear in the parity log. Inputs are filtered to
//     the planner's non-PHI shape at the caller.
//   - Outcomes outside the canonical 10-outcome set the planner knows
//     are silently skipped (outreach has a much broader outcome
//     vocabulary — wants_more_info, language_barrier, mailbox_full,
//     hung_up, etc.). Until the canonical fixture extends, we do not
//     log mismatch noise for them.

import {
  recordCallResult,
  type CallResultOutcome,
  type RecordCallResultOutcome,
  CALL_RESULT_OUTCOMES,
} from "./recordCallResult";

const FLAG_ENV = "USE_RECORD_CALL_RESULT_OUTREACH_PREVIEW";

/**
 * Truthy values: `"1"`, `"true"`, `"yes"`. Anything else (including
 * unset) disables the preview. Mirrors the Bundle 14 / Batch I /
 * Step 2 flag accessor pattern.
 */
export function isRecordCallResultOutreachPreviewEnabled(): boolean {
  const v = process.env[FLAG_ENV];
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Subset of the outreach route's observed side effects we can
 * compare against the planner envelope WITHOUT pulling in PHI. All
 * booleans / labels.
 */
export type OutreachCallResultObservedEnvelope = {
  outcome: string;
  routeAppointmentStatus?: string | null;
  routeAssignmentCompleted?: boolean;
  routeFollowUpTaskCreated?: boolean;
  routeTriageCaseUpserted?: boolean;
  routeJourneyEventAppended?: boolean;
};

function isCanonicalOutcome(o: string): o is CallResultOutcome {
  return (CALL_RESULT_OUTCOMES as ReadonlyArray<string>).includes(o);
}

/**
 * Run the canonical planner in preview mode and emit ONE PHI-safe
 * parity line. Never throws.
 *
 * Caller must guard with
 * `isRecordCallResultOutreachPreviewEnabled()`.
 */
export function runOutreachCallResultPreview(
  input: {
    patientScreeningId: string | null;
    outcome: string;
    callbackAt?: string | null;
  },
  observed: OutreachCallResultObservedEnvelope,
): void {
  try {
    if (input.patientScreeningId == null || input.patientScreeningId === "") {
      return;
    }
    if (!isCanonicalOutcome(input.outcome)) {
      // Outreach outcomes that aren't yet in the canonical 10-outcome
      // fixture (wants_more_info, language_barrier, mailbox_full,
      // hung_up, disconnected, busy, reached, refused_dnc, moved,
      // deceased, not_interested, will_think_about_it) are skipped
      // silently. They become canonical-fixture work in a later batch.
      return;
    }

    const planned: RecordCallResultOutcome = recordCallResult({
      patientScreeningId: input.patientScreeningId,
      outcome: input.outcome,
      sourceSurface: "outreach_call_route",
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
      observed.routeJourneyEventAppended !== undefined &&
      // The canonical planner ALWAYS emits a journeyEventType, so an
      // observed=false here is a real mismatch the route would have
      // to resolve by appending the journey event.
      observed.routeJourneyEventAppended === false
    ) {
      mismatches.push("journeyEventAppended");
    }
    if (
      observed.routeAppointmentStatus !== undefined &&
      observed.routeAppointmentStatus !== null &&
      observed.routeAppointmentStatus !== planned.appointmentStatus
    ) {
      mismatches.push("appointmentStatus");
    }

    const parity = mismatches.length === 0 ? "match" : `mismatch:${mismatches.join(",")}`;

    // PHI-safe single-line parity report. Only outcome label, source-
    // surface label, boolean parity flags, and parity verdict. Patient
    // identifiers (name, dob, screeningId, executionCaseId) are NOT
    // included.
    console.info(
      "[record-call-result-preview] " +
        `surface=outreach_call_route outcome=${planned.outcome} ` +
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
