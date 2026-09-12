// Unit tests for the cohort-scoped distribution PREVIEW pure logic (Task 3).
//
// Covers classifyCallStatus, accumulateAncillaryMix, and
// assembleDistributionPreview (given a fabricated allocator plan + cohort
// cases). No DB: the module imports distributionService (lazy pg pool, no
// query issued here). Runner sets a dummy DATABASE_URL.
//
// Run: DATABASE_URL='postgres://u:p@localhost:5432/x' npx tsx tests/unit/callListDistributionPreview.test.ts

import assert from "node:assert/strict";
import {
  classifyCallStatus,
  accumulateAncillaryMix,
  assembleDistributionPreview,
} from "../../server/services/engagement/callListDistributionPreview";
import type { CohortCase } from "../../server/services/engagement/callListCohortService";
import type { DistributionPlan } from "../../server/services/engagement/distributionService";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const NOW = new Date("2026-09-12T17:00:00.000Z");

function cohortCase(overrides: Partial<CohortCase> = {}): CohortCase {
  return {
    executionCaseId: 1,
    patientScreeningId: 1,
    patientName: "Test Patient",
    patientDob: "1950-01-01",
    facility: "Taylor Family Practice",
    scheduleDate: null,
    engagementBucket: "outreach",
    engagementStatus: "assigned",
    qualificationStatus: "qualified",
    lastCallOutcome: null,
    nextActionAt: null,
    selectedServices: [],
    callAttemptCount: 0,
    ...overrides,
  };
}

console.log("callListDistributionPreview:");

check("classifyCallStatus — callback_due takes precedence over prior outcome", () => {
  const past = new Date(NOW.getTime() - 3600_000).toISOString();
  assert.equal(
    classifyCallStatus({ callAttemptCount: 3, lastCallOutcome: "voicemail", nextActionAt: past }, NOW),
    "callback_due",
  );
});

check("classifyCallStatus — never_called when no attempts + no due callback", () => {
  assert.equal(
    classifyCallStatus({ callAttemptCount: 0, lastCallOutcome: null, nextActionAt: null }, NOW),
    "never_called",
  );
  // A FUTURE next action is not yet due → still never_called when 0 attempts.
  const future = new Date(NOW.getTime() + 3600_000).toISOString();
  assert.equal(
    classifyCallStatus({ callAttemptCount: 0, lastCallOutcome: null, nextActionAt: future }, NOW),
    "never_called",
  );
});

check("classifyCallStatus — lvm / no_answer / reached / other from last outcome", () => {
  assert.equal(classifyCallStatus({ callAttemptCount: 1, lastCallOutcome: "voicemail", nextActionAt: null }, NOW), "lvm");
  assert.equal(classifyCallStatus({ callAttemptCount: 2, lastCallOutcome: "no_answer", nextActionAt: null }, NOW), "no_answer");
  assert.equal(classifyCallStatus({ callAttemptCount: 1, lastCallOutcome: "reached", nextActionAt: null }, NOW), "reached_not_scheduled");
  assert.equal(classifyCallStatus({ callAttemptCount: 1, lastCallOutcome: "busy", nextActionAt: null }, NOW), "other");
});

check("accumulateAncillaryMix — counts each category once per patient", () => {
  const mix = { brainwave: 0, vitalwave: 0, ultrasound: 0, other: 0 };
  accumulateAncillaryMix(mix, ["BrainWave", "VitalWave", "Bilateral Carotid Duplex (93880)"]);
  assert.deepEqual(mix, { brainwave: 1, vitalwave: 1, ultrasound: 1, other: 0 });
  // Two ultrasounds for one patient still count ultrasound once.
  const mix2 = { brainwave: 0, vitalwave: 0, ultrasound: 0, other: 0 };
  accumulateAncillaryMix(mix2, ["Renal Artery Doppler", "Echocardiogram TTE"]);
  assert.deepEqual(mix2, { brainwave: 0, vitalwave: 0, ultrasound: 1, other: 0 });
});

check("assembleDistributionPreview — per-member counts, mix, mapping, ordering", () => {
  const cases: CohortCase[] = [
    cohortCase({ executionCaseId: 101, patientName: "Alice", selectedServices: ["BrainWave"], callAttemptCount: 0 }),
    cohortCase({ executionCaseId: 102, patientName: "Bob", selectedServices: ["VitalWave"], callAttemptCount: 1, lastCallOutcome: "voicemail" }),
    cohortCase({ executionCaseId: 103, patientName: "Cara", selectedServices: ["BrainWave", "Renal Artery Doppler"], callAttemptCount: 2, lastCallOutcome: "no_answer" }),
  ];
  const plan: DistributionPlan = {
    assignments: [
      { executionCaseId: 101, patientScreeningId: 1, patientName: "Alice", patientDob: null, facility: "F", scheduleDate: null, lane: "outreach", schedulerId: 7, schedulerName: "Jason" },
      { executionCaseId: 102, patientScreeningId: 2, patientName: "Bob", patientDob: null, facility: "F", scheduleDate: null, lane: "outreach", schedulerId: 7, schedulerName: "Jason" },
      { executionCaseId: 103, patientScreeningId: 3, patientName: "Cara", patientDob: null, facility: "F", scheduleDate: null, lane: "outreach", schedulerId: 9, schedulerName: "Sarah" },
    ],
    unplaced: [
      { executionCaseId: 200, patientScreeningId: 20, patientName: "Zed", facility: "F", lane: "outreach", reason: "no capacity", category: "capacity_exhausted" as never },
    ],
    memberSummaries: [
      { schedulerId: 7, name: "Jason", facility: "F", remainingCapacity: 58, visitTarget: 0, outreachTarget: 60, assignedTotal: 2, assignedVisit: 0, assignedOutreach: 2, workingToday: true, active: true, configuredWorkloadPercent: 100, dailyCallCapacity: 60, carryover: 0, priorityHandoffs: 0, standardWorkload: 0, projectedEffectiveWorkload: 2, overCapacity: 0 },
      { schedulerId: 9, name: "Sarah", facility: "F", remainingCapacity: 59, visitTarget: 0, outreachTarget: 60, assignedTotal: 1, assignedVisit: 0, assignedOutreach: 1, workingToday: true, active: true, configuredWorkloadPercent: 100, dailyCallCapacity: 60, carryover: 0, priorityHandoffs: 0, standardWorkload: 0, projectedEffectiveWorkload: 1, overCapacity: 0 },
    ],
    totals: { poolSize: 3, assigned: 3, unplaced: 1, eligibleMembers: 2 },
  };

  const result = assembleDistributionPreview({
    previewOperationId: "op-test",
    now: NOW,
    facility: "Taylor Family Practice",
    serviceDate: "2026-09-12",
    cohort: "all_active_outreach",
    cohortLabel: "All Active Outreach",
    services: null,
    notContactedDays: null,
    totalMatches: 3,
    cohortCases: cases,
    plan,
  });

  assert.equal(result.mapping.length, 3, "mapping covers every assignment");
  assert.equal(result.members.length, 2);
  // Ordered most-patients-first → Jason (2) before Sarah (1).
  assert.equal(result.members[0].name, "Jason");
  assert.equal(result.members[0].patientCount, 2);
  assert.deepEqual(result.members[0].ancillaryMix, { brainwave: 1, vitalwave: 1, ultrasound: 0, other: 0 });
  assert.equal(result.members[0].statusMix.never_called, 1); // Alice
  assert.equal(result.members[0].statusMix.lvm, 1); // Bob
  assert.equal(result.members[0].capacity.dailyCallCapacity, 60);
  assert.equal(result.members[0].capacity.assignedThisPlan, 2);

  assert.equal(result.members[1].name, "Sarah");
  assert.deepEqual(result.members[1].ancillaryMix, { brainwave: 1, vitalwave: 0, ultrasound: 1, other: 0 });
  assert.equal(result.members[1].statusMix.no_answer, 1); // Cara

  assert.equal(result.unplaced.length, 1);
  assert.equal(result.unplaced[0].patientName, "Zed");
  assert.equal(result.totalMatches, 3);
  assert.equal(result.distributedPoolSize, 3);
});

check("assembleDistributionPreview — empty plan yields no members, empty mapping", () => {
  const plan: DistributionPlan = {
    assignments: [],
    unplaced: [],
    memberSummaries: [],
    totals: { poolSize: 0, assigned: 0, unplaced: 0, eligibleMembers: 0 },
  };
  const result = assembleDistributionPreview({
    previewOperationId: "op-empty",
    now: NOW,
    facility: "F",
    serviceDate: "2026-09-12",
    cohort: "never_called",
    cohortLabel: "Never Called",
    services: ["BrainWave"],
    notContactedDays: null,
    totalMatches: 0,
    cohortCases: [],
    plan,
  });
  assert.equal(result.members.length, 0);
  assert.equal(result.mapping.length, 0);
  assert.equal(result.totalMatches, 0);
});

console.log(`\ncallListDistributionPreview: ${passed} checks passed\n`);
