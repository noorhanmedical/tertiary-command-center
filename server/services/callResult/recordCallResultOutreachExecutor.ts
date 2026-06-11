// recordCallResult outreach executor (Batch 14 of split-brain run).
//
// DORMANT — no runtime route imports this executor in this PR. The
// executor is the outreach-surface counterpart of the engagement
// executor (Batch 7). It maps the legacy outreach route's body into
// the canonical input + advertises the outreach-owned steps:
// outreachCallCreated, appointmentStatusUpdated, assignmentCompleted.
// Engagement-only steps (journey, exec-case, triage, task) are not
// in the outreach-owned set today; they may be intentionally mapped
// later if Ali approves.
//
// PURITY CONTRACT (same as Batch 7)
//   - No DB / Express / @shared/schema / route / storage imports.
//   - No PHI accepted.
//   - Imports only the sibling adapter + planner types.

import {
  executeRecordCallResult,
  type CallResultExecutionDependencies,
  type CallResultExecutionStep,
  type RecordCallResultExecutionResult,
  type RecordCallResultExecutionOptions,
} from "./recordCallResultExecutionAdapter";
import type {
  CallResultOutcome,
  CallResultSourceSurface,
} from "./recordCallResult";

export type OutreachCallResultInput = {
  patientScreeningId: string;
  outcome: CallResultOutcome;
  callbackAt?: string | null;
  notes?: string | null;
  durationSeconds?: number | null;
  attemptNumber?: number | null;
  schedulerAssignmentId?: string | null;
  /**
   * Outreach surface doesn't always know the execution-case id. When
   * not supplied, the executor's executionCaseUpdated step is skipped.
   */
  patientExecutionCaseId?: string | null;
};

export type OutreachCallResultExecutorResponse = {
  ok: boolean;
  steps: RecordCallResultExecutionResult["steps"];
  plan: RecordCallResultExecutionResult["plan"];
  outreachOwnedSteps: ReadonlyArray<RecordCallResultExecutionResult["steps"][number]["step"]>;
};

const OUTREACH_OWNED_STEPS = [
  "outreachCallCreated",
  "appointmentStatusUpdated",
  "assignmentCompleted",
] as const;

/**
 * Steps the outreach surface does NOT own today. The executor passes
 * these to the adapter's `suppressedSteps` option so the adapter
 * marks them `skipped` with reason `surface does not own` and does
 * not call their dep — matching the legacy outreach route's behavior
 * (it does NOT append journey events, does NOT update execution case
 * state, does NOT open triage cases, does NOT create plexus tasks).
 *
 * If Ali approves the outreach surface owning journey-event appends
 * (Batch 19 B5), this list shrinks in a future PR.
 */
export const OUTREACH_SUPPRESSED_STEPS: ReadonlyArray<CallResultExecutionStep> = [
  "journeyEventAppended",
  "executionCaseUpdated",
  "triageCaseUpserted",
  "followUpTaskCreated",
];

export async function recordOutreachCallResult(
  input: OutreachCallResultInput,
  deps: CallResultExecutionDependencies,
  options?: RecordCallResultExecutionOptions,
): Promise<OutreachCallResultExecutorResponse> {
  if (!input || typeof input !== "object") {
    throw new Error("recordOutreachCallResult: input is required");
  }
  if (!input.patientScreeningId) {
    throw new Error("recordOutreachCallResult: patientScreeningId is required");
  }

  const sourceSurface: CallResultSourceSurface = "outreach_call_route";
  const mergedSuppressed: ReadonlyArray<CallResultExecutionStep> = [
    ...OUTREACH_SUPPRESSED_STEPS,
    ...(options?.suppressedSteps ?? []),
  ];
  const adapterResult = await executeRecordCallResult(
    {
      patientScreeningId: input.patientScreeningId,
      outcome: input.outcome,
      sourceSurface,
      callbackAt: input.callbackAt ?? null,
      notes: input.notes ?? null,
      durationSeconds: input.durationSeconds ?? null,
      attemptNumber: input.attemptNumber ?? null,
      patientExecutionCaseId: input.patientExecutionCaseId ?? null,
      schedulerAssignmentId: input.schedulerAssignmentId ?? null,
    },
    deps,
    { ...options, suppressedSteps: mergedSuppressed },
  );

  return {
    ok: adapterResult.ok,
    steps: adapterResult.steps,
    plan: adapterResult.plan,
    outreachOwnedSteps: OUTREACH_OWNED_STEPS,
  };
}

export { OUTREACH_OWNED_STEPS };
