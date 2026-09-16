// Unit tests for the PURE Manual Call List allocation helpers.
// No DB, no imports beyond the module under test.
//
// Run: npx tsx tests/unit/manualAllocation.test.ts

import assert from "node:assert/strict";
import {
  resolveSelectedCount,
  computeAllocationSummary,
  autoBalance,
  buildManualMapping,
  type ManualAllocationMember,
} from "../../shared/engagement/manualAllocation";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function members(counts: number[]): ManualAllocationMember[] {
  return counts.map((c, i) => ({ teamMemberId: i + 1, name: `M${i + 1}`, count: c }));
}

// ─── resolveSelectedCount ────────────────────────────────────────────────────
check("resolveSelectedCount: all → full eligible total", () => {
  assert.equal(resolveSelectedCount("all", 18234, null), 18234);
});
check("resolveSelectedCount: custom clamps to [0, eligibleTotal]", () => {
  assert.equal(resolveSelectedCount("custom", 500, 500), 500);
  assert.equal(resolveSelectedCount("custom", 500, 9999), 500); // cannot exceed pool
  assert.equal(resolveSelectedCount("custom", 500, -5), 0);
  assert.equal(resolveSelectedCount("custom", 500, null), 0);
});

// ─── computeAllocationSummary ────────────────────────────────────────────────
check("summary: exact allocation → remaining 0, confirmable", () => {
  const s = computeAllocationSummary(100, members([50, 25, 25]));
  assert.deepEqual(s, {
    selected: 100,
    allocated: 100,
    remaining: 0,
    overallocated: 0,
    canConfirm: true,
  });
});
check("summary: underallocation allowed (remaining>0, still confirmable)", () => {
  const s = computeAllocationSummary(500, members([50, 100, 25]));
  assert.equal(s.allocated, 175);
  assert.equal(s.remaining, 325);
  assert.equal(s.overallocated, 0);
  assert.equal(s.canConfirm, true);
});
check("summary: overallocation blocks confirm", () => {
  const s = computeAllocationSummary(100, members([50, 50, 20]));
  assert.equal(s.overallocated, 20);
  assert.equal(s.remaining, 0);
  assert.equal(s.canConfirm, false);
});
check("summary: zero allocated is not confirmable", () => {
  const s = computeAllocationSummary(100, members([0, 0]));
  assert.equal(s.canConfirm, false);
});

// ─── autoBalance ─────────────────────────────────────────────────────────────
check("autoBalance: even split", () => {
  const out = autoBalance(75, members([0, 0, 0]));
  assert.deepEqual(out.map((m) => m.count), [25, 25, 25]);
});
check("autoBalance: remainder goes to earliest members", () => {
  const out = autoBalance(100, members([0, 0, 0]));
  assert.deepEqual(out.map((m) => m.count), [34, 33, 33]);
});
check("autoBalance: pure — does not mutate inputs", () => {
  const input = members([7, 7]);
  const out = autoBalance(10, input);
  assert.deepEqual(input.map((m) => m.count), [7, 7]); // unchanged
  assert.deepEqual(out.map((m) => m.count), [5, 5]);
});
check("autoBalance: no members → empty", () => {
  assert.deepEqual(autoBalance(50, []), []);
});

// ─── buildManualMapping ──────────────────────────────────────────────────────
check("buildManualMapping: slices pool in order per member count", () => {
  const pool = [101, 102, 103, 104, 105];
  const map = buildManualMapping(pool, [
    { teamMemberId: 1, count: 2 },
    { teamMemberId: 2, count: 3 },
  ]);
  assert.deepEqual(map, [
    { executionCaseId: 101, teamMemberId: 1 },
    { executionCaseId: 102, teamMemberId: 1 },
    { executionCaseId: 103, teamMemberId: 2 },
    { executionCaseId: 104, teamMemberId: 2 },
    { executionCaseId: 105, teamMemberId: 2 },
  ]);
});
check("buildManualMapping: underallocation leaves pool tail unassigned", () => {
  const pool = [1, 2, 3, 4, 5];
  const map = buildManualMapping(pool, [{ teamMemberId: 9, count: 2 }]);
  assert.equal(map.length, 2);
  assert.deepEqual(map.map((m) => m.executionCaseId), [1, 2]);
});
check("buildManualMapping: over-request stops at pool end (no overflow)", () => {
  const pool = [1, 2];
  const map = buildManualMapping(pool, [
    { teamMemberId: 1, count: 5 },
    { teamMemberId: 2, count: 5 },
  ]);
  assert.equal(map.length, 2);
  assert.deepEqual(map, [
    { executionCaseId: 1, teamMemberId: 1 },
    { executionCaseId: 2, teamMemberId: 1 },
  ]);
});
check("buildManualMapping: count<=0 members are skipped", () => {
  const pool = [1, 2, 3];
  const map = buildManualMapping(pool, [
    { teamMemberId: 1, count: 0 },
    { teamMemberId: 2, count: 2 },
  ]);
  assert.deepEqual(map, [
    { executionCaseId: 1, teamMemberId: 2 },
    { executionCaseId: 2, teamMemberId: 2 },
  ]);
});

// QA §50 scenario: eligible large, auto suggests 7 each, admin overrides to
// 50 / 25 / 0, verify totals + mapping match exactly.
check("QA §50: manual override 50/25/0 over a 100-case pool", () => {
  const pool = Array.from({ length: 100 }, (_, i) => 1000 + i);
  const mem = members([50, 25, 0]);
  const summary = computeAllocationSummary(75, mem);
  assert.equal(summary.allocated, 75);
  assert.equal(summary.overallocated, 0);
  assert.equal(summary.canConfirm, true);
  const map = buildManualMapping(pool, mem);
  assert.equal(map.length, 75);
  assert.equal(map.filter((m) => m.teamMemberId === 1).length, 50);
  assert.equal(map.filter((m) => m.teamMemberId === 2).length, 25);
  assert.equal(map.filter((m) => m.teamMemberId === 3).length, 0);
});

console.log(`\nmanualAllocation.test.ts — ${passed} assertions passed`);
