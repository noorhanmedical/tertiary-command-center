import { describe, it } from "vitest";
// Call-result canonicalization — parity test (Batch B).
//
// Runnable via:
//   npx tsx server/services/__tests__/callResultCanonicalization-parity.test.ts
//
// Asserts the call-result parity fixture defines side-effect
// envelopes for every documented outcome and that those envelopes
// satisfy the consistency invariants the future recordCallResult
// service will rely on.
//
// No DB. No app boot. No network. No PHI.

import {
  CALL_RESULT_OUTCOMES_FIXTURE,
  CALL_RESULT_PARITY_FIXTURE,
  type CallResultOutcomeFixture,
} from "../../../tests/fixtures/callResultCanonicalization.fixture";

const failures: string[] = [];
function check(cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}
function eq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    failures.push(`${label}: expected ${String(expected)} got ${String(actual)}`);
  }
}

// ─── §1: All ten outcomes from the spec are present ───────────────
check(
  CALL_RESULT_OUTCOMES_FIXTURE.length === 15,
  `§1: expected 15 outcomes (10 canonical + 5 outreach-only terminals), got ${CALL_RESULT_OUTCOMES_FIXTURE.length}`,
);
for (const expected of [
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
]) {
  check(
    (CALL_RESULT_OUTCOMES_FIXTURE as ReadonlyArray<string>).includes(expected),
    `§1: outcome "${expected}" must be in CALL_RESULT_OUTCOMES_FIXTURE`,
  );
}

// ─── §2: Every outcome has an envelope ────────────────────────────
const byOutcome = new Map(
  CALL_RESULT_PARITY_FIXTURE.map((env) => [env.outcome, env]),
);
for (const outcome of CALL_RESULT_OUTCOMES_FIXTURE) {
  check(
    byOutcome.has(outcome),
    `§2: outcome "${outcome}" must have a parity envelope`,
  );
}

// ─── §3: Every envelope creates an outreach_calls row ─────────────
for (const env of CALL_RESULT_PARITY_FIXTURE) {
  eq(
    env.outreachCallCreated,
    true,
    `§3: outcome "${env.outcome}" outreachCallCreated`,
  );
}

// ─── §4: Every envelope appends a call_result_logged journey event ─
for (const env of CALL_RESULT_PARITY_FIXTURE) {
  eq(
    env.journeyEventType,
    "call_result_logged",
    `§4: outcome "${env.outcome}" journeyEventType`,
  );
}

// ─── §5: Terminal ↔ assignmentCompleted consistency ───────────────
for (const env of CALL_RESULT_PARITY_FIXTURE) {
  if (env.terminal) {
    eq(
      env.assignmentCompleted,
      true,
      `§5: terminal outcome "${env.outcome}" must mark assignmentCompleted`,
    );
  } else {
    eq(
      env.assignmentCompleted,
      false,
      `§5: non-terminal outcome "${env.outcome}" must not mark assignmentCompleted`,
    );
  }
}

// ─── §6: scheduled + declined are the canonical terminal outcomes ─
{
  const terminal = CALL_RESULT_PARITY_FIXTURE.filter((env) => env.terminal).map(
    (env) => env.outcome,
  );
  const terminalSet = new Set<string>(terminal);
  check(
    terminalSet.has("scheduled"),
    `§6: "scheduled" must be terminal (closes the assignment)`,
  );
  check(
    terminalSet.has("declined"),
    `§6: "declined" must be terminal (closes the assignment)`,
  );
}

// ─── §7: Callback-style outcomes set nextActionAt ─────────────────
//
// Callback-style outcomes (callback, no_answer, voicemail) MUST
// require the engagement-case nextActionAt to be set to a future
// time so the assignee comes back to the patient.
{
  for (const outcome of ["callback", "no_answer", "voicemail"] as const) {
    const env = byOutcome.get(outcome)!;
    eq(
      env.executionCaseNextActionAtRequired,
      true,
      `§7: outcome "${outcome}" must require nextActionAt`,
    );
  }
}

// ─── §8: Outcomes in CALL_RESULTS_NEEDING_TASK require follow-up ──
//
// Mirrors the executionCases.ts:332-350 set.
{
  for (const outcome of [
    "needs_records",
    "insurance_prior_auth_issue",
    "manager_review",
    "facility_specific_issue",
  ] as const) {
    const env = byOutcome.get(outcome)!;
    eq(
      env.followUpTaskRequired,
      true,
      `§8: outcome "${outcome}" must require follow-up task`,
    );
  }
}

// ─── §9: Triage-case outcomes open scheduling_triage_cases ────────
//
// Per executionCases.ts:65-86 triage mapping: callback,
// no_answer, voicemail, wrong_number.
{
  for (const outcome of [
    "callback",
    "no_answer",
    "voicemail",
    "wrong_number",
  ] as const) {
    const env = byOutcome.get(outcome)!;
    eq(
      env.triageCaseRequired,
      true,
      `§9: outcome "${outcome}" must open triage case`,
    );
  }
}

// ─── §10: appointmentStatus mappings exercise the canonical set ──
//
// At minimum the fixture must produce the four canonical
// appointmentStatus values the route currently writes: scheduled,
// no_answer, declined, callback, in_progress.
{
  const expectedStatuses = new Set<string>([
    "scheduled",
    "no_answer",
    "declined",
    "callback",
    "in_progress",
  ]);
  const actualStatuses = new Set(
    CALL_RESULT_PARITY_FIXTURE.map((env) => env.appointmentStatus),
  );
  for (const s of expectedStatuses) {
    check(
      actualStatuses.has(s),
      `§10: appointmentStatus "${s}" must be exercised by at least one outcome`,
    );
  }
}

// ─── §11: Type probe ─────────────────────────────────────────────
const _typeProbe: CallResultOutcomeFixture = "callback";
void _typeProbe;

describe("Call-result canonicalization parity test", () => {
  it("passes all checks", () => {
    if (failures.length > 0) {
      throw new Error(
        "Call-result canonicalization parity test failed:" + "\n" + failures.map((f) => `- ${f}`).join("\n"),
      );
    }
  });
});
