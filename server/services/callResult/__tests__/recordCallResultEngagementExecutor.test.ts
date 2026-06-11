// Engagement executor — fake-deps test (Batch 7 of split-brain run).
//
// Runnable via:
//   npx tsx server/services/callResult/__tests__/recordCallResultEngagementExecutor.test.ts

import {
  recordEngagementCallResult,
  ENGAGEMENT_OWNED_STEPS,
  ENGAGEMENT_SUPPRESSED_STEPS,
  type EngagementCallResultInput,
} from "../recordCallResultEngagementExecutor";
import type { CallResultExecutionStepResult } from "../recordCallResultExecutionAdapter";
import type {
  CallResultExecutionDependencies,
  CreateOutreachCallArgs,
  AppendJourneyEventArgs,
  UpdateAppointmentStatusArgs,
  UpdateExecutionCaseEngagementArgs,
  MarkAssignmentCompletedArgs,
  UpsertTriageCaseArgs,
  CreateFollowUpTaskArgs,
} from "../recordCallResultExecutionAdapter";
import { CALL_RESULT_PARITY_FIXTURE } from "../../../../tests/fixtures/callResultCanonicalization.fixture";

const failures: string[] = [];
function check(cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}
function eq<T>(a: T, b: T, label: string) {
  if (a !== b) failures.push(`${label}: expected ${String(b)} got ${String(a)}`);
}

type Log = {
  createOutreachCall: CreateOutreachCallArgs[];
  appendJourneyEvent: AppendJourneyEventArgs[];
  updateAppointmentStatus: UpdateAppointmentStatusArgs[];
  updateExecutionCaseEngagement: UpdateExecutionCaseEngagementArgs[];
  markAssignmentCompleted: MarkAssignmentCompletedArgs[];
  upsertTriageCase: UpsertTriageCaseArgs[];
  createFollowUpTask: CreateFollowUpTaskArgs[];
};

function fakeDeps(): { deps: CallResultExecutionDependencies; log: Log } {
  const log: Log = {
    createOutreachCall: [],
    appendJourneyEvent: [],
    updateAppointmentStatus: [],
    updateExecutionCaseEngagement: [],
    markAssignmentCompleted: [],
    upsertTriageCase: [],
    createFollowUpTask: [],
  };
  const deps: CallResultExecutionDependencies = {
    createOutreachCall: (a) => { log.createOutreachCall.push(a); },
    appendJourneyEvent: (a) => { log.appendJourneyEvent.push(a); },
    updateAppointmentStatus: (a) => { log.updateAppointmentStatus.push(a); },
    updateExecutionCaseEngagement: (a) => { log.updateExecutionCaseEngagement.push(a); },
    markAssignmentCompleted: (a) => { log.markAssignmentCompleted.push(a); },
    upsertTriageCase: (a) => { log.upsertTriageCase.push(a); },
    createFollowUpTask: (a) => { log.createFollowUpTask.push(a); },
  };
  return { deps, log };
}

// §1 — every fixture outcome runs through the engagement executor.
for (const env of CALL_RESULT_PARITY_FIXTURE) {
  const { deps, log } = fakeDeps();
  const input: EngagementCallResultInput = {
    patientScreeningId: "ps-1",
    patientExecutionCaseId: "ec-1",
    outcome: env.outcome,
    callbackAt: env.executionCaseNextActionAtRequired ? "2026-06-10T18:00:00.000Z" : null,
  };
  const r = await recordEngagementCallResult(input, deps);
  eq(r.ok, true, `§1.ok [${env.outcome}]`);
  // Engagement-owned steps are advertised in the response envelope.
  check(
    r.engagementOwnedSteps.includes("journeyEventAppended"),
    `§1.advertised [${env.outcome}] journeyEventAppended`,
  );
  // Journey event always fired.
  eq(log.appendJourneyEvent.length, 1, `§1.journey [${env.outcome}]`);
  eq(log.appendJourneyEvent[0].sourceSurface, "engagement_center_route", `§1.surface [${env.outcome}]`);
  // Triage / task fire according to fixture.
  eq(log.upsertTriageCase.length, env.triageCaseRequired ? 1 : 0, `§1.triage [${env.outcome}]`);
  eq(log.createFollowUpTask.length, env.followUpTaskRequired ? 1 : 0, `§1.task [${env.outcome}]`);
  // Execution case update fires when planner emits a transition.
  eq(
    log.updateExecutionCaseEngagement.length,
    env.executionCaseEngagementStatus !== null ? 1 : 0,
    `§1.ec [${env.outcome}]`,
  );
  // Engagement surface DOES NOT own assignment completion — the
  // outreach surface does. After Batch B suppression, the engagement
  // executor ALWAYS skips markAssignmentCompleted regardless of
  // planner's terminal flag.
  eq(log.markAssignmentCompleted.length, 0, `§1.assignment [${env.outcome}] suppressed on engagement surface`);
  // Engagement surface DOES NOT own outreach call insert either.
  eq(log.createOutreachCall.length, 0, `§1.outreachInsert [${env.outcome}] suppressed on engagement surface`);
}

// §2 — ENGAGEMENT_OWNED_STEPS does NOT advertise outreachCallCreated
//      or assignmentCompleted (those are the outreach surface's
//      historical territory in the legacy split).
check(
  !ENGAGEMENT_OWNED_STEPS.includes("outreachCallCreated" as never),
  "§2: engagement-owned step list must not advertise outreachCallCreated",
);
check(
  !ENGAGEMENT_OWNED_STEPS.includes("assignmentCompleted" as never),
  "§2: engagement-owned step list must not advertise assignmentCompleted",
);
check(
  ENGAGEMENT_OWNED_STEPS.includes("journeyEventAppended"),
  "§2: engagement-owned step list must include journeyEventAppended",
);
check(
  ENGAGEMENT_OWNED_STEPS.includes("executionCaseUpdated"),
  "§2: engagement-owned step list must include executionCaseUpdated",
);
check(
  ENGAGEMENT_OWNED_STEPS.includes("triageCaseUpserted"),
  "§2: engagement-owned step list must include triageCaseUpserted",
);
check(
  ENGAGEMENT_OWNED_STEPS.includes("followUpTaskCreated"),
  "§2: engagement-owned step list must include followUpTaskCreated",
);

// §3 — Missing patientScreeningId throws.
{
  let threw = false;
  const { deps } = fakeDeps();
  try {
    await recordEngagementCallResult(
      // @ts-expect-error — intentional: testing runtime guard.
      { patientExecutionCaseId: "ec-1", outcome: "scheduled" },
      deps,
    );
  } catch {
    threw = true;
  }
  check(threw, "§3: missing patientScreeningId must throw");
}

// §3.5 — ENGAGEMENT_SUPPRESSED_STEPS contract.
{
  check(
    ENGAGEMENT_SUPPRESSED_STEPS.includes("outreachCallCreated"),
    "§3.5: ENGAGEMENT_SUPPRESSED_STEPS must include outreachCallCreated",
  );
  check(
    ENGAGEMENT_SUPPRESSED_STEPS.includes("assignmentCompleted"),
    "§3.5: ENGAGEMENT_SUPPRESSED_STEPS must include assignmentCompleted",
  );

  // The adapter-result steps for these must be "skipped" with reason
  // "surface does not own".
  const { deps } = fakeDeps();
  const r = await recordEngagementCallResult(
    { patientScreeningId: "ps", patientExecutionCaseId: "ec", outcome: "scheduled" },
    deps,
  );
  const findStep = (name: string): CallResultExecutionStepResult | undefined =>
    r.steps.find((s) => s.step === name);
  const outreachStep = findStep("outreachCallCreated");
  const assignStep = findStep("assignmentCompleted");
  check(outreachStep?.status === "skipped", "§3.5: outreach step is skipped");
  check(outreachStep?.reason === "surface does not own", "§3.5: outreach reason canonical");
  check(assignStep?.status === "skipped", "§3.5: assignment step is skipped");
  check(assignStep?.reason === "surface does not own", "§3.5: assignment reason canonical");
}

// §4 — explicit per-outcome smoke (keeps grep-stable outcome labels
//      in the test source).
{
  const OUTCOMES = [
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
  for (const o of OUTCOMES) {
    const { deps } = fakeDeps();
    const r = await recordEngagementCallResult(
      {
        patientScreeningId: "ps-spot",
        patientExecutionCaseId: "ec-spot",
        outcome: o,
      },
      deps,
    );
    eq(r.ok, true, `§4.ok [${o}]`);
    eq(r.plan.outcome, o, `§4.outcome [${o}]`);
  }
}

if (failures.length > 0) {
  console.error("Engagement executor test FAILED:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
} else {
  console.log("Engagement executor test passed.");
}
