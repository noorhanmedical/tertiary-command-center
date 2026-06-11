// Outreach executor — fake-deps test (Batch 14).

import {
  recordOutreachCallResult,
  OUTREACH_OWNED_STEPS,
  OUTREACH_SUPPRESSED_STEPS,
  type OutreachCallResultInput,
} from "../recordCallResultOutreachExecutor";
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
function check(c: boolean, m: string) { if (!c) failures.push(m); }
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
  return {
    log,
    deps: {
      createOutreachCall: (a) => { log.createOutreachCall.push(a); },
      appendJourneyEvent: (a) => { log.appendJourneyEvent.push(a); },
      updateAppointmentStatus: (a) => { log.updateAppointmentStatus.push(a); },
      updateExecutionCaseEngagement: (a) => { log.updateExecutionCaseEngagement.push(a); },
      markAssignmentCompleted: (a) => { log.markAssignmentCompleted.push(a); },
      upsertTriageCase: (a) => { log.upsertTriageCase.push(a); },
      createFollowUpTask: (a) => { log.createFollowUpTask.push(a); },
    },
  };
}

// §1 — Every fixture outcome runs.
for (const env of CALL_RESULT_PARITY_FIXTURE) {
  const { deps, log } = fakeDeps();
  const input: OutreachCallResultInput = {
    patientScreeningId: "ps-1",
    outcome: env.outcome,
    callbackAt: env.executionCaseNextActionAtRequired ? "2026-06-10T18:00:00.000Z" : null,
  };
  const r = await recordOutreachCallResult(input, deps);
  eq(r.ok, true, `§1.ok [${env.outcome}]`);
  // Source surface canonicalized.
  eq(log.createOutreachCall.length, 1, `§1.outreach [${env.outcome}]`);
  eq(log.createOutreachCall[0].sourceSurface, "outreach_call_route", `§1.surface [${env.outcome}]`);
  // Assignment completion follows the fixture.
  eq(
    log.markAssignmentCompleted.length,
    env.assignmentCompleted ? 1 : 0,
    `§1.assignment [${env.outcome}]`,
  );
}

// §2 — Outreach-owned step list excludes engagement-only steps.
check(
  OUTREACH_OWNED_STEPS.includes("outreachCallCreated"),
  "§2: outreach-owned includes outreachCallCreated",
);
check(
  OUTREACH_OWNED_STEPS.includes("appointmentStatusUpdated"),
  "§2: outreach-owned includes appointmentStatusUpdated",
);
check(
  OUTREACH_OWNED_STEPS.includes("assignmentCompleted"),
  "§2: outreach-owned includes assignmentCompleted",
);
check(
  !OUTREACH_OWNED_STEPS.includes("journeyEventAppended" as never),
  "§2: outreach-owned must not advertise journey event",
);
check(
  !OUTREACH_OWNED_STEPS.includes("triageCaseUpserted" as never),
  "§2: outreach-owned must not advertise triage upsert",
);
check(
  !OUTREACH_OWNED_STEPS.includes("followUpTaskCreated" as never),
  "§2: outreach-owned must not advertise follow-up task",
);

// §2.5 — OUTREACH_SUPPRESSED_STEPS contract.
{
  for (const s of ["journeyEventAppended", "executionCaseUpdated", "triageCaseUpserted", "followUpTaskCreated"]) {
    check(
      (OUTREACH_SUPPRESSED_STEPS as ReadonlyArray<string>).includes(s),
      `§2.5: OUTREACH_SUPPRESSED_STEPS must include ${s}`,
    );
  }

  // Adapter-result steps for these MUST be "skipped" with the canonical reason.
  const { deps, log } = fakeDeps();
  const r = await recordOutreachCallResult(
    { patientScreeningId: "ps", outcome: "callback", patientExecutionCaseId: "ec" },
    deps,
  );
  for (const stepName of OUTREACH_SUPPRESSED_STEPS) {
    const stepResult = r.steps.find((s) => s.step === stepName);
    check(stepResult?.status === "skipped", `§2.5: ${stepName} skipped on outreach`);
    check(stepResult?.reason === "surface does not own", `§2.5: ${stepName} reason canonical`);
  }
  // None of the suppressed deps were called.
  eq(log.appendJourneyEvent.length, 0, "§2.5: journey dep not called");
  eq(log.updateExecutionCaseEngagement.length, 0, "§2.5: ec dep not called");
  eq(log.upsertTriageCase.length, 0, "§2.5: triage dep not called");
  eq(log.createFollowUpTask.length, 0, "§2.5: task dep not called");
  // Outreach call insert + appt status update + assignment (when terminal)
  // still ran — those are owned by outreach.
  eq(log.createOutreachCall.length, 1, "§2.5: outreach dep called");
  eq(log.updateAppointmentStatus.length, 1, "§2.5: appt status dep called");
}

// §3 — Missing patientScreeningId throws.
{
  let threw = false;
  const { deps } = fakeDeps();
  try {
    await recordOutreachCallResult(
      // @ts-expect-error — intentional runtime guard test.
      { outcome: "scheduled" },
      deps,
    );
  } catch { threw = true; }
  check(threw, "§3: missing patientScreeningId throws");
}

// §4 — Explicit per-outcome smoke (keeps grep-stable labels).
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
    const r = await recordOutreachCallResult({ patientScreeningId: "ps-spot", outcome: o }, deps);
    eq(r.ok, true, `§4.ok [${o}]`);
    eq(r.plan.outcome, o, `§4.outcome [${o}]`);
  }
}

if (failures.length > 0) {
  console.error("Outreach executor test FAILED:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Outreach executor test passed.");
