// Call-result canonicalization — PHI-safe parity fixture (Batch B).
//
// Data-only fixture. NOT wired to any runtime path. Pins the
// expected side-effect envelope for every documented call-result
// outcome so the future canonical recordCallResult service
// (per engagement-call-list-canonicalization-contract.md §9)
// cannot silently drop a side effect on adoption.
//
// SCOPE / SAFETY
//   - No DB, no app boot, no network, no PHI.
//   - No runtime call-route changes.
//   - No UI change.
//   - The fixture pins INTENT (which side effect fires for each
//     outcome) — the future canonical service must satisfy these,
//     and the parity test (Bundle 56-style future PR) will exercise
//     the canonical service against this envelope.

/**
 * All call-result outcomes the canonical service must handle.
 * Mirrors `CALL_RESULT_TRIAGE_MAP` in
 * server/routes/executionCases.ts (outcome → triage routing) and
 * `deriveAppointmentStatus` in
 * server/routes/outreach.ts:37-59 (outcome → appointmentStatus).
 */
export const CALL_RESULT_OUTCOMES_FIXTURE = [
  "scheduled",
  "callback",
  "no_answer",
  "voicemail",
  "wrong_number",
  "declined",
  "needs_records",
  "insurance_prior_auth_issue",
  "manager_review",
  "facility_specific_issue",
] as const;
export type CallResultOutcomeFixture =
  (typeof CALL_RESULT_OUTCOMES_FIXTURE)[number];

/**
 * Per-outcome expected side-effect envelope. Every field here MUST
 * be exercised by the future canonical recordCallResult service.
 *
 * Notes:
 *   - `outreachCallCreated` — every call MUST insert an
 *     `outreach_calls` row, regardless of outcome.
 *   - `appointmentStatus` — what the call result writes to
 *     `patient_screenings.appointmentStatus` (derived).
 *   - `journeyEventType` — what the call result appends to
 *     `patient_journey_events`.
 *   - `executionCaseEngagementStatus` — the engagementStatus
 *     transition or null if no transition.
 *   - `executionCaseNextActionAt` — whether `nextActionAt` must be
 *     set to a future time (callback-style outcomes).
 *   - `assignmentCompleted` — whether `scheduler_assignments` must
 *     be marked completed (terminal outcomes).
 *   - `followUpTaskRequired` — whether a plexus_tasks row must be
 *     created (outcomes in CALL_RESULTS_NEEDING_TASK).
 *   - `triageCaseRequired` — whether a scheduling_triage_cases
 *     row must be opened.
 *   - `terminal` — terminal-outcome flag (closes the assignment).
 */
export type CallResultSideEffectEnvelopeFixture = {
  outcome: CallResultOutcomeFixture;
  outreachCallCreated: boolean;
  appointmentStatus: string;
  journeyEventType: "call_result_logged";
  executionCaseEngagementStatus:
    | "contacted"
    | "in_progress"
    | "not_reached"
    | "needs_followup"
    | null;
  executionCaseNextActionAtRequired: boolean;
  assignmentCompleted: boolean;
  followUpTaskRequired: boolean;
  triageCaseRequired: boolean;
  terminal: boolean;
};

/**
 * Canonical envelope per outcome.
 *
 * The values pin the expected side effects derived from the audit
 * findings of:
 *   - server/routes/outreach.ts:37-59, 222-229
 *     (deriveAppointmentStatus + TERMINAL set + assignment
 *      completion)
 *   - server/routes/executionCases.ts:65-86, 264-350
 *     (CALL_RESULT_TRIAGE_MAP + CALL_RESULTS_NEEDING_TASK +
 *      engagementStatus transitions)
 *   - server/modules/journey-events/contracts.ts:21-37
 *     ('call_result_logged' canonical event type)
 */
export const CALL_RESULT_PARITY_FIXTURE: ReadonlyArray<CallResultSideEffectEnvelopeFixture> = [
  {
    outcome: "scheduled",
    outreachCallCreated: true,
    appointmentStatus: "scheduled",
    journeyEventType: "call_result_logged",
    executionCaseEngagementStatus: "contacted",
    executionCaseNextActionAtRequired: false,
    assignmentCompleted: true,
    followUpTaskRequired: false,
    triageCaseRequired: false,
    terminal: true,
  },
  {
    outcome: "callback",
    outreachCallCreated: true,
    appointmentStatus: "callback",
    journeyEventType: "call_result_logged",
    executionCaseEngagementStatus: "needs_followup",
    executionCaseNextActionAtRequired: true,
    assignmentCompleted: false,
    followUpTaskRequired: false,
    triageCaseRequired: true,
    terminal: false,
  },
  {
    outcome: "no_answer",
    outreachCallCreated: true,
    appointmentStatus: "no_answer",
    journeyEventType: "call_result_logged",
    executionCaseEngagementStatus: "not_reached",
    executionCaseNextActionAtRequired: true,
    assignmentCompleted: false,
    followUpTaskRequired: false,
    triageCaseRequired: true,
    terminal: false,
  },
  {
    outcome: "voicemail",
    outreachCallCreated: true,
    appointmentStatus: "no_answer",
    journeyEventType: "call_result_logged",
    executionCaseEngagementStatus: "not_reached",
    executionCaseNextActionAtRequired: true,
    assignmentCompleted: false,
    followUpTaskRequired: false,
    triageCaseRequired: true,
    terminal: false,
  },
  {
    outcome: "wrong_number",
    outreachCallCreated: true,
    appointmentStatus: "declined",
    journeyEventType: "call_result_logged",
    executionCaseEngagementStatus: "needs_followup",
    executionCaseNextActionAtRequired: false,
    assignmentCompleted: false,
    followUpTaskRequired: false,
    triageCaseRequired: true,
    terminal: false,
  },
  {
    outcome: "declined",
    outreachCallCreated: true,
    appointmentStatus: "declined",
    journeyEventType: "call_result_logged",
    executionCaseEngagementStatus: "contacted",
    executionCaseNextActionAtRequired: false,
    assignmentCompleted: true,
    followUpTaskRequired: false,
    triageCaseRequired: false,
    terminal: true,
  },
  {
    outcome: "needs_records",
    outreachCallCreated: true,
    appointmentStatus: "in_progress",
    journeyEventType: "call_result_logged",
    executionCaseEngagementStatus: "in_progress",
    executionCaseNextActionAtRequired: false,
    assignmentCompleted: false,
    followUpTaskRequired: true,
    triageCaseRequired: false,
    terminal: false,
  },
  {
    outcome: "insurance_prior_auth_issue",
    outreachCallCreated: true,
    appointmentStatus: "in_progress",
    journeyEventType: "call_result_logged",
    executionCaseEngagementStatus: "in_progress",
    executionCaseNextActionAtRequired: false,
    assignmentCompleted: false,
    followUpTaskRequired: true,
    triageCaseRequired: false,
    terminal: false,
  },
  {
    outcome: "manager_review",
    outreachCallCreated: true,
    appointmentStatus: "in_progress",
    journeyEventType: "call_result_logged",
    executionCaseEngagementStatus: "needs_followup",
    executionCaseNextActionAtRequired: false,
    assignmentCompleted: false,
    followUpTaskRequired: true,
    triageCaseRequired: false,
    terminal: false,
  },
  {
    outcome: "facility_specific_issue",
    outreachCallCreated: true,
    appointmentStatus: "in_progress",
    journeyEventType: "call_result_logged",
    executionCaseEngagementStatus: "in_progress",
    executionCaseNextActionAtRequired: false,
    assignmentCompleted: false,
    followUpTaskRequired: true,
    triageCaseRequired: false,
    terminal: false,
  },
];

/**
 * Import-time sanity checks.
 */
{
  if (
    CALL_RESULT_PARITY_FIXTURE.length !==
    CALL_RESULT_OUTCOMES_FIXTURE.length
  ) {
    throw new Error(
      `[call-result parity fixture] expected ${CALL_RESULT_OUTCOMES_FIXTURE.length} envelopes, ` +
        `got ${CALL_RESULT_PARITY_FIXTURE.length}`,
    );
  }
  const outcomesSeen = new Set<string>();
  for (const env of CALL_RESULT_PARITY_FIXTURE) {
    if (outcomesSeen.has(env.outcome)) {
      throw new Error(
        `[call-result parity fixture] duplicate outcome "${env.outcome}"`,
      );
    }
    outcomesSeen.add(env.outcome);
    // Every entry must carry outreachCallCreated=true (audit row of
    // the call itself).
    if (!env.outreachCallCreated) {
      throw new Error(
        `[call-result parity fixture] outcome "${env.outcome}" missing outreachCallCreated`,
      );
    }
    // Every entry must use the canonical journey event type.
    if (env.journeyEventType !== "call_result_logged") {
      throw new Error(
        `[call-result parity fixture] outcome "${env.outcome}" has wrong journeyEventType`,
      );
    }
    // Terminal outcomes MUST mark assignmentCompleted.
    if (env.terminal && !env.assignmentCompleted) {
      throw new Error(
        `[call-result parity fixture] terminal outcome "${env.outcome}" must mark assignmentCompleted`,
      );
    }
    // Non-terminal outcomes MUST NOT mark assignmentCompleted.
    if (!env.terminal && env.assignmentCompleted) {
      throw new Error(
        `[call-result parity fixture] non-terminal outcome "${env.outcome}" must not mark assignmentCompleted`,
      );
    }
  }
}
