// recordCallResult execution adapter — fake-deps parity test
// (Batch H Step 5A).
//
// Runnable via:
//   npx tsx server/services/callResult/__tests__/recordCallResultExecutionAdapter.test.ts
//
// Drives the adapter with fake injected writers and asserts the
// correct set of dependencies is invoked for every outcome pinned in
// tests/fixtures/callResultCanonicalization.fixture.ts.
//
// No DB. No app boot. No network. No PHI.

import {
  CALL_RESULT_OUTCOMES_FIXTURE,
  CALL_RESULT_PARITY_FIXTURE,
} from "../../../../tests/fixtures/callResultCanonicalization.fixture";
import {
  executeRecordCallResult,
  CALL_RESULT_EXECUTION_STEPS,
  type CallResultExecutionDependencies,
  type CallResultExecutionStep,
  type CallResultExecutionStepResult,
  type CreateOutreachCallArgs,
  type AppendJourneyEventArgs,
  type UpdateAppointmentStatusArgs,
  type UpdateExecutionCaseEngagementArgs,
  type MarkAssignmentCompletedArgs,
  type UpsertTriageCaseArgs,
  type CreateFollowUpTaskArgs,
} from "../recordCallResultExecutionAdapter";

const failures: string[] = [];
function check(cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}
function eq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    failures.push(`${label}: expected ${String(expected)} got ${String(actual)}`);
  }
}

type CallLog = {
  createOutreachCall: CreateOutreachCallArgs[];
  appendJourneyEvent: AppendJourneyEventArgs[];
  updateAppointmentStatus: UpdateAppointmentStatusArgs[];
  updateExecutionCaseEngagement: UpdateExecutionCaseEngagementArgs[];
  markAssignmentCompleted: MarkAssignmentCompletedArgs[];
  upsertTriageCase: UpsertTriageCaseArgs[];
  createFollowUpTask: CreateFollowUpTaskArgs[];
};

function makeFakeDeps(): { deps: CallResultExecutionDependencies; log: CallLog } {
  const log: CallLog = {
    createOutreachCall: [],
    appendJourneyEvent: [],
    updateAppointmentStatus: [],
    updateExecutionCaseEngagement: [],
    markAssignmentCompleted: [],
    upsertTriageCase: [],
    createFollowUpTask: [],
  };
  const deps: CallResultExecutionDependencies = {
    createOutreachCall: (args) => {
      log.createOutreachCall.push(args);
    },
    appendJourneyEvent: (args) => {
      log.appendJourneyEvent.push(args);
    },
    updateAppointmentStatus: (args) => {
      log.updateAppointmentStatus.push(args);
    },
    updateExecutionCaseEngagement: (args) => {
      log.updateExecutionCaseEngagement.push(args);
    },
    markAssignmentCompleted: (args) => {
      log.markAssignmentCompleted.push(args);
    },
    upsertTriageCase: (args) => {
      log.upsertTriageCase.push(args);
    },
    createFollowUpTask: (args) => {
      log.createFollowUpTask.push(args);
    },
  };
  return { deps, log };
}

function findStep(
  steps: CallResultExecutionStepResult[],
  name: CallResultExecutionStep,
): CallResultExecutionStepResult {
  const found = steps.find((s) => s.step === name);
  if (!found) throw new Error(`step "${name}" not in adapter result`);
  return found;
}

// ─── §0: planner outcome catalog matches the fixture ──────────────
{
  check(
    CALL_RESULT_OUTCOMES_FIXTURE.length === 10,
    `§0: expected 10 outcomes in fixture, got ${CALL_RESULT_OUTCOMES_FIXTURE.length}`,
  );
}

// ─── §1: For every fixture outcome (both source surfaces), the
//        adapter calls exactly the expected dependency set ─────────
{
  const SOURCES = ["outreach_call_route", "engagement_center_route"] as const;
  for (const env of CALL_RESULT_PARITY_FIXTURE) {
    for (const source of SOURCES) {
      const { deps, log } = makeFakeDeps();
      const result = await executeRecordCallResult(
        {
          patientScreeningId: "fixture-screening-id",
          outcome: env.outcome,
          sourceSurface: source,
          callbackAt: env.executionCaseNextActionAtRequired
            ? "2026-06-10T18:00:00.000Z"
            : null,
          patientExecutionCaseId: "fixture-execution-case-id",
          schedulerAssignmentId: "fixture-assignment-id",
        },
        deps,
      );

      // ok=true expected — no fake dep throws.
      eq(result.ok, true, `§1.ok [${env.outcome}/${source}]`);

      // Always-on steps: outreach + journey + appointment status.
      eq(log.createOutreachCall.length, 1, `§1.outreach [${env.outcome}/${source}]`);
      eq(log.appendJourneyEvent.length, 1, `§1.journey [${env.outcome}/${source}]`);
      eq(log.updateAppointmentStatus.length, 1, `§1.apptStatus [${env.outcome}/${source}]`);

      // Journey event type is canonical.
      const je = log.appendJourneyEvent[0];
      eq(je.eventType, "call_result_logged", `§1.journeyType [${env.outcome}/${source}]`);
      eq(je.outcome, env.outcome, `§1.journeyOutcome [${env.outcome}/${source}]`);
      eq(je.sourceSurface, source, `§1.journeySource [${env.outcome}/${source}]`);

      // Appointment status is the planner-derived value.
      eq(
        log.updateAppointmentStatus[0].appointmentStatus,
        env.appointmentStatus,
        `§1.apptStatusValue [${env.outcome}/${source}]`,
      );

      // Execution case update fires only when planner emits a status
      // transition AND the caller supplied an execution case id (we did).
      if (env.executionCaseEngagementStatus !== null) {
        eq(
          log.updateExecutionCaseEngagement.length,
          1,
          `§1.ecUpdated [${env.outcome}/${source}]`,
        );
        eq(
          log.updateExecutionCaseEngagement[0].engagementStatus,
          env.executionCaseEngagementStatus,
          `§1.ecStatus [${env.outcome}/${source}]`,
        );
      } else {
        eq(log.updateExecutionCaseEngagement.length, 0, `§1.ecNotUpdated [${env.outcome}/${source}]`);
      }

      // Assignment completion fires iff terminal.
      eq(
        log.markAssignmentCompleted.length,
        env.assignmentCompleted ? 1 : 0,
        `§1.assignment [${env.outcome}/${source}]`,
      );

      // Triage upsert fires iff triageCaseRequired.
      eq(
        log.upsertTriageCase.length,
        env.triageCaseRequired ? 1 : 0,
        `§1.triage [${env.outcome}/${source}]`,
      );

      // Follow-up task fires iff followUpTaskRequired.
      eq(
        log.createFollowUpTask.length,
        env.followUpTaskRequired ? 1 : 0,
        `§1.task [${env.outcome}/${source}]`,
      );
    }
  }
}

// ─── §2: Callback-style outcomes propagate callbackAt + nextActionAt ─
for (const outcome of ["callback", "no_answer", "voicemail"] as const) {
  const { deps, log } = makeFakeDeps();
  const result = await executeRecordCallResult(
    {
      patientScreeningId: "x",
      outcome,
      sourceSurface: "engagement_center_route",
      callbackAt: "2026-06-10T18:00:00.000Z",
      patientExecutionCaseId: "ec-x",
    },
    deps,
  );
  check(result.plan.callbackAt instanceof Date, `§2.callback [${outcome}] callbackAt`);
  check(
    log.updateExecutionCaseEngagement.length === 1 &&
      log.updateExecutionCaseEngagement[0].nextActionAt instanceof Date,
    `§2.callback [${outcome}] nextActionAt on EC update`,
  );
  check(
    log.upsertTriageCase.length === 1 && log.upsertTriageCase[0].callbackAt instanceof Date,
    `§2.callback [${outcome}] callbackAt on triage upsert`,
  );
}

// ─── §3: Terminal outcomes mark assignment completed ──────────────
for (const outcome of ["scheduled", "declined"] as const) {
  const { deps, log } = makeFakeDeps();
  const result = await executeRecordCallResult(
    {
      patientScreeningId: "x",
      outcome,
      sourceSurface: "outreach_call_route",
      schedulerAssignmentId: "asg-x",
    },
    deps,
  );
  eq(result.ok, true, `§3.ok [${outcome}]`);
  eq(log.markAssignmentCompleted.length, 1, `§3.assignment [${outcome}]`);
  eq(log.markAssignmentCompleted[0].schedulerAssignmentId, "asg-x", `§3.asgId [${outcome}]`);
  eq(log.upsertTriageCase.length, 0, `§3.noTriage [${outcome}]`);
  eq(log.createFollowUpTask.length, 0, `§3.noTask [${outcome}]`);
}

// ─── §4: Task-required outcomes invoke the task writer with taskType ─
for (const outcome of [
  "needs_records",
  "insurance_prior_auth_issue",
  "manager_review",
  "facility_specific_issue",
] as const) {
  const { deps, log } = makeFakeDeps();
  await executeRecordCallResult(
    {
      patientScreeningId: "x",
      outcome,
      sourceSurface: "engagement_center_route",
      patientExecutionCaseId: "ec-x",
    },
    deps,
  );
  eq(log.createFollowUpTask.length, 1, `§4.task [${outcome}]`);
  eq(log.createFollowUpTask[0].taskType, outcome, `§4.taskType [${outcome}]`);
  eq(log.upsertTriageCase.length, 0, `§4.noTriage [${outcome}]`);
}

// ─── §5: Triage-required outcomes invoke the triage writer with triageType ─
{
  const expected: Record<string, string> = {
    callback: "callback_scheduled",
    no_answer: "no_answer",
    voicemail: "voicemail",
    wrong_number: "wrong_number",
  };
  for (const outcome of ["callback", "no_answer", "voicemail", "wrong_number"] as const) {
    const { deps, log } = makeFakeDeps();
    await executeRecordCallResult(
      {
        patientScreeningId: "x",
        outcome,
        sourceSurface: "outreach_call_route",
      },
      deps,
    );
    eq(log.upsertTriageCase.length, 1, `§5.triage [${outcome}]`);
    eq(log.upsertTriageCase[0].triageType, expected[outcome], `§5.triageType [${outcome}]`);
    eq(log.createFollowUpTask.length, 0, `§5.noTask [${outcome}]`);
  }
}

// ─── §6: A failing dependency surfaces as `failed` and does NOT
//        throw to the caller in best-effort mode ───────────────────
{
  const { deps, log } = makeFakeDeps();
  const failingDeps: CallResultExecutionDependencies = {
    ...deps,
    upsertTriageCase: () => {
      throw new Error("simulated upsert failure");
    },
  };
  const result = await executeRecordCallResult(
    {
      patientScreeningId: "x",
      outcome: "callback",
      sourceSurface: "engagement_center_route",
      patientExecutionCaseId: "ec-x",
    },
    failingDeps,
  );
  const triageStep = findStep(result.steps, "triageCaseUpserted");
  eq(triageStep.status, "failed", "§6: triage step failed");
  check(
    typeof triageStep.reason === "string" && triageStep.reason.includes("simulated"),
    "§6: triage step carries error reason",
  );
  eq(result.ok, false, "§6: result.ok=false when any step failed");
  // Subsequent steps still attempted in best-effort mode — the task
  // step is skipped because callback does not require a task.
  const taskStep = findStep(result.steps, "followUpTaskCreated");
  eq(taskStep.status, "skipped", "§6: task step skipped for non-task outcome");
  // The journey event still landed.
  eq(log.appendJourneyEvent.length, 1, "§6: journey event still appended in best-effort");
}

// ─── §7: Strict mode short-circuits on first failure ──────────────
{
  const { deps, log } = makeFakeDeps();
  const failingDeps: CallResultExecutionDependencies = {
    ...deps,
    createOutreachCall: () => {
      throw new Error("simulated outreach failure");
    },
  };
  const result = await executeRecordCallResult(
    {
      patientScreeningId: "x",
      outcome: "scheduled",
      sourceSurface: "outreach_call_route",
    },
    failingDeps,
    { mode: "strict" },
  );
  eq(result.steps[0].step, "outreachCallCreated", "§7: first step is outreach");
  eq(result.steps[0].status, "failed", "§7: first step failed");
  eq(result.steps.length, 1, "§7: strict mode short-circuits");
  eq(result.ok, false, "§7: strict mode result.ok=false");
  // Journey event was NOT attempted.
  eq(log.appendJourneyEvent.length, 0, "§7: journey event NOT called after strict failure");
}

// ─── §8: All seven steps appear in result, in canonical order ─────
{
  const { deps } = makeFakeDeps();
  const result = await executeRecordCallResult(
    {
      patientScreeningId: "x",
      outcome: "scheduled",
      sourceSurface: "outreach_call_route",
      patientExecutionCaseId: "ec-x",
    },
    deps,
  );
  eq(result.steps.length, CALL_RESULT_EXECUTION_STEPS.length, "§8: step count matches contract");
  for (let i = 0; i < CALL_RESULT_EXECUTION_STEPS.length; i++) {
    eq(result.steps[i].step, CALL_RESULT_EXECUTION_STEPS[i], `§8: step[${i}] order`);
  }
}

// ─── §9: PHI hygiene — adapter args carry no PHI keys ─────────────
{
  const { deps, log } = makeFakeDeps();
  await executeRecordCallResult(
    {
      patientScreeningId: "x",
      outcome: "needs_records",
      sourceSurface: "engagement_center_route",
      patientExecutionCaseId: "ec-x",
    },
    deps,
  );
  const PHI_KEYS = ["patientName", "patientDob", "mrn", "ssn", "phone", "phoneE164"];
  function noPhi(args: Record<string, unknown>, label: string) {
    for (const k of PHI_KEYS) {
      if (k in args) {
        failures.push(`§9: ${label} args expose PHI key "${k}"`);
      }
    }
  }
  noPhi(log.createOutreachCall[0] as unknown as Record<string, unknown>, "createOutreachCall");
  noPhi(log.appendJourneyEvent[0] as unknown as Record<string, unknown>, "appendJourneyEvent");
  noPhi(log.updateAppointmentStatus[0] as unknown as Record<string, unknown>, "updateAppointmentStatus");
  noPhi(
    log.updateExecutionCaseEngagement[0] as unknown as Record<string, unknown>,
    "updateExecutionCaseEngagement",
  );
  noPhi(log.createFollowUpTask[0] as unknown as Record<string, unknown>, "createFollowUpTask");
}

if (failures.length > 0) {
  console.error("recordCallResult execution adapter test FAILED:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
} else {
  console.log("recordCallResult execution adapter test passed.");
}
