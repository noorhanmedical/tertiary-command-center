// Outreach response-shape parity test (Batch 15).

import {
  OUTREACH_CALL_RESULT_RESPONSE_CONTRACT,
  OUTREACH_ONLY_OUTCOMES,
} from "../../../../tests/fixtures/outreachCallResultResponseShape.fixture";

const failures: string[] = [];
function check(c: boolean, m: string) { if (!c) failures.push(m); }
function eq<T>(a: T, b: T, label: string) {
  if (a !== b) failures.push(`${label}: expected ${String(b)} got ${String(a)}`);
}

// §1 — Contract values.
eq(OUTREACH_CALL_RESULT_RESPONSE_CONTRACT.httpStatus, 201, "§1: httpStatus 201");
eq(OUTREACH_CALL_RESULT_RESPONSE_CONTRACT.envelope, "raw_row", "§1: envelope raw_row");
eq(OUTREACH_CALL_RESULT_RESPONSE_CONTRACT.wrapperKey, null, "§1: wrapperKey null");

// §2 — Outreach-only outcomes are listed.
check(OUTREACH_ONLY_OUTCOMES.length >= 10, `§2: at least 10 outreach-only outcomes, got ${OUTREACH_ONLY_OUTCOMES.length}`);
check(OUTREACH_ONLY_OUTCOMES.includes("wants_more_info"), `§2: includes wants_more_info`);
check(OUTREACH_ONLY_OUTCOMES.includes("reached"), `§2: includes reached`);
check(OUTREACH_ONLY_OUTCOMES.includes("language_barrier"), `§2: includes language_barrier`);

if (failures.length > 0) {
  console.error("Outreach response-shape test FAILED:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Outreach response-shape test passed.");
