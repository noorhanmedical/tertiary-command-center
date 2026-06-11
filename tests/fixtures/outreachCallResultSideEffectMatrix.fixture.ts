// Outreach call-result side-effect matrix — fixture (Batch 16).
//
// Pins the side effects the outreach surface owns today:
//   - outreachCallCreated (always)
//   - appointmentStatusUpdated (always — via deriveAppointmentStatus)
//   - terminal scheduler_assignments completion (terminal outcomes only)
//   - ensureCanonicalSpineForScreening (fire-and-forget, always)
// Engagement-only steps (journey event, exec-case update, triage,
// task) are explicitly held at false on the outreach surface until
// Ali approves intentional mapping.
//
// Data-only fixture. No PHI.

export type OutreachSideEffectMatrixEntry = {
  outcome: string;
  outreachCallCreated: true;
  appointmentStatus: "scheduled" | "callback" | "declined" | "no_answer" | "pending";
  /**
   * Whether the outreach route's local TERMINAL set marks the
   * scheduler-assignment as completed for this outcome. TERMINAL =
   * {scheduled, completed, declined, dnc, do_not_contact, deceased,
   * cancelled} (note: the route's TERMINAL set is broader than the
   * planner's terminal flag because outreach also accepts non-
   * canonical outcomes).
   */
  outreachRouteTerminalCompletion: boolean;
  /** Fire-and-forget canonical-spine sync — always invoked. */
  canonicalSpineSyncInvoked: true;
  /** Engagement-owned side effects intentionally held at false. */
  journeyEventAppendedOnOutreach: false;
  executionCaseUpdatedOnOutreach: false;
  triageCaseUpsertedOnOutreach: false;
  followUpTaskCreatedOnOutreach: false;
};

export const OUTREACH_CALL_RESULT_SIDE_EFFECT_MATRIX: ReadonlyArray<OutreachSideEffectMatrixEntry> = [
  // Canonical 10 first.
  { outcome: "scheduled", outreachCallCreated: true, appointmentStatus: "scheduled", outreachRouteTerminalCompletion: true, canonicalSpineSyncInvoked: true, journeyEventAppendedOnOutreach: false, executionCaseUpdatedOnOutreach: false, triageCaseUpsertedOnOutreach: false, followUpTaskCreatedOnOutreach: false },
  { outcome: "callback", outreachCallCreated: true, appointmentStatus: "callback", outreachRouteTerminalCompletion: false, canonicalSpineSyncInvoked: true, journeyEventAppendedOnOutreach: false, executionCaseUpdatedOnOutreach: false, triageCaseUpsertedOnOutreach: false, followUpTaskCreatedOnOutreach: false },
  { outcome: "no_answer", outreachCallCreated: true, appointmentStatus: "no_answer", outreachRouteTerminalCompletion: false, canonicalSpineSyncInvoked: true, journeyEventAppendedOnOutreach: false, executionCaseUpdatedOnOutreach: false, triageCaseUpsertedOnOutreach: false, followUpTaskCreatedOnOutreach: false },
  { outcome: "voicemail", outreachCallCreated: true, appointmentStatus: "no_answer", outreachRouteTerminalCompletion: false, canonicalSpineSyncInvoked: true, journeyEventAppendedOnOutreach: false, executionCaseUpdatedOnOutreach: false, triageCaseUpsertedOnOutreach: false, followUpTaskCreatedOnOutreach: false },
  { outcome: "wrong_number", outreachCallCreated: true, appointmentStatus: "declined", outreachRouteTerminalCompletion: false, canonicalSpineSyncInvoked: true, journeyEventAppendedOnOutreach: false, executionCaseUpdatedOnOutreach: false, triageCaseUpsertedOnOutreach: false, followUpTaskCreatedOnOutreach: false },
  { outcome: "declined", outreachCallCreated: true, appointmentStatus: "declined", outreachRouteTerminalCompletion: true, canonicalSpineSyncInvoked: true, journeyEventAppendedOnOutreach: false, executionCaseUpdatedOnOutreach: false, triageCaseUpsertedOnOutreach: false, followUpTaskCreatedOnOutreach: false },
  // Engagement-only canonical outcomes are NOT accepted by the
  // outreach route schema; they remain only as documentation hooks
  // for the future canonical extension. Omitted from this matrix.
];

// Import-time check.
{
  const seen = new Set<string>();
  for (const e of OUTREACH_CALL_RESULT_SIDE_EFFECT_MATRIX) {
    if (seen.has(e.outcome)) throw new Error(`outreach side-effect matrix: duplicate "${e.outcome}"`);
    seen.add(e.outcome);
    if (e.journeyEventAppendedOnOutreach !== false) throw new Error(`outreach matrix: outcome "${e.outcome}" must not assert journey-event append`);
    if (e.executionCaseUpdatedOnOutreach !== false) throw new Error(`outreach matrix: outcome "${e.outcome}" must not assert execution-case update`);
    if (e.triageCaseUpsertedOnOutreach !== false) throw new Error(`outreach matrix: outcome "${e.outcome}" must not assert triage upsert`);
    if (e.followUpTaskCreatedOnOutreach !== false) throw new Error(`outreach matrix: outcome "${e.outcome}" must not assert task creation`);
  }
}
