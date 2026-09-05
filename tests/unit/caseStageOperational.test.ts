// Phase P2 — pure ACS/PCS operational presentation logic tests.
//
// Runs standalone with:
//   npx tsx tests/unit/caseStageOperational.test.ts

import assert from "node:assert/strict";
import {
  STAGE_LABELS,
  nextActionForCase,
  caseBlockers,
  hasBlockers,
  OPERATIONAL_FILTERS,
  operationalFilterById,
  filterCases,
  bucketCounts,
} from "../../client/src/components/careSpecialist/caseStageOperational";
import type { CaseStageVector, StageStatus, CanonicalStageKey } from "../../shared/canonicalStageVector";

const okStage = (status: string | null): StageStatus => ({
  status, availability: "available", available: status != null,
  integrity: status != null ? "resolved" : "missing", sourceId: null, at: null, warnings: [],
});
const conflict = (warnings: string[]): StageStatus => ({
  status: null, availability: "available", available: false, integrity: "conflicting", sourceId: null, at: null, warnings,
});

function vec(over: Partial<CaseStageVector> & { currentStage: CanonicalStageKey | null; currentStageIntegrity: CaseStageVector["currentStageIntegrity"] }): CaseStageVector {
  const base: CaseStageVector = {
    ancillaryCaseId: 1,
    serviceType: "Echocardiogram TTE",
    lifecycleStatus: "active",
    adminReviewStatus: "approved",
    identity: { globalPlexusPatientId: null, patientClinicMembershipId: null, patientDisplay: null, patientDob: null, clinicMrn: null, available: false, warnings: [] },
    adminReview: okStage("approved"),
    engagement: { ...okStage("member"), memberships: [], lastSentAt: null },
    appointment: okStage("scheduled"),
    orderNote: okStage("signed"),
    procedure: okStage("complete"),
    report: okStage("uploaded"),
    procedureNote: okStage("signed"),
    signature: okStage("signed"),
    billingReadiness: { ...okStage("ready_to_generate"), billingBlockers: [], claimBlockers: [] },
    billingDocument: okStage("generated"),
    claim: { ...okStage(null), availability: "upstream_flag_off" },
    invoice: { ...okStage(null), availability: "upstream_flag_off" },
    payment: { ...okStage(null), availability: "upstream_flag_off" },
    currentStage: null,
    currentStageIntegrity: "resolved",
  };
  return { ...base, ...over };
}

function testStageLabelsComplete() {
  for (const k of Object.keys(STAGE_LABELS)) assert.ok(STAGE_LABELS[k as CanonicalStageKey].length > 0);
}

function testNextActionFromServerCurrentStage() {
  const scheduling = nextActionForCase(vec({ currentStage: "appointment", currentStageIntegrity: "resolved" }));
  assert.equal(scheduling.stageKey, "appointment");
  assert.equal(scheduling.actionable, true);
  assert.equal(scheduling.integrityIssue, false);
  assert.match(scheduling.label, /schedule/i);

  const proc = nextActionForCase(vec({ currentStage: "procedure", currentStageIntegrity: "resolved" }));
  assert.match(proc.label, /ready for procedure/i);
}

function testNextActionComplete() {
  const done = nextActionForCase(vec({ currentStage: null, currentStageIntegrity: "resolved" }));
  assert.equal(done.stageKey, null);
  assert.equal(done.actionable, false);
  assert.equal(done.tone, "green");
  assert.match(done.label, /complete/i);
}

function testNextActionIntegrityConflict() {
  const bad = nextActionForCase(vec({ currentStage: "orderNote", currentStageIntegrity: "conflicting" }));
  assert.equal(bad.integrityIssue, true);
  assert.equal(bad.tone, "red");
  assert.match(bad.label, /integrity/i);
}

function testCaseBlockersAggregation() {
  const v = vec({
    currentStage: "billingReadiness",
    currentStageIntegrity: "resolved",
    billingReadiness: { ...okStage("missing_requirements"), billingBlockers: [{ code: "missing_report", count: 2 }], claimBlockers: [{ code: "missing_dx", count: 1 }] },
    appointment: conflict(["appointment_wrong_service"]),
  });
  const blockers = caseBlockers(v);
  assert.ok(hasBlockers(v));
  assert.ok(blockers.some((b) => b.code === "missing_report" && b.source === "billing" && b.count === 2));
  assert.ok(blockers.some((b) => b.code === "missing_dx" && b.source === "claim"));
  assert.ok(blockers.some((b) => b.code === "appointment_wrong_service" && b.source === "appointment"));

  // A clean case has no blockers.
  assert.equal(hasBlockers(vec({ currentStage: null, currentStageIntegrity: "resolved" })), false);
}

function testOperationalFiltersMapToCurrentStage() {
  const cases: CaseStageVector[] = [
    vec({ ancillaryCaseId: 1, currentStage: "adminReview", currentStageIntegrity: "resolved" }),
    vec({ ancillaryCaseId: 2, currentStage: "appointment", currentStageIntegrity: "resolved" }),
    vec({ ancillaryCaseId: 3, currentStage: "orderNote", currentStageIntegrity: "resolved", serviceType: "BrainWave" }), // screening-required
    vec({ ancillaryCaseId: 4, currentStage: "orderNote", currentStageIntegrity: "resolved", serviceType: "Echocardiogram TTE" }), // not screening
    vec({ ancillaryCaseId: 5, currentStage: "procedure", currentStageIntegrity: "resolved" }),
    vec({ ancillaryCaseId: 6, currentStage: "report", currentStageIntegrity: "resolved" }),
    vec({ ancillaryCaseId: 7, currentStage: "procedureNote", currentStageIntegrity: "resolved" }),
    vec({ ancillaryCaseId: 8, currentStage: "signature", currentStageIntegrity: "resolved" }),
    vec({ ancillaryCaseId: 9, currentStage: "billingDocument", currentStageIntegrity: "resolved" }),
    vec({ ancillaryCaseId: 10, currentStage: "orderNote", currentStageIntegrity: "conflicting" }),
    vec({ ancillaryCaseId: 11, currentStage: null, currentStageIntegrity: "resolved" }),
  ];

  assert.equal(filterCases(cases, "needs_scheduling").map((v) => v.ancillaryCaseId).join(","), "2");
  assert.equal(filterCases(cases, "ready_for_procedure").map((v) => v.ancillaryCaseId).join(","), "5");
  assert.equal(filterCases(cases, "report_pending").map((v) => v.ancillaryCaseId).join(","), "6");
  assert.equal(filterCases(cases, "procedure_note_pending").map((v) => v.ancillaryCaseId).join(","), "7");
  assert.equal(filterCases(cases, "billing").map((v) => v.ancillaryCaseId).join(","), "9");

  // Needs signature = orderNote OR signature stage, excluding the conflicting one.
  assert.equal(filterCases(cases, "needs_signature").map((v) => v.ancillaryCaseId).sort((a, b) => a - b).join(","), "3,4,8");

  // Screening lens = order-note stage AND canonically screening-required (BW/VW),
  // resolved via the alias table (not a regex). Only case 3 (BrainWave).
  assert.equal(filterCases(cases, "needs_screening").map((v) => v.ancillaryCaseId).join(","), "3");

  // Integrity conflict lens.
  assert.equal(filterCases(cases, "needs_review").map((v) => v.ancillaryCaseId).join(","), "10");

  // Complete lens.
  assert.equal(filterCases(cases, "complete").map((v) => v.ancillaryCaseId).join(","), "11");

  // Unknown id → all.
  assert.equal(filterCases(cases, "nonsense").length, cases.length);
  assert.equal(operationalFilterById("nonsense").id, "all");
  assert.equal(OPERATIONAL_FILTERS[0].id, "all");
}

function testConflictingCaseExcludedFromStageBuckets() {
  // A conflicting orderNote case must NOT count as "needs_signature" (it needs
  // review first) — only the integrity bucket claims it.
  const v = vec({ ancillaryCaseId: 42, currentStage: "orderNote", currentStageIntegrity: "conflicting", serviceType: "BrainWave" });
  assert.equal(operationalFilterById("needs_signature").match(v), false);
  assert.equal(operationalFilterById("needs_screening").match(v), false);
  assert.equal(operationalFilterById("needs_review").match(v), true);
}

function testBucketCounts() {
  const cases: CaseStageVector[] = [
    vec({ ancillaryCaseId: 1, currentStage: "appointment", currentStageIntegrity: "resolved" }),
    vec({ ancillaryCaseId: 2, currentStage: "appointment", currentStageIntegrity: "resolved" }),
    vec({ ancillaryCaseId: 3, currentStage: null, currentStageIntegrity: "resolved" }),
  ];
  const counts = bucketCounts(cases);
  assert.equal(counts.all, 3);
  assert.equal(counts.needs_scheduling, 2);
  assert.equal(counts.complete, 1);
}

async function run() {
  testStageLabelsComplete();
  testNextActionFromServerCurrentStage();
  testNextActionComplete();
  testNextActionIntegrityConflict();
  testCaseBlockersAggregation();
  testOperationalFiltersMapToCurrentStage();
  testConflictingCaseExcludedFromStageBuckets();
  testBucketCounts();
  console.log("caseStageOperational.test.ts: all tests passed");
}

run();
