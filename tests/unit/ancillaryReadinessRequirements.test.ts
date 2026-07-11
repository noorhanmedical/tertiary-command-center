// Phase D — Ancillary readiness requirement tests.
//
// Runs standalone with:
//   npx tsx tests/unit/ancillaryReadinessRequirements.test.ts

import assert from "node:assert/strict";
import { requirementsForService } from "../../server/services/ancillary/ancillaryReadinessRules";

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

async function main() {
  await testBrainWaveRequiresAll();
  await testVitalWaveRequiresConsentAndForm();
  await testUltrasoundSubtestOnlyNeedsConsent();
  await testUnknownServiceStillRequiresConsent();
  await testNullServiceHasCategoryOther();
  await testUndefinedServiceHasCategoryOther();
  await testEmptyStringServiceHasCategoryOther();
  console.log("ancillaryReadinessRequirements.test.ts: all tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
