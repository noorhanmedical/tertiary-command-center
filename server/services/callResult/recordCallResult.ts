// recordCallResult — canonical call-result service (Batch H Step 1).
//
// DORMANT — this module is NOT wired to any runtime route in this PR.
// Both legacy call-result routes continue to carry their own logic:
//   - POST /api/outreach/calls           (server/routes/outreach.ts)
//   - POST /api/engagement-center/call-result
//                                        (server/routes/executionCases.ts)
//
// Purpose of this PR: extract a pure, dependency-light planner that
// describes the canonical side-effect envelope for every call-result
// outcome. A future PR (Batch H Step 2) will delegate the two legacy
// routes through this planner; another (Batch H Step 6) will let the
// Team Portal write call results through it. Both are out of scope
// for THIS PR.
//
// PURITY CONTRACT
//   - No DB import. No drizzle-orm. No @shared/schema runtime import.
//   - No Express import. No request/response types.
//   - No `../routes/*` import. No storage import.
//   - No PHI accepted on inputs. Only patientScreeningId (opaque ID),
//     outcome, callbackAt, durationSeconds, notes hash, attempt#.
//   - No stdout writes. No logger calls. Outputs travel through the
//     return value only; the caller decides what (if anything) to log.
//
// REFERENCED CONTRACTS
//   - tests/fixtures/callResultCanonicalization.fixture.ts (Batch B)
//   - docs/architecture/engagement-call-list-canonicalization-contract.md
//     §9 (recordCallResult target).
//   - docs/architecture/call-list-runtime-implementation-plan.md
//     §1 (this PR).
//   - docs/architecture/call-result-canonicalization-parity.md (via
//     the parity fixture).

/**
 * The canonical set of call-result outcomes the service understands.
 * Kept in sync with `CALL_RESULT_OUTCOMES_FIXTURE` (Batch B).
 */
export const CALL_RESULT_OUTCOMES = [
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

export type CallResultOutcome = (typeof CALL_RESULT_OUTCOMES)[number];

/**
 * Which existing surface produced the call result. Used so the
 * future runtime PR can keep route-specific behavior (e.g. spine
 * sync) toggled on only for `outreach_call_route`.
 */
export type CallResultSourceSurface =
  | "outreach_call_route"
  | "engagement_center_route";

/**
 * AppointmentStatus values the canonical service may emit. Kept
 * narrow on purpose — the route owns the actual column write.
 */
export type CallResultAppointmentStatus =
  | "scheduled"
  | "callback"
  | "no_answer"
  | "declined"
  | "in_progress";

/**
 * EngagementStatus transitions the canonical service may emit.
 * `null` means the executionCase is left as-is.
 */
export type CallResultEngagementStatus =
  | "contacted"
  | "in_progress"
  | "not_reached"
  | "needs_followup"
  | null;

/**
 * Canonical input shape. Both legacy routes can be reduced to this
 * envelope without any PHI surface.
 */
export type CanonicalCallResultInput = {
  patientScreeningId: string;
  outcome: CallResultOutcome;
  sourceSurface: CallResultSourceSurface;
  /** ISO-8601 timestamp; required for callback-style outcomes. */
  callbackAt?: string | null;
  /** Free-text notes hash or short clinical note. NOT PHI-checked here. */
  notes?: string | null;
  durationSeconds?: number | null;
  attemptNumber?: number | null;
  /** Optional engagement-case linkage when the surface knows it. */
  patientExecutionCaseId?: string | null;
  /** Optional assignment linkage when the surface knows it. */
  schedulerAssignmentId?: string | null;
};

/**
 * Canonical output shape — the side-effect plan a future runtime
 * adapter will apply. Every documented outcome MUST be representable
 * by this envelope.
 */
export type RecordCallResultOutcome = {
  outcome: CallResultOutcome;
  sourceSurface: CallResultSourceSurface;
  /** Every call-result outcome inserts an outreach_calls row. */
  outreachCallCreated: true;
  appointmentStatus: CallResultAppointmentStatus;
  journeyEventType: "call_result_logged";
  executionCaseEngagementStatus: CallResultEngagementStatus;
  /** Future timestamp the engagement case must come back at; null if not required. */
  executionCaseNextActionAt: Date | null;
  /** Whether the scheduler_assignments row must be marked completed. */
  assignmentCompleted: boolean;
  /** Whether a plexus_tasks row must be created. */
  followUpTaskRequired: boolean;
  /** Whether a scheduling_triage_cases row must be opened. */
  triageCaseRequired: boolean;
  /** Terminal flag — the assignment is closed and no further callback. */
  terminal: boolean;
  /** Caller-supplied callback target (canonicalised to Date). */
  callbackAt: Date | null;
  /** Identifier for the kind of follow-up task to create. null if not required. */
  taskType:
    | "needs_records"
    | "insurance_prior_auth_issue"
    | "manager_review"
    | "facility_specific_issue"
    | null;
  /** Identifier for the kind of triage case to open. null if not required. */
  triageType:
    | "callback_scheduled"
    | "no_answer"
    | "voicemail"
    | "wrong_number"
    | null;
};

type CallResultPlan = Omit<
  RecordCallResultOutcome,
  "outcome" | "sourceSurface" | "outreachCallCreated" | "journeyEventType" | "callbackAt"
>;

/**
 * Outcome → side-effect plan. Mirrors the Batch B parity fixture.
 *
 * Sources audited when filling in the values:
 *   - server/routes/outreach.ts:37-59  (deriveAppointmentStatus)
 *   - server/routes/outreach.ts:222-229 (terminal set + completion)
 *   - server/routes/executionCases.ts:65-86 (CALL_RESULT_TRIAGE_MAP)
 *   - server/routes/executionCases.ts:264-350 (engagementStatus + task)
 *
 * Any change here MUST be reflected in the Batch B fixture (and
 * vice-versa) — the parity test pins both sides together.
 */
const PLAN_BY_OUTCOME: Readonly<Record<CallResultOutcome, CallResultPlan>> = {
  scheduled: {
    appointmentStatus: "scheduled",
    executionCaseEngagementStatus: "contacted",
    executionCaseNextActionAt: null,
    assignmentCompleted: true,
    followUpTaskRequired: false,
    triageCaseRequired: false,
    terminal: true,
    taskType: null,
    triageType: null,
  },
  callback: {
    appointmentStatus: "callback",
    executionCaseEngagementStatus: "needs_followup",
    executionCaseNextActionAt: null,
    assignmentCompleted: false,
    followUpTaskRequired: false,
    triageCaseRequired: true,
    terminal: false,
    taskType: null,
    triageType: "callback_scheduled",
  },
  no_answer: {
    appointmentStatus: "no_answer",
    executionCaseEngagementStatus: "not_reached",
    executionCaseNextActionAt: null,
    assignmentCompleted: false,
    followUpTaskRequired: false,
    triageCaseRequired: true,
    terminal: false,
    taskType: null,
    triageType: "no_answer",
  },
  voicemail: {
    appointmentStatus: "no_answer",
    executionCaseEngagementStatus: "not_reached",
    executionCaseNextActionAt: null,
    assignmentCompleted: false,
    followUpTaskRequired: false,
    triageCaseRequired: true,
    terminal: false,
    taskType: null,
    triageType: "voicemail",
  },
  wrong_number: {
    appointmentStatus: "declined",
    executionCaseEngagementStatus: "needs_followup",
    executionCaseNextActionAt: null,
    assignmentCompleted: false,
    followUpTaskRequired: false,
    triageCaseRequired: true,
    terminal: false,
    taskType: null,
    triageType: "wrong_number",
  },
  declined: {
    appointmentStatus: "declined",
    executionCaseEngagementStatus: "contacted",
    executionCaseNextActionAt: null,
    assignmentCompleted: true,
    followUpTaskRequired: false,
    triageCaseRequired: false,
    terminal: true,
    taskType: null,
    triageType: null,
  },
  needs_records: {
    appointmentStatus: "in_progress",
    executionCaseEngagementStatus: "in_progress",
    executionCaseNextActionAt: null,
    assignmentCompleted: false,
    followUpTaskRequired: true,
    triageCaseRequired: false,
    terminal: false,
    taskType: "needs_records",
    triageType: null,
  },
  insurance_prior_auth_issue: {
    appointmentStatus: "in_progress",
    executionCaseEngagementStatus: "in_progress",
    executionCaseNextActionAt: null,
    assignmentCompleted: false,
    followUpTaskRequired: true,
    triageCaseRequired: false,
    terminal: false,
    taskType: "insurance_prior_auth_issue",
    triageType: null,
  },
  manager_review: {
    appointmentStatus: "in_progress",
    executionCaseEngagementStatus: "needs_followup",
    executionCaseNextActionAt: null,
    assignmentCompleted: false,
    followUpTaskRequired: true,
    triageCaseRequired: false,
    terminal: false,
    taskType: "manager_review",
    triageType: null,
  },
  facility_specific_issue: {
    appointmentStatus: "in_progress",
    executionCaseEngagementStatus: "in_progress",
    executionCaseNextActionAt: null,
    assignmentCompleted: false,
    followUpTaskRequired: true,
    triageCaseRequired: false,
    terminal: false,
    taskType: "facility_specific_issue",
    triageType: null,
  },
};

/** Outcomes that require a future `nextActionAt` on the execution case. */
const CALLBACK_STYLE_OUTCOMES: ReadonlySet<CallResultOutcome> = new Set([
  "callback",
  "no_answer",
  "voicemail",
]);

function parseCallbackAt(raw: string | null | undefined): Date | null {
  if (raw == null) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Pure planner — given a canonical call-result input, return the
 * full side-effect envelope. No I/O, no DB, no logging.
 *
 * The future runtime adapter (Batch H Step 2) wraps this in a
 * dep-injected execute() that drives the actual storage helpers.
 * That adapter is intentionally NOT defined in this PR.
 */
export function recordCallResult(
  input: CanonicalCallResultInput,
): RecordCallResultOutcome {
  if (!input || typeof input !== "object") {
    throw new Error("recordCallResult: input is required");
  }
  if (typeof input.patientScreeningId !== "string" || input.patientScreeningId.length === 0) {
    throw new Error("recordCallResult: patientScreeningId is required");
  }
  if (typeof input.outcome !== "string") {
    throw new Error("recordCallResult: outcome is required");
  }
  const plan = PLAN_BY_OUTCOME[input.outcome as CallResultOutcome];
  if (!plan) {
    throw new Error(`recordCallResult: unknown outcome "${String(input.outcome)}"`);
  }
  if (
    input.sourceSurface !== "outreach_call_route" &&
    input.sourceSurface !== "engagement_center_route"
  ) {
    throw new Error(
      `recordCallResult: unknown sourceSurface "${String(input.sourceSurface)}"`,
    );
  }

  const callbackAt = parseCallbackAt(input.callbackAt);
  const requiresNextAction = CALLBACK_STYLE_OUTCOMES.has(input.outcome);
  const executionCaseNextActionAt = requiresNextAction
    ? callbackAt ?? defaultCallbackTarget()
    : null;

  return {
    outcome: input.outcome,
    sourceSurface: input.sourceSurface,
    outreachCallCreated: true,
    appointmentStatus: plan.appointmentStatus,
    journeyEventType: "call_result_logged",
    executionCaseEngagementStatus: plan.executionCaseEngagementStatus,
    executionCaseNextActionAt,
    assignmentCompleted: plan.assignmentCompleted,
    followUpTaskRequired: plan.followUpTaskRequired,
    triageCaseRequired: plan.triageCaseRequired,
    terminal: plan.terminal,
    callbackAt,
    taskType: plan.taskType,
    triageType: plan.triageType,
  };
}

/**
 * When a callback-style outcome arrives without an explicit
 * callbackAt, the canonical service still has to populate
 * executionCaseNextActionAt so the engagement-case board re-surfaces
 * the patient. Default target: now + 4 hours. Future PRs may wire
 * this to scheduler-config; for now it is a pure deterministic
 * fallback so the planner stays testable.
 */
function defaultCallbackTarget(): Date {
  const now = Date.now();
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
  return new Date(now + FOUR_HOURS_MS);
}
