// PERMANENT regression — Engagement distribution capacity + needs-coverage
// overflow (Final Acceptance §14 A + C).
//
// Locks the PURE, deterministic allocator (buildDistributionPlan) against the
// core workforce guarantees:
//   A. capacity is respected at 100% and 50% workload;
//   C. overflow (more work than capacity) produces EXACTLY
//      assigned + coverage + 0 lost — no case is silently dropped.
//
// No DB — the allocator is a pure function, so this is fast and stable.
//
//   npx tsx tests/acceptance/distributionCapacity.test.ts

// buildDistributionPlan imports server modules that reference DATABASE_URL at
// import time; provide a placeholder so the import graph loads (no DB is used).
process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";
import {
  buildDistributionPlan,
  type DistributionCaseInput,
  type DistributionMemberInput,
} from "../../server/services/engagement/distributionService";

let failures = 0;
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${label}`);
  } catch (e) {
    failures++;
    console.error(`FAIL ${label}: ${e instanceof Error ? e.message : e}`);
  }
}

// A working, active, facility-agnostic member with the given capacity. The
// full call KPI is put on the outreach lane so a pure-outreach pool can fill it.
function member(
  schedulerId: number,
  capacity: number,
  over: Partial<DistributionMemberInput> = {},
): DistributionMemberInput {
  return {
    schedulerId,
    name: `M${schedulerId}`,
    facility: null,
    active: true,
    workingToday: true,
    facilitiesCovered: null, // covers any facility
    remainingCapacity: capacity,
    visitTarget: 0,
    outreachTarget: capacity,
    configuredWorkloadPercent: 100,
    dailyCallCapacity: capacity,
    assigned: 0,
    carryover: 0,
    priorityHandoffs: 0,
    ...over,
  };
}

function outreachCases(n: number): DistributionCaseInput[] {
  return Array.from({ length: n }, (_, i) => ({
    executionCaseId: 1000 + i,
    patientScreeningId: 2000 + i,
    patientName: `Patient ${i}`,
    patientDob: null,
    facility: null,
    scheduleDate: null,
    engagementBucket: "outreach",
  }));
}

// ─── A. Capacity respected at 100% workload ──────────────────────────────────
check("A1: 100% capacity=25, pool=20 → all 20 assigned, 0 unplaced", () => {
  const plan = buildDistributionPlan(outreachCases(20), [member(1, 25)]);
  assert.equal(plan.totals.assigned, 20, "all placed");
  assert.equal(plan.totals.unplaced, 0, "none unplaced");
  assert.equal(plan.assignments.length, 20);
});

// ─── A. Capacity respected at 50% workload (half the KPI) ────────────────────
check("A2: 50% capacity=12, pool=20 → 12 assigned, 8 unplaced, none lost", () => {
  const plan = buildDistributionPlan(outreachCases(20), [member(1, 12)]);
  assert.equal(plan.totals.assigned, 12, "capacity ceiling honored");
  assert.equal(plan.totals.unplaced, 8, "remainder overflows to coverage");
  assert.equal(
    plan.totals.assigned + plan.totals.unplaced,
    20,
    "assigned + unplaced == pool (nothing lost)",
  );
  // Never exceed remaining capacity.
  const perMember = plan.memberSummaries.find((m) => m.schedulerId === 1)!;
  assert.ok(perMember.assignedTotal <= 12, "member never over its remaining capacity");
});

// ─── C. Needs-coverage overflow: 40 work / 25 capacity → 25 + 15 + 0 lost ────
check("C: pool=40, single member capacity=25 → 25 assigned + 15 coverage + 0 lost", () => {
  const plan = buildDistributionPlan(outreachCases(40), [member(1, 25)]);
  assert.equal(plan.totals.poolSize, 40, "pool size 40");
  assert.equal(plan.totals.assigned, 25, "exactly capacity assigned");
  assert.equal(plan.assignments.length, 25, "25 assignment rows");
  assert.equal(plan.totals.unplaced, 15, "15 overflow to needs coverage");
  assert.equal(plan.unplaced.length, 15, "15 unplaced rows recorded");
  assert.equal(
    plan.totals.assigned + plan.totals.unplaced,
    40,
    "CONSERVATION: 25 + 15 == 40 — no work lost",
  );
  // Every unplaced case carries a structured category (not silently dropped).
  assert.ok(
    plan.unplaced.every((u) => typeof u.category === "string" && u.category.length > 0),
    "every overflow case has a structured needs-coverage category",
  );
  // The overflow reason is capacity exhaustion (not a facility/eligibility gap).
  assert.ok(
    plan.unplaced.every((u) => u.category === "capacity_exhausted"),
    "overflow category is capacity_exhausted",
  );
});

// ─── Multi-member spread respects each member's capacity ─────────────────────
check("spread: pool=40, two members cap 25+10 → 35 assigned, 5 coverage, none over cap", () => {
  const plan = buildDistributionPlan(outreachCases(40), [member(1, 25), member(2, 10)]);
  assert.equal(plan.totals.assigned, 35, "35 = 25 + 10");
  assert.equal(plan.totals.unplaced, 5);
  const m1 = plan.memberSummaries.find((m) => m.schedulerId === 1)!;
  const m2 = plan.memberSummaries.find((m) => m.schedulerId === 2)!;
  assert.ok(m1.assignedTotal <= 25, "m1 within capacity");
  assert.ok(m2.assignedTotal <= 10, "m2 within capacity");
});

// ─── Inactive / not-working members receive NO work ──────────────────────────
check("inactive member gets no work; whole pool overflows to coverage", () => {
  const plan = buildDistributionPlan(outreachCases(5), [
    member(1, 25, { active: false }),
    member(2, 25, { workingToday: false }),
  ]);
  assert.equal(plan.totals.assigned, 0, "no assignments to ineligible members");
  assert.equal(plan.totals.unplaced, 5, "all overflow — never assigned to inactive/off staff");
});

if (failures > 0) {
  console.error(`\ndistributionCapacity.test.ts: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ndistributionCapacity.test.ts: all tests passed");
