// recordCallResult execution adapter (Batch H Step 5A).
//
// DORMANT — no runtime route imports this adapter in this PR. The
// adapter is the future delegation surface: it takes the canonical
// input shape, asks the planner for the side-effect envelope, and
// drives a set of dependency-injected writer functions in the order
// the canonical plan requires. The route-side wiring (which provides
// real DB-bound writers) is the subject of a later batch.
//
// PURITY CONTRACT
//   - No DB import. No drizzle-orm. No @shared/schema runtime import.
//   - No Express import. No request/response types.
//   - No `../routes/*` import. No storage import.
//   - No PHI accepted on inputs. The adapter's input is the same
//     CanonicalCallResultInput the planner accepts (opaque IDs +
//     outcome label + optional callback/duration/attempt).
//   - No stdout writes. No logger calls. Errors are returned via
//     RecordCallResultExecutionResult.steps[*].status, never logged
//     here. The caller decides what (if anything) to log.
//
// REFERENCED CONTRACTS
//   - tests/fixtures/callResultCanonicalization.fixture.ts (Batch B).
//   - docs/architecture/engagement-call-list-canonicalization-contract.md §9.
//   - docs/architecture/call-list-runtime-implementation-plan.md §1+§2.
//   - docs/architecture/call-result-preview-parity-readiness.md §8.

import {
  recordCallResult,
  type CanonicalCallResultInput,
  type RecordCallResultOutcome,
  type CallResultOutcome,
  type CallResultSourceSurface,
} from "./recordCallResult";

/**
 * The discrete side-effect steps the canonical plan can drive. The
 * adapter walks them in this order; the order is part of the contract
 * so the future route delegation matches the existing routes' write
 * ordering (outreach_calls insert first; journey event next; downstream
 * derived writes after).
 */
export const CALL_RESULT_EXECUTION_STEPS = [
  "outreachCallCreated",
  "journeyEventAppended",
  "appointmentStatusUpdated",
  "executionCaseUpdated",
  "assignmentCompleted",
  "triageCaseUpserted",
  "followUpTaskCreated",
] as const;
export type CallResultExecutionStep = (typeof CALL_RESULT_EXECUTION_STEPS)[number];

export type CallResultExecutionStepStatus = "ran" | "skipped" | "failed";

export type CallResultExecutionStepResult = {
  step: CallResultExecutionStep;
  status: CallResultExecutionStepStatus;
  /** Populated when status === "skipped" or "failed". */
  reason?: string;
};

export type RecordCallResultExecutionResult = {
  plan: RecordCallResultOutcome;
  steps: CallResultExecutionStepResult[];
  /** true iff no step status is "failed". */
  ok: boolean;
};

/**
 * Argument shapes the injected writers receive. All non-PHI: only
 * opaque IDs and canonical labels.
 */
export type CreateOutreachCallArgs = {
  patientScreeningId: string;
  outcome: CallResultOutcome;
  sourceSurface: CallResultSourceSurface;
  callbackAt: Date | null;
  notes: string | null;
  durationSeconds: number | null;
  attemptNumber: number | null;
};

export type AppendJourneyEventArgs = {
  patientScreeningId: string;
  patientExecutionCaseId: string | null;
  eventType: "call_result_logged";
  sourceSurface: CallResultSourceSurface;
  outcome: CallResultOutcome;
};

export type UpdateAppointmentStatusArgs = {
  patientScreeningId: string;
  appointmentStatus: RecordCallResultOutcome["appointmentStatus"];
};

export type UpdateExecutionCaseEngagementArgs = {
  patientExecutionCaseId: string;
  engagementStatus: NonNullable<RecordCallResultOutcome["executionCaseEngagementStatus"]>;
  nextActionAt: Date | null;
};

export type MarkAssignmentCompletedArgs = {
  patientScreeningId: string;
  schedulerAssignmentId: string | null;
};

export type UpsertTriageCaseArgs = {
  patientScreeningId: string;
  patientExecutionCaseId: string | null;
  triageType: NonNullable<RecordCallResultOutcome["triageType"]>;
  callbackAt: Date | null;
};

export type CreateFollowUpTaskArgs = {
  patientScreeningId: string;
  patientExecutionCaseId: string | null;
  taskType: NonNullable<RecordCallResultOutcome["taskType"]>;
};

/**
 * Injected writers. The adapter has no opinion on whether these are
 * synchronous, async, transactional, idempotent, or fire-and-forget.
 * It only requires that they return (eventually) without throwing
 * unhandled errors. Any thrown error is caught and surfaced as a
 * `failed` step result.
 */
export type CallResultExecutionDependencies = {
  createOutreachCall: (args: CreateOutreachCallArgs) => Promise<void> | void;
  appendJourneyEvent: (args: AppendJourneyEventArgs) => Promise<void> | void;
  updateAppointmentStatus: (args: UpdateAppointmentStatusArgs) => Promise<void> | void;
  updateExecutionCaseEngagement: (
    args: UpdateExecutionCaseEngagementArgs,
  ) => Promise<void> | void;
  markAssignmentCompleted: (args: MarkAssignmentCompletedArgs) => Promise<void> | void;
  upsertTriageCase: (args: UpsertTriageCaseArgs) => Promise<void> | void;
  createFollowUpTask: (args: CreateFollowUpTaskArgs) => Promise<void> | void;
};

/**
 * Best-effort vs strict execution. Default best-effort: a failing
 * step does not short-circuit the remaining steps. Strict: the first
 * failure stops execution. The two existing legacy routes (outreach
 * + engagement-center) both use best-effort patterns today, so the
 * adapter defaults to best-effort to preserve parity.
 */
export type RecordCallResultExecutionOptions = {
  mode?: "best-effort" | "strict";
  /**
   * Per-surface step suppression. Steps named here are NOT executed,
   * their dep is NOT called, and they are marked `skipped` with
   * reason "surface does not own". Strict mode does not short-circuit
   * on a suppressed step (suppression is not failure).
   *
   * Engagement and outreach executors use this to scope the adapter
   * to only the steps each surface owns today (Batches B + C of the
   * adapter blockers run).
   */
  suppressedSteps?: ReadonlyArray<CallResultExecutionStep>;
};

/** Constant skip reason used for suppressed steps — grep-stable. */
export const SUPPRESSED_STEP_REASON = "surface does not own";

type StepRunner = () => Promise<void>;

async function runStep(
  step: CallResultExecutionStep,
  shouldRun: boolean,
  skipReason: string | null,
  runner: StepRunner,
): Promise<CallResultExecutionStepResult> {
  if (!shouldRun) {
    return { step, status: "skipped", reason: skipReason ?? "not required by plan" };
  }
  try {
    await runner();
    return { step, status: "ran" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { step, status: "failed", reason: message };
  }
}

/**
 * Drive the canonical plan against injected writers.
 *
 * IMPORTANT: This adapter is dormant in this PR. The only callers
 * are tests. The future route delegation PR (Batch H Step 6+) will
 * supply real writers and a route-delegation flag.
 */
export async function executeRecordCallResult(
  input: CanonicalCallResultInput,
  deps: CallResultExecutionDependencies,
  options?: RecordCallResultExecutionOptions,
): Promise<RecordCallResultExecutionResult> {
  const plan = recordCallResult(input);
  const mode = options?.mode ?? "best-effort";
  const suppressed = new Set<CallResultExecutionStep>(options?.suppressedSteps ?? []);
  const steps: CallResultExecutionStepResult[] = [];

  const screeningId = input.patientScreeningId;
  const executionCaseId = input.patientExecutionCaseId ?? null;
  const assignmentId = input.schedulerAssignmentId ?? null;

  const planned: Record<CallResultExecutionStep, { shouldRun: boolean; reason: string | null; runner: StepRunner }> = {
    outreachCallCreated: {
      shouldRun: true,
      reason: null,
      runner: async () => {
        await deps.createOutreachCall({
          patientScreeningId: screeningId,
          outcome: plan.outcome,
          sourceSurface: plan.sourceSurface,
          callbackAt: plan.callbackAt,
          notes: input.notes ?? null,
          durationSeconds: input.durationSeconds ?? null,
          attemptNumber: input.attemptNumber ?? null,
        });
      },
    },
    journeyEventAppended: {
      shouldRun: true,
      reason: null,
      runner: async () => {
        await deps.appendJourneyEvent({
          patientScreeningId: screeningId,
          patientExecutionCaseId: executionCaseId,
          eventType: plan.journeyEventType,
          sourceSurface: plan.sourceSurface,
          outcome: plan.outcome,
        });
      },
    },
    appointmentStatusUpdated: {
      shouldRun: true,
      reason: null,
      runner: async () => {
        await deps.updateAppointmentStatus({
          patientScreeningId: screeningId,
          appointmentStatus: plan.appointmentStatus,
        });
      },
    },
    executionCaseUpdated: {
      shouldRun:
        executionCaseId !== null &&
        plan.executionCaseEngagementStatus !== null,
      reason:
        executionCaseId === null
          ? "no execution case id provided"
          : plan.executionCaseEngagementStatus === null
            ? "plan has no engagement status transition"
            : null,
      runner: async () => {
        await deps.updateExecutionCaseEngagement({
          patientExecutionCaseId: executionCaseId as string,
          engagementStatus:
            plan.executionCaseEngagementStatus as NonNullable<
              RecordCallResultOutcome["executionCaseEngagementStatus"]
            >,
          nextActionAt: plan.executionCaseNextActionAt,
        });
      },
    },
    assignmentCompleted: {
      shouldRun: plan.assignmentCompleted,
      reason: plan.assignmentCompleted ? null : "plan is non-terminal",
      runner: async () => {
        await deps.markAssignmentCompleted({
          patientScreeningId: screeningId,
          schedulerAssignmentId: assignmentId,
        });
      },
    },
    triageCaseUpserted: {
      shouldRun: plan.triageCaseRequired && plan.triageType !== null,
      reason: plan.triageCaseRequired
        ? plan.triageType === null
          ? "plan has triageCaseRequired but no triageType"
          : null
        : "plan does not require triage",
      runner: async () => {
        await deps.upsertTriageCase({
          patientScreeningId: screeningId,
          patientExecutionCaseId: executionCaseId,
          triageType: plan.triageType as NonNullable<RecordCallResultOutcome["triageType"]>,
          callbackAt: plan.callbackAt,
        });
      },
    },
    followUpTaskCreated: {
      shouldRun: plan.followUpTaskRequired && plan.taskType !== null,
      reason: plan.followUpTaskRequired
        ? plan.taskType === null
          ? "plan has followUpTaskRequired but no taskType"
          : null
        : "plan does not require follow-up task",
      runner: async () => {
        await deps.createFollowUpTask({
          patientScreeningId: screeningId,
          patientExecutionCaseId: executionCaseId,
          taskType: plan.taskType as NonNullable<RecordCallResultOutcome["taskType"]>,
        });
      },
    },
  };

  for (const step of CALL_RESULT_EXECUTION_STEPS) {
    if (suppressed.has(step)) {
      steps.push({ step, status: "skipped", reason: SUPPRESSED_STEP_REASON });
      continue;
    }
    const spec = planned[step];
    const result = await runStep(step, spec.shouldRun, spec.reason, spec.runner);
    steps.push(result);
    if (mode === "strict" && result.status === "failed") {
      break;
    }
  }

  const ok = steps.every((s) => s.status !== "failed");
  return { plan, steps, ok };
}
