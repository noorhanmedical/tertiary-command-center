import { describe, it } from "vitest";
// recordCallResult — parity test (Batch H Step 1).
//
// Runnable via:
//   npx tsx server/services/callResult/__tests__/recordCallResult-parity.test.ts
//
// Exercises every pinned outcome from the Batch B fixture against
// the canonical recordCallResult planner and asserts the returned
// envelope matches the expected side-effect set.
//
// No DB. No app boot. No network. No PHI.

import {
  CALL_RESULT_OUTCOMES_FIXTURE,
  CALL_RESULT_PARITY_FIXTURE,
} from "../../../../tests/fixtures/callResultCanonicalization.fixture";
import {
  recordCallResult,
  CALL_RESULT_OUTCOMES,
  type CallResultOutcome,
  type CallResultSourceSurface,
  type RecordCallResultOutcome,
} from "../recordCallResult";

const failures: string[] = [];
function check(cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}
function eq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    failures.push(`${label}: expected ${String(expected)} got ${String(actual)}`);
  }
}

// ─── §0: planner-side outcome catalog matches the fixture ─────────
{
  check(
    CALL_RESULT_OUTCOMES.length === CALL_RESULT_OUTCOMES_FIXTURE.length,
    `§0: planner outcome count (${CALL_RESULT_OUTCOMES.length}) must match fixture (${CALL_RESULT_OUTCOMES_FIXTURE.length})`,
  );
  for (const o of CALL_RESULT_OUTCOMES_FIXTURE) {
    check(
      (CALL_RESULT_OUTCOMES as ReadonlyArray<string>).includes(o),
      `§0: planner missing outcome "${o}"`,
    );
  }
}

// ─── §1: Every pinned outcome runs through the planner ─────────────
const SOURCES: ReadonlyArray<CallResultSourceSurface> = [
  "outreach_call_route",
  "engagement_center_route",
];

for (const env of CALL_RESULT_PARITY_FIXTURE) {
  for (const source of SOURCES) {
    const result: RecordCallResultOutcome = recordCallResult({
      patientScreeningId: "fixture-screening-id",
      outcome: env.outcome,
      sourceSurface: source,
      callbackAt: env.executionCaseNextActionAtRequired
        ? "2026-06-10T18:00:00.000Z"
        : null,
    });

    // §1.a — every outcome creates an outreach_calls row.
    eq(result.outreachCallCreated, true, `§1.a [${env.outcome}/${source}] outreachCallCreated`);
    // §1.b — appointmentStatus matches the fixture.
    eq(result.appointmentStatus, env.appointmentStatus, `§1.b [${env.outcome}/${source}] appointmentStatus`);
    // §1.c — journeyEventType is canonical.
    eq(result.journeyEventType, "call_result_logged", `§1.c [${env.outcome}/${source}] journeyEventType`);
    // §1.d — engagementStatus transition matches.
    eq(
      result.executionCaseEngagementStatus,
      env.executionCaseEngagementStatus,
      `§1.d [${env.outcome}/${source}] executionCaseEngagementStatus`,
    );
    // §1.e — assignmentCompleted matches.
    eq(result.assignmentCompleted, env.assignmentCompleted, `§1.e [${env.outcome}/${source}] assignmentCompleted`);
    // §1.f — followUpTaskRequired matches.
    eq(result.followUpTaskRequired, env.followUpTaskRequired, `§1.f [${env.outcome}/${source}] followUpTaskRequired`);
    // §1.g — triageCaseRequired matches.
    eq(result.triageCaseRequired, env.triageCaseRequired, `§1.g [${env.outcome}/${source}] triageCaseRequired`);
    // §1.h — terminal flag matches.
    eq(result.terminal, env.terminal, `§1.h [${env.outcome}/${source}] terminal`);
    // §1.i — sourceSurface echoes input.
    eq(result.sourceSurface, source, `§1.i [${env.outcome}/${source}] sourceSurface`);
    // §1.j — outcome echoes input.
    eq(result.outcome, env.outcome, `§1.j [${env.outcome}/${source}] outcome echo`);
  }
}

// ─── §2: Callback-style outcomes require a future nextActionAt ────
for (const outcome of ["callback", "no_answer", "voicemail"] as const) {
  // With explicit callbackAt.
  const withCallback = recordCallResult({
    patientScreeningId: "screening-x",
    outcome,
    sourceSurface: "engagement_center_route",
    callbackAt: "2026-06-10T18:00:00.000Z",
  });
  check(
    withCallback.executionCaseNextActionAt instanceof Date,
    `§2.a [${outcome}] executionCaseNextActionAt must be a Date when callbackAt provided`,
  );
  check(
    withCallback.callbackAt instanceof Date,
    `§2.b [${outcome}] callbackAt must be a Date when input provided`,
  );

  // Without callbackAt — planner still produces a future target so
  // the engagement-case board re-surfaces the patient.
  const withoutCallback = recordCallResult({
    patientScreeningId: "screening-x",
    outcome,
    sourceSurface: "engagement_center_route",
  });
  check(
    withoutCallback.executionCaseNextActionAt instanceof Date,
    `§2.c [${outcome}] executionCaseNextActionAt must be a Date even without explicit callbackAt`,
  );
  check(
    withoutCallback.executionCaseNextActionAt !== null &&
      withoutCallback.executionCaseNextActionAt.getTime() > Date.now() - 1000,
    `§2.d [${outcome}] executionCaseNextActionAt must be a future timestamp`,
  );
}

// ─── §3: Terminal outcomes mark assignmentCompleted ───────────────
for (const outcome of ["scheduled", "declined"] as const) {
  const r = recordCallResult({
    patientScreeningId: "screening-x",
    outcome,
    sourceSurface: "outreach_call_route",
  });
  eq(r.terminal, true, `§3.a [${outcome}] terminal`);
  eq(r.assignmentCompleted, true, `§3.b [${outcome}] assignmentCompleted`);
  eq(r.executionCaseNextActionAt, null, `§3.c [${outcome}] no nextActionAt`);
}

// ─── §4: Task-required outcomes set followUpTaskRequired + taskType ─
for (const outcome of [
  "needs_records",
  "insurance_prior_auth_issue",
  "manager_review",
  "facility_specific_issue",
] as const) {
  const r = recordCallResult({
    patientScreeningId: "screening-x",
    outcome,
    sourceSurface: "engagement_center_route",
  });
  eq(r.followUpTaskRequired, true, `§4.a [${outcome}] followUpTaskRequired`);
  eq(r.taskType, outcome, `§4.b [${outcome}] taskType`);
  eq(r.triageCaseRequired, false, `§4.c [${outcome}] no triage case`);
}

// ─── §5: Triage-required outcomes set triageCaseRequired + triageType ─
{
  const expectedTriageTypes: Record<string, string> = {
    callback: "callback_scheduled",
    no_answer: "no_answer",
    voicemail: "voicemail",
    wrong_number: "wrong_number",
  };
  for (const outcome of ["callback", "no_answer", "voicemail", "wrong_number"] as const) {
    const r = recordCallResult({
      patientScreeningId: "screening-x",
      outcome,
      sourceSurface: "outreach_call_route",
    });
    eq(r.triageCaseRequired, true, `§5.a [${outcome}] triageCaseRequired`);
    eq(r.triageType, expectedTriageTypes[outcome], `§5.b [${outcome}] triageType`);
    eq(r.followUpTaskRequired, false, `§5.c [${outcome}] no follow-up task`);
  }
}

// ─── §6: Input shape MUST NOT require PHI-shaped fields ───────────
//
// The compile-time `CanonicalCallResultInput` type is structural, so
// we probe it by constructing the minimal valid input and asserting
// the keys present are non-PHI only. (Runtime check; the type-check
// in §7 below covers the static contract.)
{
  const minimal = {
    patientScreeningId: "id",
    outcome: "scheduled" as CallResultOutcome,
    sourceSurface: "outreach_call_route" as CallResultSourceSurface,
  };
  const r = recordCallResult(minimal);
  // The returned envelope must not mention PHI-shaped keys.
  const FORBIDDEN_KEYS = ["patientName", "patientDob", "mrn", "ssn", "phone", "address"];
  for (const k of FORBIDDEN_KEYS) {
    check(!(k in r), `§6: returned envelope must not expose PHI key "${k}"`);
  }
}

// ─── §7: Type probe — RecordCallResultOutcome shape ───────────────
{
  const probe: RecordCallResultOutcome = recordCallResult({
    patientScreeningId: "id",
    outcome: "scheduled",
    sourceSurface: "engagement_center_route",
  });
  void probe;
}

// ─── §8: Unknown outcome must throw ────────────────────────────────
{
  let threw = false;
  try {
    recordCallResult({
      patientScreeningId: "id",
      // @ts-expect-error — intentional: testing runtime guard.
      outcome: "not-a-real-outcome",
      sourceSurface: "outreach_call_route",
    });
  } catch (_e) {
    threw = true;
  }
  check(threw, `§8: unknown outcome must throw`);
}

describe("recordCallResult parity test", () => {
  it("passes all checks", () => {
    if (failures.length > 0) {
      throw new Error(
        "recordCallResult parity test failed:" + "\n" + failures.map((f) => `- ${f}`).join("\n"),
      );
    }
  });
});
