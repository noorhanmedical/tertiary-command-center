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

// §3.6 — Ownership write-through (Batch 2 of arg-extensions run).
{
  // Caller supplies ownership fields → executor forwards them to the
  // updateExecutionCaseEngagement dep + surfaces ownershipPlanned/
  // ownershipUpdated on the response.
  const { deps, log } = fakeDeps();
  const r = await recordEngagementCallResult(
    {
      patientScreeningId: "ps",
      patientExecutionCaseId: "ec",
      outcome: "scheduled",
      assignedTeamMemberId: "tm-7",
      assignedRole: "scheduler",
      forceReassign: true,
    },
    deps,
  );
  eq(r.ownershipPlanned, true, "§3.6: ownershipPlanned true");
  eq(r.ownershipUpdated, true, "§3.6: ownershipUpdated true when EC step ran");
  // Dep received the ownership fields.
  eq(log.updateExecutionCaseEngagement.length, 1, "§3.6: ec dep called");
  const ecCall = log.updateExecutionCaseEngagement[0] as Record<string, unknown>;
  eq(ecCall.assignedTeamMemberId, "tm-7", "§3.6: assignedTeamMemberId forwarded");
  eq(ecCall.assignedRole, "scheduler", "§3.6: assignedRole forwarded");
  eq(ecCall.forceReassign, true, "§3.6: forceReassign forwarded");
}

// §3.7 — When ownership not supplied, response flags are false.
{
  const { deps } = fakeDeps();
  const r = await recordEngagementCallResult(
    { patientScreeningId: "ps", patientExecutionCaseId: "ec", outcome: "scheduled" },
    deps,
  );
  eq(r.ownershipPlanned, false, "§3.7: ownershipPlanned false when no fields supplied");
  eq(r.ownershipUpdated, false, "§3.7: ownershipUpdated false when not planned");
}

// §3.8 — ownershipUpdated is false if planned but EC step did NOT run.
{
  const { deps } = fakeDeps();
  // Patient has no execution case id → EC step is skipped by adapter.
  const r = await recordEngagementCallResult(
    {
      patientScreeningId: "ps",
      patientExecutionCaseId: null,
      outcome: "scheduled",
      assignedTeamMemberId: "tm-99",
    },
    deps,
  );
  eq(r.ownershipPlanned, true, "§3.8: ownershipPlanned true");
  eq(r.ownershipUpdated, false, "§3.8: ownershipUpdated false because EC step skipped");
}

// §3.9 — Journey-event metadata + PHI passthrough (Batch 3).
{
  const { deps, log } = fakeDeps();
  const meta = { callDisposition: "ok", facilityId: "f-1" };
  const r = await recordEngagementCallResult(
    {
      patientScreeningId: "ps",
      patientExecutionCaseId: "ec",
      outcome: "scheduled",
      journeyEventMetadata: meta,
      patientName: "Closure Captured",
      patientDob: "1980-05-15",
    },
    deps,
  );
  eq(r.ok, true, "§3.9: ok");
  eq(log.appendJourneyEvent.length, 1, "§3.9: journey dep called");
  const je = log.appendJourneyEvent[0] as Record<string, unknown>;
  // Metadata bag forwarded.
  const jeMeta = je.metadata as Record<string, unknown>;
  eq(jeMeta?.callDisposition, "ok", "§3.9: journey metadata callDisposition");
  eq(jeMeta?.facilityId, "f-1", "§3.9: journey metadata facilityId");
  // PHI fields forwarded to dep boundary.
  eq(je.patientName, "Closure Captured", "§3.9: patientName forwarded to dep");
  eq(je.patientDob, "1980-05-15", "§3.9: patientDob forwarded to dep");
}

// §3.10 — When metadata + PHI not supplied, dep does NOT receive them.
{
  const { deps, log } = fakeDeps();
  await recordEngagementCallResult(
    { patientScreeningId: "ps", patientExecutionCaseId: "ec", outcome: "scheduled" },
    deps,
  );
  const je = log.appendJourneyEvent[0] as Record<string, unknown>;
  check(!("metadata" in je) || je.metadata === undefined, "§3.10: metadata not added when input absent");
  check(!("patientName" in je), "§3.10: patientName not added when input absent");
  check(!("patientDob" in je), "§3.10: patientDob not added when input absent");
}

// §3.11 — Triage payload passthrough (Batch 4 of arg-extensions run).
{
  const { deps, log } = fakeDeps();
  await recordEngagementCallResult(
    {
      patientScreeningId: "ps",
      patientExecutionCaseId: "ec",
      outcome: "callback",
      triageMainType: "callback",
      triageSubtype: "patient_requested_call_later",
      triagePriority: "high",
      triageAssignedUserId: "u-7",
      triageDueAt: "2026-06-12T09:00:00Z",
      triageNote: "test note (PHI may live here)",
      triageMetadata: { createdSource: "scheduler_call_result" },
    },
    deps,
  );
  eq(log.upsertTriageCase.length, 1, "§3.11: triage dep called");
  const tc = log.upsertTriageCase[0] as Record<string, unknown>;
  eq(tc.mainType, "callback", "§3.11: mainType forwarded");
  eq(tc.subtype, "patient_requested_call_later", "§3.11: subtype forwarded");
  eq(tc.priority, "high", "§3.11: priority forwarded");
  eq(tc.assignedUserId, "u-7", "§3.11: assignedUserId forwarded");
  eq(tc.dueAt, "2026-06-12T09:00:00Z", "§3.11: dueAt forwarded");
  eq(tc.note, "test note (PHI may live here)", "§3.11: note forwarded");
  const md = tc.metadata as Record<string, unknown>;
  eq(md?.createdSource, "scheduler_call_result", "§3.11: triage metadata forwarded");
}

// §3.12 — When triage payload not supplied, dep does not receive
//         those keys.
{
  const { deps, log } = fakeDeps();
  await recordEngagementCallResult(
    { patientScreeningId: "ps", patientExecutionCaseId: "ec", outcome: "callback" },
    deps,
  );
  const tc = log.upsertTriageCase[0] as Record<string, unknown>;
  check(!("mainType" in tc), "§3.12: mainType not added when input absent");
  check(!("priority" in tc), "§3.12: priority not added when input absent");
  check(!("note" in tc), "§3.12: note not added when input absent");
}

// §3.13 — Task payload passthrough (Batch 5 of arg-extensions run).
{
  const { deps, log } = fakeDeps();
  await recordEngagementCallResult(
    {
      patientScreeningId: "ps",
      patientExecutionCaseId: "ec",
      outcome: "needs_records",
      taskTitle: "Custom title",
      taskDescription: "Custom desc",
      taskPriority: "high",
      taskUrgency: "EOD",
      taskAssignedToUserId: "u-1",
      taskDueAt: "2026-06-12T15:00:00Z",
      taskMetadata: { createdSource: "scheduler_call_result" },
    },
    deps,
  );
  eq(log.createFollowUpTask.length, 1, "§3.13: task dep called");
  const t = log.createFollowUpTask[0] as Record<string, unknown>;
  eq(t.title, "Custom title", "§3.13: title forwarded");
  eq(t.description, "Custom desc", "§3.13: description forwarded");
  eq(t.priority, "high", "§3.13: priority forwarded");
  eq(t.urgency, "EOD", "§3.13: urgency forwarded");
  eq(t.assignedToUserId, "u-1", "§3.13: assignedToUserId forwarded");
  eq(t.dueAt, "2026-06-12T15:00:00Z", "§3.13: dueAt forwarded");
  const md = t.metadata as Record<string, unknown>;
  eq(md?.createdSource, "scheduler_call_result", "§3.13: task metadata forwarded");
}

// §3.14 — When task payload not supplied, dep does not receive them.
{
  const { deps, log } = fakeDeps();
  await recordEngagementCallResult(
    { patientScreeningId: "ps", patientExecutionCaseId: "ec", outcome: "needs_records" },
    deps,
  );
  const t = log.createFollowUpTask[0] as Record<string, unknown>;
  check(!("title" in t), "§3.14: title not added when input absent");
  check(!("priority" in t), "§3.14: priority not added when input absent");
  check(!("urgency" in t), "§3.14: urgency not added when input absent");
}

// §3.15 — callbackHours option (Batch 6 of arg extensions run).
//         Engagement executor forwards options.callbackHours to the
//         adapter, which feeds it into the planner's callback
//         fallback for callback-style outcomes.
{
  const { deps } = fakeDeps();
  const r = await recordEngagementCallResult(
    {
      patientScreeningId: "ps",
      patientExecutionCaseId: "ec",
      outcome: "callback",
      // No callbackAt — relies on callbackHours.
    },
    deps,
    { callbackHours: 24 },
  );
  check(r.plan.callbackAt instanceof Date, "§3.15: callbackAt populated via callbackHours");
  if (r.plan.callbackAt) {
    const diff = Math.abs(r.plan.callbackAt.getTime() - (Date.now() + 24 * 60 * 60 * 1000));
    check(diff < 5 * 60 * 1000, "§3.15: callbackAt close to now+24h");
  }
}

// §3.16 — engagementStatusSemantics forwarding (Batch 1 of Engagement
//         completion run). Coarse mode collapses callback to in_progress.
{
  const { deps } = fakeDeps();
  const r = await recordEngagementCallResult(
    {
      patientScreeningId: "ps",
      patientExecutionCaseId: "ec",
      outcome: "callback",
    },
    deps,
    { engagementStatusSemantics: "coarse" },
  );
  eq(r.plan.executionCaseEngagementStatus, "in_progress", "§3.16: coarse callback collapsed via executor");
}
{
  // Canonical mode preserved.
  const { deps } = fakeDeps();
  const r = await recordEngagementCallResult(
    {
      patientScreeningId: "ps",
      patientExecutionCaseId: "ec",
      outcome: "no_answer",
    },
    deps,
    { engagementStatusSemantics: "canonical" },
  );
  eq(r.plan.executionCaseEngagementStatus, "not_reached", "§3.16: canonical no_answer preserved via executor");
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

// §5 — Canonical call-record closeout: createDurableCallRecord opt-in
//      un-suppresses outreachCallCreated so the engagement surface owns
//      exactly ONE durable call record. assignmentCompleted stays
//      suppressed. Default (opt-out) preserves legacy suppression.
{
  // Opt-IN: outreachCallCreated runs (createOutreachCall dep called once),
  // assignmentCompleted still skipped.
  const { deps, log } = fakeDeps();
  const r = await recordEngagementCallResult(
    {
      patientScreeningId: "ps",
      patientExecutionCaseId: "ec",
      outcome: "no_answer",
      createDurableCallRecord: true,
    },
    deps,
  );
  eq(log.createOutreachCall.length, 1, "§5: durable record → createOutreachCall called exactly once");
  eq(log.createOutreachCall[0].sourceSurface, "engagement_center_route", "§5: source surface set");
  const outreachStep = r.steps.find((s) => s.step === "outreachCallCreated");
  eq(outreachStep?.status, "ran", "§5: outreachCallCreated ran under opt-in");
  const assignStep = r.steps.find((s) => s.step === "assignmentCompleted");
  eq(assignStep?.status, "skipped", "§5: assignmentCompleted still suppressed under opt-in");

  // Opt-OUT (default / false): outreachCallCreated stays suppressed.
  const { deps: deps2, log: log2 } = fakeDeps();
  const r2 = await recordEngagementCallResult(
    {
      patientScreeningId: "ps",
      patientExecutionCaseId: "ec",
      outcome: "no_answer",
      createDurableCallRecord: false,
    },
    deps2,
  );
  eq(log2.createOutreachCall.length, 0, "§5: opt-out → no durable record");
  const outreachStep2 = r2.steps.find((s) => s.step === "outreachCallCreated");
  eq(outreachStep2?.status, "skipped", "§5: outreachCallCreated skipped when opt-out");
  eq(outreachStep2?.reason, "surface does not own", "§5: skip reason canonical when opt-out");
}

if (failures.length > 0) {
  console.error("Engagement executor test FAILED:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
} else {
  console.log("Engagement executor test passed.");
}
