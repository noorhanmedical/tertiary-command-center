// Unit tests for the canonical call-list cohort catalog + pure helpers.
//
// Covers the PURE, DB-free logic delivered in Task 1:
//   • cohort catalog integrity (unique keys, every key has a def)
//   • cohort-key guard
//   • "Not Contacted in X Days" default (7) + clamping
//   • clinic-local operational day-window math (due_today / overdue boundary)
//
// callListCohortService transitively imports server/db (a lazy pg Pool that
// never connects here — no query is issued by computeClinicDayWindow). The
// runner sets a dummy DATABASE_URL.
//
// Run: DATABASE_URL='postgres://u:p@localhost:5432/x' npx tsx tests/unit/callListCohorts.test.ts

import assert from "node:assert/strict";
import {
  CALL_LIST_COHORT_KEYS,
  CALL_LIST_COHORTS,
  isCallListCohortKey,
  resolveNotContactedDays,
  getCallListCohort,
  NOT_CONTACTED_DEFAULT_DAYS,
  NOT_CONTACTED_MIN_DAYS,
  NOT_CONTACTED_MAX_DAYS,
} from "../../shared/engagement/callListCohorts";
import { computeClinicDayWindow } from "../../server/services/engagement/callListCohortService";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("callListCohorts:");

check("catalog has a def for every key, keys unique", () => {
  assert.equal(CALL_LIST_COHORTS.length, CALL_LIST_COHORT_KEYS.length);
  const keys = CALL_LIST_COHORTS.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length, "duplicate cohort keys");
  for (const k of CALL_LIST_COHORT_KEYS) {
    assert.equal(getCallListCohort(k).key, k);
  }
});

check("expected canonical cohorts are present", () => {
  for (const k of [
    "never_called",
    "lvm",
    "no_answer",
    "callback_due",
    "reached_not_scheduled",
    "unassigned_eligible",
    "overdue",
    "due_today",
    "new_qualified",
    "all_active_outreach",
    "not_contacted_in_x_days",
    "scheduling_follow_up",
  ] as const) {
    assert.ok(isCallListCohortKey(k), `${k} should be a cohort key`);
  }
});

check("only not_contacted_in_x_days is parameterized", () => {
  const parameterized = CALL_LIST_COHORTS.filter((c) => c.parameterized).map((c) => c.key);
  assert.deepEqual(parameterized, ["not_contacted_in_x_days"]);
});

check("isCallListCohortKey rejects unknown / non-string", () => {
  assert.equal(isCallListCohortKey("nope"), false);
  assert.equal(isCallListCohortKey(""), false);
  assert.equal(isCallListCohortKey(42), false);
  assert.equal(isCallListCohortKey(null), false);
  assert.equal(isCallListCohortKey(undefined), false);
});

check("resolveNotContactedDays defaults to 7", () => {
  assert.equal(NOT_CONTACTED_DEFAULT_DAYS, 7);
  assert.equal(resolveNotContactedDays(undefined), 7);
  assert.equal(resolveNotContactedDays(null), 7);
  assert.equal(resolveNotContactedDays("garbage"), 7);
  assert.equal(resolveNotContactedDays(NaN), 7);
});

check("resolveNotContactedDays clamps + floors", () => {
  assert.equal(resolveNotContactedDays(10), 10);
  assert.equal(resolveNotContactedDays(10.9), 10);
  assert.equal(resolveNotContactedDays(0), NOT_CONTACTED_MIN_DAYS);
  assert.equal(resolveNotContactedDays(-5), NOT_CONTACTED_MIN_DAYS);
  assert.equal(resolveNotContactedDays(9999), NOT_CONTACTED_MAX_DAYS);
  assert.equal(resolveNotContactedDays("14"), 14);
});

check("computeClinicDayWindow — America/Chicago (CDT) boundary", () => {
  // 2026-09-12T02:00:00Z is 2026-09-11 21:00 CDT → operational date 09-11.
  const now = new Date("2026-09-12T02:00:00.000Z");
  const w = computeClinicDayWindow(now, "America/Chicago");
  assert.equal(w.dayStart.toISOString(), "2026-09-11T05:00:00.000Z");
  assert.equal(w.dayEndExclusive.toISOString(), "2026-09-12T05:00:00.000Z");
  // now falls inside today's window → a due-today nextActionAt at `now` matches.
  assert.ok(now >= w.dayStart && now < w.dayEndExclusive);
});

check("computeClinicDayWindow — America/Phoenix (no DST) boundary + 24h span", () => {
  const now = new Date("2026-09-12T02:00:00.000Z");
  const w = computeClinicDayWindow(now, "America/Phoenix");
  assert.equal(w.dayStart.toISOString(), "2026-09-11T07:00:00.000Z");
  assert.equal(w.dayEndExclusive.toISOString(), "2026-09-12T07:00:00.000Z");
  assert.equal(w.dayEndExclusive.getTime() - w.dayStart.getTime(), 24 * 60 * 60 * 1000);
});

check("computeClinicDayWindow — overdue vs due-today classification", () => {
  const now = new Date("2026-09-12T02:00:00.000Z"); // 09-11 21:00 CDT
  const w = computeClinicDayWindow(now, "America/Chicago");
  const yesterdayAction = new Date("2026-09-11T04:59:00.000Z"); // before dayStart
  const todayAction = new Date("2026-09-11T18:00:00.000Z"); // 13:00 CDT, inside window
  assert.ok(yesterdayAction < w.dayStart, "yesterday → overdue");
  assert.ok(
    todayAction >= w.dayStart && todayAction < w.dayEndExclusive,
    "today → due_today",
  );
});

check("refused + scheduled cohorts are canonical keys with correct defs", () => {
  assert.ok(isCallListCohortKey("refused"), "refused should be a cohort key");
  assert.ok(isCallListCohortKey("scheduled"), "scheduled should be a cohort key");
  const refused = getCallListCohort("refused");
  const scheduled = getCallListCohort("scheduled");
  assert.equal(refused.label, "Refused");
  assert.equal(scheduled.label, "Scheduled");
  // refused reads the latest outreach outcome; scheduled reads canonical state.
  assert.equal(refused.usesOutreachHistory, true);
  assert.equal(scheduled.usesOutreachHistory, false);
  // Neither is parameterized.
  assert.equal(refused.parameterized, false);
  assert.equal(scheduled.parameterized, false);
});

check("§17 required Call Status cohorts all present", () => {
  for (const k of [
    "never_called", // Never Contacted
    "lvm",
    "no_answer",
    "callback_due",
    "reached_not_scheduled", // Reached
    "scheduled",
    "refused",
  ] as const) {
    assert.ok(isCallListCohortKey(k), `${k} required by §17`);
  }
});

console.log(`\ncallListCohorts: ${passed} checks passed\n`);
