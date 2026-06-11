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
  type CallResultExecutionStep,
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
  /**
   * Ownership write-through (Batch 2 of arg-extensions run).
   * When the engagement route resolves a new assigned team member /
   * role from the request body, it passes them here. The executor
   * forwards them to the updateExecutionCaseEngagement dep via the
   * adapter's UpdateExecutionCaseEngagementArgs extension fields.
   */
  assignedTeamMemberId?: string | null;
  assignedRole?: string | null;
  forceReassign?: boolean;
  /**
   * Journey-event metadata extension (Batch 3 of arg-extensions run).
   * Forwarded through to the appendJourneyEvent dep so the route can
   * preserve the legacy metadata bag byte-equivalent under future
   * delegation (resolves Batch 12 B8 at the executor layer).
   *
   * PHI fields (patientName, patientDob) flow through the dep
   * boundary ONLY — the executor does not log or inspect them.
   */
  journeyEventMetadata?: Record<string, unknown>;
  patientName?: string | null;
  patientDob?: string | null;
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
  /**
   * `true` when the caller supplied any ownership write-through
   * field (assignedTeamMemberId / assignedRole / forceReassign).
   * Independent of whether the EC update step ran.
   */
  ownershipPlanned: boolean;
  /**
   * `true` when ownership write-through was both PLANNED by the
   * input AND the execution-case update step actually ran (status
   * === "ran"). Matches the legacy route's `ownershipUpdated` boolean
   * (resolves Batch 12 B3).
   */
  ownershipUpdated: boolean;
};

const ENGAGEMENT_OWNED_STEPS = [
  "journeyEventAppended",
  "appointmentStatusUpdated",
  "executionCaseUpdated",
  "triageCaseUpserted",
  "followUpTaskCreated",
] as const;

/**
 * Steps the engagement surface does NOT own. The executor passes
 * these to the adapter's `suppressedSteps` option so the adapter
 * marks them `skipped` with reason `surface does not own` and does
 * not call their dep — matching the legacy engagement route's
 * behavior (it does NOT insert outreach_calls, does NOT mark
 * scheduler_assignments completed).
 */
export const ENGAGEMENT_SUPPRESSED_STEPS: ReadonlyArray<CallResultExecutionStep> = [
  "outreachCallCreated",
  "assignmentCompleted",
];

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
  const mergedSuppressed: ReadonlyArray<CallResultExecutionStep> = [
    ...ENGAGEMENT_SUPPRESSED_STEPS,
    ...(options?.suppressedSteps ?? []),
  ];

  const ownershipPlanned =
    input.assignedTeamMemberId !== undefined ||
    input.assignedRole !== undefined ||
    input.forceReassign === true;

  // Wrap the caller's updateExecutionCaseEngagement dep so we can
  // forward the ownership write-through fields without requiring the
  // caller to know about the engagement input shape. Also wrap the
  // appendJourneyEvent dep to thread journey-event metadata +
  // closure-captured PHI (Batch 3) through to the writer.
  const wrappedDeps: CallResultExecutionDependencies = {
    ...deps,
    updateExecutionCaseEngagement: (args) =>
      deps.updateExecutionCaseEngagement({
        ...args,
        ...(input.assignedTeamMemberId !== undefined
          ? { assignedTeamMemberId: input.assignedTeamMemberId }
          : {}),
        ...(input.assignedRole !== undefined
          ? { assignedRole: input.assignedRole }
          : {}),
        ...(input.forceReassign !== undefined
          ? { forceReassign: input.forceReassign }
          : {}),
      }),
    appendJourneyEvent: (args) =>
      deps.appendJourneyEvent({
        ...args,
        ...(input.journeyEventMetadata !== undefined
          ? { metadata: input.journeyEventMetadata }
          : {}),
        ...(input.patientName !== undefined ? { patientName: input.patientName } : {}),
        ...(input.patientDob !== undefined ? { patientDob: input.patientDob } : {}),
      }),
  };

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
    wrappedDeps,
    { ...options, suppressedSteps: mergedSuppressed },
  );

  const ecStep = adapterResult.steps.find((s) => s.step === "executionCaseUpdated");
  const ownershipUpdated = ownershipPlanned && ecStep?.status === "ran";

  return {
    ok: adapterResult.ok,
    steps: adapterResult.steps,
    plan: adapterResult.plan,
    engagementOwnedSteps: ENGAGEMENT_OWNED_STEPS,
    ownershipPlanned,
    ownershipUpdated,
  };
}

export { ENGAGEMENT_OWNED_STEPS };
