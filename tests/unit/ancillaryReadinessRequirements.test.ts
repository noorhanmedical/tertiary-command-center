// Phase D — Ancillary readiness requirement tests.
//
// Runs standalone with:
//   npx tsx tests/unit/ancillaryReadinessRequirements.test.ts

import assert from "node:assert/strict";
import {
  requirementsForService,
  readinessCountsForSchedule,
} from "../../server/services/ancillary/ancillaryReadinessRules";

async function testBrainWaveRequiresAll() {
  const r = requirementsForService("BrainWave");
  assert.equal(r.category, "brainwave");
  assert.equal(r.informedConsent, true);
  assert.equal(r.screeningForm, true);
  assert.equal(r.brainwavePdf, true);
}

async function testVitalWaveRequiresConsentAndForm() {
  const r = requirementsForService("VitalWave");
  assert.equal(r.category, "vitalwave");
  assert.equal(r.informedConsent, true);
  assert.equal(r.screeningForm, true);
  assert.equal(r.brainwavePdf, false, "vitalwave never needs the BrainWave PDF");
}

async function testUltrasoundSubtestOnlyNeedsConsent() {
  // Any ultrasound test — parent name or child test name — should map to
  // category=ultrasound and require ONLY informed consent.
  for (const name of [
    "Ultrasound",
    "Bilateral Carotid Duplex (93880)",
    "Echocardiogram TTE (93306)",
    "Renal Artery Doppler (93975)",
  ]) {
    const r = requirementsForService(name);
    assert.equal(r.category, "ultrasound", `expected ultrasound for ${name}`);
    assert.equal(r.informedConsent, true);
    assert.equal(r.screeningForm, false, `${name}: no screening form for ultrasound`);
    assert.equal(r.brainwavePdf, false, `${name}: no BrainWave PDF for ultrasound`);
  }
}

async function testUnknownServiceStillRequiresConsent() {
  const r = requirementsForService("Xylem Analysis");
  // Informed consent is always required regardless of category.
  assert.equal(r.informedConsent, true);
  assert.equal(r.screeningForm, false);
  assert.equal(r.brainwavePdf, false);
}

async function testNullServiceHasCategoryOther() {
  const r = requirementsForService(null);
  assert.equal(r.category, "other");
  assert.equal(r.informedConsent, true);
  assert.equal(r.screeningForm, false);
  assert.equal(r.brainwavePdf, false);
}

async function testUndefinedServiceHasCategoryOther() {
  const r = requirementsForService(undefined);
  assert.equal(r.category, "other");
  assert.equal(r.informedConsent, true);
  assert.equal(r.screeningForm, false);
  assert.equal(r.brainwavePdf, false);
}

async function testEmptyStringServiceHasCategoryOther() {
  const r = requirementsForService("");
  assert.equal(r.category, "other");
  assert.equal(r.informedConsent, true);
  assert.equal(r.screeningForm, false);
}

// ── Dated consent guard (mirrors clinic consentForTest on/after-scheduledDate) ──

async function testDatedGuardNotComplete() {
  // A non-complete status never counts, regardless of dates.
  assert.equal(readinessCountsForSchedule("missing", "2026-08-28T09:00:00Z", "2026-08-28"), false);
  assert.equal(readinessCountsForSchedule("pending", null, null), false);
}

async function testDatedGuardNoScheduledDateSkips() {
  // No scheduledDate → guard skipped (backward-compatible with billing gate).
  assert.equal(readinessCountsForSchedule("completed", "2020-01-01T00:00:00Z", null), true);
  assert.equal(readinessCountsForSchedule("uploaded", null, undefined), true);
}

async function testDatedGuardNoCompletedAtNotFailedRetroactively() {
  // Complete but no provenance timestamp → not failed retroactively.
  assert.equal(readinessCountsForSchedule("completed", null, "2026-08-28"), true);
}

async function testDatedGuardOnOrAfterCounts() {
  // Completed exactly on the scheduled date → counts (inclusive lower bound).
  assert.equal(readinessCountsForSchedule("completed", "2026-08-28T10:00:00Z", "2026-08-28"), true);
  // Completed after → counts.
  assert.equal(readinessCountsForSchedule("approved", "2026-09-01T00:00:00Z", "2026-08-28"), true);
}

async function testDatedGuardStaleBeforeDoesNotCount() {
  // Completed a year before the scheduled date → does NOT count (stale).
  assert.equal(readinessCountsForSchedule("completed", "2025-08-28T09:00:00Z", "2026-08-28"), false);
  // One day before → does NOT count.
  assert.equal(readinessCountsForSchedule("completed", "2026-08-27T23:59:59Z", "2026-08-28"), false);
}

async function main() {
  await testBrainWaveRequiresAll();
  await testVitalWaveRequiresConsentAndForm();
  await testUltrasoundSubtestOnlyNeedsConsent();
  await testUnknownServiceStillRequiresConsent();
  await testNullServiceHasCategoryOther();
  await testUndefinedServiceHasCategoryOther();
  await testEmptyStringServiceHasCategoryOther();
  await testDatedGuardNotComplete();
  await testDatedGuardNoScheduledDateSkips();
  await testDatedGuardNoCompletedAtNotFailedRetroactively();
  await testDatedGuardOnOrAfterCounts();
  await testDatedGuardStaleBeforeDoesNotCount();
  console.log("ancillaryReadinessRequirements.test.ts: all tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
