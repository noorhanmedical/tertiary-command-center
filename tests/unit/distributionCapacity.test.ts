// Phase 1 — Invariant #2/#3 (distribution must account for already-owned work
// and be safe under repeated runs).
//
// Tests the REAL canonical code:
//   • callSettingsService.computeMemberCapacityState → availableForNewWork
//   • distributionService.buildDistributionPlan (pure allocator) honoring the
//     corrected ceiling.
//
// distributionService/callSettingsService transitively import server/db.ts,
// which requires DATABASE_URL to be *present* (the pg Pool is lazy and never
// connects here — no query is issued by these pure functions). The runner
// sets a dummy DATABASE_URL.
//
// Run: DATABASE_URL='postgres://u:p@localhost:5432/x' npx tsx tests/unit/distributionCapacity.test.ts

import assert from "node:assert/strict";
import { computeMemberCapacityState } from "../../server/services/engagement/callSettingsService";
import {
  buildDistributionPlan,
  type DistributionMemberInput,
  type DistributionCaseInput,
} from "../../server/services/engagement/distributionService";

function targets(kpi: number, visit: number, outreach: number) {
  return {
    completedCallKpi: kpi,
    scheduledKpi: Math.round(kpi / 2),
    visitTarget: visit,
    outreachTarget: outreach,
    maxDailyCapacity: kpi,
  };
}

function member(overrides: Partial<DistributionMemberInput> = {}): DistributionMemberInput {
  return {
    schedulerId: 1,
    name: "PCS A",
    facility: null,
    active: true,
    workingToday: true,
    facilitiesCovered: null,
    remainingCapacity: 60,
    visitTarget: 45,
    outreachTarget: 15,
    configuredWorkloadPercent: 100,
    dailyCallCapacity: 60,
    assigned: 0,
    carryover: 0,
    priorityHandoffs: 0,
    ...overrides,
  };
}

function makeCases(n: number, bucket: "visit" | "outreach", facility: string | null = null): DistributionCaseInput[] {
  return Array.from({ length: n }, (_, i) => ({
    executionCaseId: i + 1,
    patientScreeningId: i + 1,
    patientName: `Patient ${i + 1}`,
    patientDob: null,
    facility,
    scheduleDate: null,
    engagementBucket: bucket,
  }));
}

async function main() {
  // ── computeMemberCapacityState.availableForNewWork ────────────────────────
  // KPI 60, owns 0 → 60 headroom.
  {
    const s = computeMemberCapacityState({
      targets: targets(60, 45, 15), configuredWorkloadPercent: 100,
      assigned: 0, carryover: 0, workingToday: true,
    });
    assert.equal(s.availableForNewWork, 60, "owns 0 → 60 headroom");
  }
  // KPI 60, owns 40, carryover 0 → 20 headroom (THE confirmed bug: was 60).
  {
    const s = computeMemberCapacityState({
      targets: targets(60, 45, 15), configuredWorkloadPercent: 100,
      assigned: 40, carryover: 0, workingToday: true,
    });
    assert.equal(s.availableForNewWork, 20, "owns 40 → only 20 headroom");
    // Display remainingCapacity (kpi − carryover) unchanged for the settings UI.
    assert.equal(s.remainingCapacity, 60, "display remainingCapacity preserved");
  }
  // KPI 60, owns 60 → 0 headroom.
  {
    const s = computeMemberCapacityState({
      targets: targets(60, 45, 15), configuredWorkloadPercent: 100,
      assigned: 60, carryover: 0, workingToday: true,
    });
    assert.equal(s.availableForNewWork, 0, "owns 60 → 0 headroom");
  }
  // Carryover is NOT double-subtracted: owns 40 of which 40 are past-due
  // carryover → headroom is 20 (60 − 40), never 60 − 40 − 40 = −20.
  {
    const s = computeMemberCapacityState({
      targets: targets(60, 45, 15), configuredWorkloadPercent: 100,
      assigned: 40, carryover: 40, workingToday: true,
    });
    assert.equal(s.availableForNewWork, 20, "carryover ⊆ assigned → not double-subtracted");
  }

  // ── buildDistributionPlan honors the corrected total ceiling ──────────────
  // Member owns 40 → gatherDistributionMembers feeds remainingCapacity=20.
  // A pool of 50 VISIT cases (visit lane target 45 not binding) → exactly 20
  // placed; the rest are surfaced as unplaced (→ needs coverage), not dropped.
  {
    const plan = buildDistributionPlan(
      makeCases(50, "visit"),
      [member({ remainingCapacity: 20, assigned: 40 })],
    );
    assert.equal(plan.assignments.length, 20, "total ceiling binds → 20 placed");
    assert.equal(plan.unplaced.length, 30, "remaining 30 surfaced as unplaced");
    assert.equal(plan.memberSummaries[0].assignedTotal, 20);
  }

  // Idempotency / no top-up: a member already at capacity (owns 60,
  // headroom 0) receives NOTHING on a subsequent run regardless of pool size.
  {
    const plan = buildDistributionPlan(
      makeCases(50, "visit"),
      [member({ remainingCapacity: 0, assigned: 60 })],
    );
    assert.equal(plan.assignments.length, 0, "at capacity → repeated run adds nothing");
    assert.equal(plan.unplaced.length, 50);
  }

  // Lane targets remain respected: 50 OUTREACH cases, outreach target 15,
  // total headroom 20 → outreach lane (15) binds below the total (20).
  {
    const plan = buildDistributionPlan(
      makeCases(50, "outreach"),
      [member({ remainingCapacity: 20, assigned: 40, outreachTarget: 15, visitTarget: 45 })],
    );
    assert.equal(plan.assignments.length, 15, "outreach lane target binds");
    assert.ok(plan.memberSummaries[0].assignedOutreach <= 15);
  }

  // Facility coverage still respected: covered=["A"], cases at "B" → unplaced
  // with the facility_coverage_mismatch category (genuinely unplaceable work
  // is surfaced, not silently dropped).
  {
    const plan = buildDistributionPlan(
      makeCases(5, "visit", "B"),
      [member({ facilitiesCovered: ["A"] })],
    );
    assert.equal(plan.assignments.length, 0);
    assert.equal(plan.unplaced.length, 5);
    assert.equal(plan.unplaced[0].category, "facility_coverage_mismatch");
  }

  // Not-working members receive nothing.
  {
    const plan = buildDistributionPlan(
      makeCases(5, "visit"),
      [member({ workingToday: false })],
    );
    assert.equal(plan.assignments.length, 0);
    assert.equal(plan.unplaced[0].category, "no_eligible_staff");
  }

  console.log("distribution capacity test passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
