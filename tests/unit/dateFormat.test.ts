// Platform date-format helper tests — enforce the "never YYYY-MM-DD" rule and
// timezone-safe date-only parsing.
//   npx tsx tests/unit/dateFormat.test.ts

import assert from "node:assert/strict";
import { formatDate, formatDateNumeric } from "../../client/src/lib/format";

let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`ok  ${name}`); }
  catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).message}`); }
}

test("date-only ISO renders as MMM D, YYYY (never YYYY-MM-DD)", () => {
  const out = formatDate("1972-10-10");
  assert.equal(out, "Oct 10, 1972");
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(out), "must not contain raw ISO");
});

test("date-only ISO is timezone-safe (no previous-day shift)", () => {
  // Parsed as LOCAL calendar date, so the day is always 10 regardless of TZ.
  assert.equal(formatDate("1972-10-10"), "Oct 10, 1972");
  assert.equal(formatDateNumeric("1972-10-10"), "10/10/1972");
});

test("numeric form is MM/DD/YYYY", () => {
  assert.equal(formatDateNumeric("2026-01-05"), "1/5/2026");
});

test("missing values yield an em-dash, not an ISO string", () => {
  for (const v of [null, undefined, ""]) {
    assert.equal(formatDate(v as string | null), "—");
    assert.equal(formatDateNumeric(v as string | null), "—");
  }
});

test("full ISO timestamps still format", () => {
  const out = formatDate("2022-08-18T13:47:00-05:00");
  assert.ok(/^Aug 1[78], 2022$/.test(out), `unexpected: ${out}`);
});

if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
console.log(`\nAll dateFormat tests passed`);
