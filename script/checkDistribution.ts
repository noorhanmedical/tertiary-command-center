/**
 * Verification harness for the Engagement Distribution allocator.
 *
 * This repo has no unit-test runner wired into package.json, so — following
 * the existing `script/*.ts` + tsx convention — this is a runnable assertion
 * script that locks the invariants of the PURE allocator buildDistributionPlan.
 *
 *   Run:  npx tsx script/checkDistribution.ts
 *
 * Exits non-zero on any failed assertion so it can gate CI later.
 */
import {
  buildDistributionPlan,
  laneForBucket,
  type DistributionCaseInput,
  type DistributionMemberInput,
  type DistributionPlan,
} from "../server/services/engagement/distributionService";

let failures = 0;

function check(label: string, cond: boolean) {
  if (!cond) {
    failures += 1;
    console.error(`✗ ${label}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

function assertEqual(label: string, actual: unknown, expected: unknown) {
  check(
    `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
    JSON.stringify(actual) === JSON.stringify(expected),
  );
}

// Assert the universal invariants on every plan no matter the inputs.
function assertInvariants(label: string, plan: DistributionPlan) {
  for (const m of plan.memberSummaries) {
    check(
      `${label}: ${m.name} total ≤ remainingCapacity`,
      m.assignedTotal <= m.remainingCapacity,
    );
    check(
      `${label}: ${m.name} visit ≤ visitTarget`,
      m.assignedVisit <= m.visitTarget,
    );
    check(
      `${label}: ${m.name} outreach ≤ outreachTarget`,
      m.assignedOutreach <= m.outreachTarget,
    );
    check(
      `${label}: ${m.name} visit+outreach == total`,
      m.assignedVisit + m.assignedOutreach === m.assignedTotal,
    );
    if (!m.active || !m.workingToday) {
      check(
        `${label}: non-working ${m.name} receives nothing`,
        m.assignedTotal === 0,
      );
    }
  }
  const placed = plan.assignments.length;
  const unplaced = plan.unplaced.length;
  assertEqual(`${label}: placed+unplaced == pool`, placed + unplaced, plan.totals.poolSize);
  // Sum of member assignedTotal equals number of assignments.
  const memberSum = plan.memberSummaries.reduce((s, m) => s + m.assignedTotal, 0);
  assertEqual(`${label}: member sum == assignments`, memberSum, placed);
}

function mkMember(p: Partial<DistributionMemberInput> & { schedulerId: number }): DistributionMemberInput {
  return {
    name: `M${p.schedulerId}`,
    facility: null,
    active: true,
    workingToday: true,
    facilitiesCovered: null,
    remainingCapacity: 10,
    visitTarget: 5,
    outreachTarget: 5,
    ...p,
  };
}

let caseSeq = 0;
function mkCase(p: Partial<DistributionCaseInput> = {}): DistributionCaseInput {
  caseSeq += 1;
  return {
    executionCaseId: caseSeq,
    patientScreeningId: caseSeq,
    patientName: `P${caseSeq}`,
    patientDob: null,
    facility: null,
    scheduleDate: null,
    engagementBucket: "outreach",
    ...p,
  };
}

// ─── lane mapping ───────────────────────────────────────────────────────────
assertEqual("lane: visit → visit", laneForBucket("visit"), "visit");
assertEqual("lane: outreach → outreach", laneForBucket("outreach"), "outreach");
assertEqual("lane: scheduling_triage → outreach", laneForBucket("scheduling_triage"), "outreach");
assertEqual("lane: null → outreach", laneForBucket(null), "outreach");
assertEqual("lane: VISIT (case) → visit", laneForBucket("VISIT"), "visit");

// ─── basic spread across two equal members ──────────────────────────────────
{
  const members = [mkMember({ schedulerId: 1 }), mkMember({ schedulerId: 2 })];
  const cases = Array.from({ length: 6 }, () => mkCase({ engagementBucket: "outreach" }));
  const plan = buildDistributionPlan(cases, members);
  assertInvariants("even spread", plan);
  assertEqual("even spread: all 6 placed", plan.totals.assigned, 6);
  const a = plan.memberSummaries.find((m) => m.schedulerId === 1)!.assignedTotal;
  const b = plan.memberSummaries.find((m) => m.schedulerId === 2)!.assignedTotal;
  check("even spread: balanced 3/3", a === 3 && b === 3);
}

// ─── lane sub-caps bind: outreach-only flood respects outreachTarget ─────────
{
  const members = [mkMember({ schedulerId: 1, remainingCapacity: 10, visitTarget: 7, outreachTarget: 3 })];
  const cases = Array.from({ length: 10 }, () => mkCase({ engagementBucket: "outreach" }));
  const plan = buildDistributionPlan(cases, members);
  assertInvariants("outreach cap", plan);
  assertEqual("outreach cap: only 3 outreach placed", plan.totals.assigned, 3);
  assertEqual("outreach cap: 7 unplaced", plan.totals.unplaced, 7);
  check(
    "outreach cap: reason mentions outreach target",
    plan.unplaced.every((u) => /outreach target/i.test(u.reason)),
  );
}

// ─── total remaining capacity binds below lane targets (carryover) ──────────
{
  // visitTarget+outreachTarget = 10 but only 4 remaining capacity after carryover
  const members = [mkMember({ schedulerId: 1, remainingCapacity: 4, visitTarget: 5, outreachTarget: 5 })];
  const cases = [
    ...Array.from({ length: 5 }, () => mkCase({ engagementBucket: "visit" })),
    ...Array.from({ length: 5 }, () => mkCase({ engagementBucket: "outreach" })),
  ];
  const plan = buildDistributionPlan(cases, members);
  assertInvariants("capacity cap", plan);
  assertEqual("capacity cap: only 4 placed (remainingCapacity)", plan.totals.assigned, 4);
  assertEqual("capacity cap: member total == 4", plan.memberSummaries[0].assignedTotal, 4);
}

// ─── facility coverage ──────────────────────────────────────────────────────
{
  const members = [
    mkMember({ schedulerId: 1, facilitiesCovered: ["Clinic A"] }),
    mkMember({ schedulerId: 2, facilitiesCovered: ["Clinic B"] }),
    mkMember({ schedulerId: 3, facilitiesCovered: null }), // covers any
  ];
  const cases = [
    mkCase({ facility: "Clinic A", engagementBucket: "visit" }),
    mkCase({ facility: "Clinic B", engagementBucket: "visit" }),
    mkCase({ facility: "Clinic C", engagementBucket: "visit" }), // only the any-member
  ];
  const plan = buildDistributionPlan(cases, members);
  assertInvariants("facility", plan);
  const byId = new Map(plan.assignments.map((a) => [a.facility, a.schedulerId]));
  assertEqual("facility: Clinic A → member 1", byId.get("Clinic A"), 1);
  assertEqual("facility: Clinic B → member 2", byId.get("Clinic B"), 2);
  assertEqual("facility: Clinic C → any-member 3", byId.get("Clinic C"), 3);
}

// ─── restricted member cannot take a case with no facility ──────────────────
{
  const members = [mkMember({ schedulerId: 1, facilitiesCovered: ["Clinic A"] })];
  const cases = [mkCase({ facility: null, engagementBucket: "visit" })];
  const plan = buildDistributionPlan(cases, members);
  assertInvariants("restricted-no-facility", plan);
  assertEqual("restricted: case unplaced", plan.totals.unplaced, 1);
  check(
    "restricted: reason mentions facility coverage",
    /covers/i.test(plan.unplaced[0].reason),
  );
}

// ─── non-working / inactive members are skipped ─────────────────────────────
{
  const members = [
    mkMember({ schedulerId: 1, workingToday: false }),
    mkMember({ schedulerId: 2, active: false }),
    mkMember({ schedulerId: 3, workingToday: true, active: true }),
  ];
  const cases = Array.from({ length: 3 }, () => mkCase());
  const plan = buildDistributionPlan(cases, members);
  assertInvariants("working-only", plan);
  check(
    "working-only: only member 3 received work",
    plan.assignments.every((a) => a.schedulerId === 3),
  );
}

// ─── no working members at all → all unplaced w/ clear reason ────────────────
{
  const members = [mkMember({ schedulerId: 1, workingToday: false })];
  const cases = [mkCase(), mkCase()];
  const plan = buildDistributionPlan(cases, members);
  assertInvariants("none-working", plan);
  assertEqual("none-working: all unplaced", plan.totals.unplaced, 2);
  check(
    "none-working: reason states nobody working",
    plan.unplaced.every((u) => /working today/i.test(u.reason)),
  );
}

// ─── determinism: same inputs → identical plan ──────────────────────────────
{
  const mk = () => ({
    members: [mkMember({ schedulerId: 1 }), mkMember({ schedulerId: 2 }), mkMember({ schedulerId: 3 })],
    cases: [
      mkCase({ executionCaseId: 101, patientScreeningId: 101, patientName: "Alpha", engagementBucket: "visit", scheduleDate: "2026-07-01" }),
      mkCase({ executionCaseId: 102, patientScreeningId: 102, patientName: "Bravo", engagementBucket: "outreach", scheduleDate: "2026-06-30" }),
      mkCase({ executionCaseId: 103, patientScreeningId: 103, patientName: "Charlie", engagementBucket: "visit", scheduleDate: "2026-07-01" }),
    ],
  });
  const a = buildDistributionPlan(mk().cases, mk().members);
  const b = buildDistributionPlan(mk().cases, mk().members);
  assertEqual("determinism: identical assignments", a.assignments, b.assignments);
}

// ─── empty inputs are safe ──────────────────────────────────────────────────
{
  assertInvariants("empty pool", buildDistributionPlan([], [mkMember({ schedulerId: 1 })]));
  assertInvariants("empty roster", buildDistributionPlan([mkCase()], []));
  const noRoster = buildDistributionPlan([mkCase()], []);
  assertEqual("empty roster: case unplaced", noRoster.totals.unplaced, 1);
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll Engagement Distribution allocator assertions passed.");
