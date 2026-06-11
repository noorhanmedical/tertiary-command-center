// Engagement call-result side-effect matrix — fixture (Batch 9).
//
// Pins the side effects the engagement-center surface owns under any
// future delegation. The matrix is keyed off the canonical outcome
// and lists boolean flags for each engagement-owned step. Outreach-
// owned steps (outreachCallCreated, assignmentCompleted) are
// intentionally excluded — they belong to the outreach surface
// (Batch 14) and only show up here if intentionally mapped later.
//
// Data-only fixture. No PHI.

export type EngagementSideEffectMatrixEntry = {
  outcome:
    | "scheduled"
    | "callback"
    | "no_answer"
    | "voicemail"
    | "wrong_number"
    | "declined"
    | "needs_records"
    | "insurance_prior_auth_issue"
    | "manager_review"
    | "facility_specific_issue";
  /** Always true — call_result_logged event for every outcome. */
  journeyEventAppended: true;
  /** Engagement-case engagementStatus transition (null = no change). */
  executionCaseEngagementStatus:
    | "contacted"
    | "in_progress"
    | "not_reached"
    | "needs_followup"
    | null;
  /** Whether nextActionAt must be populated (callback-style outcomes). */
  executionCaseNextActionAt: boolean;
  /** Whether a scheduling_triage_cases row is upserted. */
  triageCaseUpserted: boolean;
  /** Whether a plexus_tasks row is created. */
  followUpTaskCreated: boolean;
  /**
   * Intentionally documents the OUTREACH-owned step status. These
   * MUST stay false in the engagement matrix until a future PR
   * intentionally maps them on the engagement surface.
   */
  assignmentCompletedOnEngagement: false;
  outreachCallCreatedOnEngagement: false;
};

export const ENGAGEMENT_CALL_RESULT_SIDE_EFFECT_MATRIX: ReadonlyArray<EngagementSideEffectMatrixEntry> = [
  {
    outcome: "scheduled",
    journeyEventAppended: true,
    executionCaseEngagementStatus: "contacted",
    executionCaseNextActionAt: false,
    triageCaseUpserted: false,
    followUpTaskCreated: false,
    assignmentCompletedOnEngagement: false,
    outreachCallCreatedOnEngagement: false,
  },
  {
    outcome: "callback",
    journeyEventAppended: true,
    executionCaseEngagementStatus: "needs_followup",
    executionCaseNextActionAt: true,
    triageCaseUpserted: true,
    followUpTaskCreated: false,
    assignmentCompletedOnEngagement: false,
    outreachCallCreatedOnEngagement: false,
  },
  {
    outcome: "no_answer",
    journeyEventAppended: true,
    executionCaseEngagementStatus: "not_reached",
    executionCaseNextActionAt: true,
    triageCaseUpserted: true,
    followUpTaskCreated: false,
    assignmentCompletedOnEngagement: false,
    outreachCallCreatedOnEngagement: false,
  },
  {
    outcome: "voicemail",
    journeyEventAppended: true,
    executionCaseEngagementStatus: "not_reached",
    executionCaseNextActionAt: true,
    triageCaseUpserted: true,
    followUpTaskCreated: false,
    assignmentCompletedOnEngagement: false,
    outreachCallCreatedOnEngagement: false,
  },
  {
    outcome: "wrong_number",
    journeyEventAppended: true,
    executionCaseEngagementStatus: "needs_followup",
    executionCaseNextActionAt: false,
    triageCaseUpserted: true,
    followUpTaskCreated: false,
    assignmentCompletedOnEngagement: false,
    outreachCallCreatedOnEngagement: false,
  },
  {
    outcome: "declined",
    journeyEventAppended: true,
    executionCaseEngagementStatus: "contacted",
    executionCaseNextActionAt: false,
    triageCaseUpserted: false,
    followUpTaskCreated: false,
    assignmentCompletedOnEngagement: false,
    outreachCallCreatedOnEngagement: false,
  },
  {
    outcome: "needs_records",
    journeyEventAppended: true,
    executionCaseEngagementStatus: "in_progress",
    executionCaseNextActionAt: false,
    triageCaseUpserted: false,
    followUpTaskCreated: true,
    assignmentCompletedOnEngagement: false,
    outreachCallCreatedOnEngagement: false,
  },
  {
    outcome: "insurance_prior_auth_issue",
    journeyEventAppended: true,
    executionCaseEngagementStatus: "in_progress",
    executionCaseNextActionAt: false,
    triageCaseUpserted: false,
    followUpTaskCreated: true,
    assignmentCompletedOnEngagement: false,
    outreachCallCreatedOnEngagement: false,
  },
  {
    outcome: "manager_review",
    journeyEventAppended: true,
    executionCaseEngagementStatus: "needs_followup",
    executionCaseNextActionAt: false,
    triageCaseUpserted: false,
    followUpTaskCreated: true,
    assignmentCompletedOnEngagement: false,
    outreachCallCreatedOnEngagement: false,
  },
  {
    outcome: "facility_specific_issue",
    journeyEventAppended: true,
    executionCaseEngagementStatus: "in_progress",
    executionCaseNextActionAt: false,
    triageCaseUpserted: false,
    followUpTaskCreated: true,
    assignmentCompletedOnEngagement: false,
    outreachCallCreatedOnEngagement: false,
  },
];

// Import-time sanity check.
{
  const outcomes = new Set<string>();
  for (const e of ENGAGEMENT_CALL_RESULT_SIDE_EFFECT_MATRIX) {
    if (outcomes.has(e.outcome)) {
      throw new Error(`engagement side-effect matrix: duplicate outcome "${e.outcome}"`);
    }
    outcomes.add(e.outcome);
    if (e.outreachCallCreatedOnEngagement !== false) {
      throw new Error(
        `engagement side-effect matrix: outcome "${e.outcome}" must not assert outreach call creation on engagement surface`,
      );
    }
    if (e.assignmentCompletedOnEngagement !== false) {
      throw new Error(
        `engagement side-effect matrix: outcome "${e.outcome}" must not assert assignment completion on engagement surface`,
      );
    }
  }
  if (ENGAGEMENT_CALL_RESULT_SIDE_EFFECT_MATRIX.length !== 10) {
    throw new Error(
      `engagement side-effect matrix: expected 10 outcomes, got ${ENGAGEMENT_CALL_RESULT_SIDE_EFFECT_MATRIX.length}`,
    );
  }
}
