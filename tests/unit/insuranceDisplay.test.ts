// Unit tests for the presentation-layer insurance normalizer.
//   npx tsx tests/unit/insuranceDisplay.test.ts

import assert from "node:assert/strict";
import {
  normalizeInsuranceDisplay,
} from "../../client/src/components/patient-directory/insuranceDisplay";

let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`ok  ${name}`); }
  catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).message}`); }
}

const RAW = "[INS-Primary] Type: ANSI-Commercial | Member: LCB839985816 | Group: P14602 | Rel: self | Status: active | Since: 2024-09-01";

test("parses the legacy raw string into readable fields", () => {
  const n = normalizeInsuranceDisplay(RAW);
  assert.equal(n.hasData, true);
  assert.equal(n.priority, "Primary");
  assert.equal(n.planType, "Commercial");
  assert.equal(n.memberId, "LCB839985816");
  assert.equal(n.groupNumber, "P14602");
  assert.equal(n.relationship, "Self");
  assert.equal(n.coverageStatus, "Active");
  assert.equal(n.effectiveSince, "Sep 1, 2024");
  assert.equal(n.planLabel, "Primary Commercial Plan");
});

test("strips technical prefixes and does not leak raw tokens into fields", () => {
  const n = normalizeInsuranceDisplay(RAW);
  for (const f of n.fields) {
    assert.ok(!/INS-Primary|ANSI|Rel:|\|/.test(f.value), `leaked token in "${f.value}"`);
  }
  // Ordered, readable field labels.
  assert.deepEqual(
    n.fields.map((f) => f.label),
    ["Insurance", "Member ID", "Group Number", "Relationship", "Coverage Status", "Effective Since"],
  );
});

test("summary line is concise (type + member when no payer name)", () => {
  const n = normalizeInsuranceDisplay(RAW);
  assert.equal(n.summaryLine, "Commercial • Member LCB839985816");
});

test("detects a known payer name and surfaces it", () => {
  const n = normalizeInsuranceDisplay("Aetna");
  assert.equal(n.planLabel, "Aetna");
  assert.equal(n.summaryLine, "Aetna");
});

test("known payer + type produces 'Payer • Type' summary", () => {
  const n = normalizeInsuranceDisplay("[INS-Primary] Type: ANSI-Commercial | Member: X1 (Aetna)");
  assert.equal(n.summaryLine, "Aetna • Commercial");
});

test("structured fields win over the raw string", () => {
  const n = normalizeInsuranceDisplay(RAW, { payerName: "Cigna", memberId: "OVERRIDE1" });
  assert.equal(n.planLabel, "Cigna");
  assert.equal(n.memberId, "OVERRIDE1");
  assert.equal(n.summaryLine, "Cigna • Commercial");
});

test("empty / null input yields no data and an em-dash summary", () => {
  for (const v of [null, undefined, "", "   "]) {
    const n = normalizeInsuranceDisplay(v as string | null);
    assert.equal(n.hasData, false);
    assert.equal(n.summaryLine, "—");
    assert.equal(n.fields.length, 0);
  }
});

test("ANSI-Medicare normalizes to Medicare without a prefix block", () => {
  const n = normalizeInsuranceDisplay("Type: ANSI-Medicare | Member: 123");
  assert.equal(n.planType, "Medicare");
  assert.equal(n.memberId, "123");
});

test("does not fabricate a payer when none is present", () => {
  const n = normalizeInsuranceDisplay("[INS-Secondary] Type: ANSI-Commercial | Status: active");
  // No payer name in source → label is the descriptor, not an invented carrier.
  assert.equal(n.planLabel, "Secondary Commercial Plan");
  assert.equal(n.priority, "Secondary");
});

if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
console.log(`\nAll insuranceDisplay tests passed`);
