// recordCallResult engagement-center executor (Batch 7 of split-brain run).
//
// DORMANT — no runtime route imports this executor in this PR. The
// executor is a thin engagement-specific wrapper around the canonical
// recordCallResultExecutionAdapter. It maps the legacy engagement-
// center route's body shape into the canonical input + selects which
// dependencies the engagement surface needs, then delegates to the
// adapter.
//
// PURITY CONTRACT
//   - No DB import. No drizzle-orm. No @shared/schema runtime import.
//   - No Express import.
//   - No route import. No storage import.
//   - No PHI accepted at this layer.
//   - Imports only `./recordCallResultExecutionAdapter` and the
//     planner types via re-export.
//
// REFERENCED CONTRACTS
//   - server/services/callResult/recordCallResultExecutionAdapter.ts
//   - docs/architecture/engagement-canonical-call-result-endpoint-contract.md (Batch 6)
//   - docs/architecture/canonical-workflow-ownership-registry.md §"Engagement Center"

import {
  executeRecordCallResult,
  type CallResultExecutionDependencies,
  type RecordCallResultExecutionResult,
  type RecordCallResultExecutionOptions,
} from "./recordCallResultExecutionAdapter";
import type {
  CallResultOutcome,
  CallResultSourceSurface,
} from "./recordCallResult";

/**
 * The legacy engagement-center route's body shape, reduced to the
 * non-PHI fields the executor needs. The patient resolution
 * (executionCaseId → patientScreeningId → name+dob) stays in the
 * route layer; the executor only sees opaque IDs.
 */
export type EngagementCallResultInput = {
  patientScreeningId: string;
  patientExecutionCaseId: string | null;
  outcome: CallResultOutcome;
  callbackAt?: string | null;
  notes?: string | null;
  durationSeconds?: number | null;
  attemptNumber?: number | null;
  schedulerAssignmentId?: string | null;
};

/**
 * Engagement-shaped result envelope the future legacy adapter will
 * use to rebuild the response shape (Batch 8 fixture pins it).
 */
export type EngagementCallResultExecutorResponse = {
  ok: boolean;
  steps: RecordCallResultExecutionResult["steps"];
  plan: RecordCallResultExecutionResult["plan"];
  /**
   * Which subset of the adapter's seven steps the engagement surface
   * actually invokes. Defaults exclude `assignmentCompleted` and
   * `outreachCallCreated` — those are owned by the OUTREACH executor
   * (Batch 14). The engagement surface is responsible for journey
   * event, execution-case update, triage, task.
   */
  engagementOwnedSteps: ReadonlyArray<RecordCallResultExecutionResult["steps"][number]["step"]>;
};

const ENGAGEMENT_OWNED_STEPS = [
  "journeyEventAppended",
  "appointmentStatusUpdated",
  "executionCaseUpdated",
  "triageCaseUpserted",
  "followUpTaskCreated",
] as const;

/**
 * Engagement executor. Maps engagement input → canonical input,
 * supplies the dependency map (caller still injects the writers),
 * and drives the canonical adapter.
 *
 * The caller (future route delegation in Batch 12) is responsible for
 * filtering the returned steps to the engagement-owned subset when
 * rebuilding the legacy response shape.
 */
export async function recordEngagementCallResult(
  input: EngagementCallResultInput,
  deps: CallResultExecutionDependencies,
  options?: RecordCallResultExecutionOptions,
): Promise<EngagementCallResultExecutorResponse> {
  if (!input || typeof input !== "object") {
    throw new Error("recordEngagementCallResult: input is required");
  }
  if (!input.patientScreeningId) {
    throw new Error("recordEngagementCallResult: patientScreeningId is required");
  }

  const sourceSurface: CallResultSourceSurface = "engagement_center_route";
  const adapterResult = await executeRecordCallResult(
    {
      patientScreeningId: input.patientScreeningId,
      outcome: input.outcome,
      sourceSurface,
      callbackAt: input.callbackAt ?? null,
      notes: input.notes ?? null,
      durationSeconds: input.durationSeconds ?? null,
      attemptNumber: input.attemptNumber ?? null,
      patientExecutionCaseId: input.patientExecutionCaseId,
      schedulerAssignmentId: input.schedulerAssignmentId ?? null,
    },
    deps,
    options,
  );

  return {
    ok: adapterResult.ok,
    steps: adapterResult.steps,
    plan: adapterResult.plan,
    engagementOwnedSteps: ENGAGEMENT_OWNED_STEPS,
  };
}

export { ENGAGEMENT_OWNED_STEPS };
