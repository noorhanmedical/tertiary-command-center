// Unit tests for the bounded FROZEN snapshot builders (Task 6).
//
// Verifies PHI minimization: reasoning is bounded to Clinician-Atlas-rendered
// keys and only the patient's qualifying tests; patient_talking_points +
// icd10_codes are dropped; Dx/Hx/Rx (approved) are frozen; demographics are the
// bounded roster subset. Also documents package-member IMMUTABILITY: the
// repository exposes NO member-mutation function (only header lifecycle).
//
// Run: DATABASE_URL='postgres://u:p@localhost:5432/x' npx tsx tests/unit/callListSnapshot.test.ts

import assert from "node:assert/strict";
import {
  boundReasoning,
  buildAtlasPayloadSnapshot,
  buildDemographicsSnapshot,
  buildQualificationSummary,
} from "../../shared/engagement/callListSnapshot";
import * as packagesRepo from "../../server/repositories/callListPackages.repo";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Minimal PatientScreening-like fixture (only the fields the builders read).
const patient: any = {
  name: "Jane Smith",
  dob: "1950-04-02",
  age: 75,
  gender: "F",
  phoneNumber: "555-0100",
  email: "jane@example.com",
  insurance: "Medicare",
  facility: "Taylor Family Practice",
  time: "09:00",
  qualifyingTests: ["BrainWave", "Renal Artery Doppler"],
  reasoning: {
    BrainWave: {
      clinician_understanding: "Memory decline noted.",
      patient_talking_points: "SHOULD NOT be frozen.",
      qualifying_factors: ["age > 65", "memory complaints"],
      confidence: "high",
      icd10_codes: ["G31.84"],
      pearls: ["Screen early."],
      approvalRequired: true,
    },
    // reasoning for a test the patient is NOT qualified for → must be dropped.
    "Echocardiogram TTE": { clinician_understanding: "not qualified — drop me" },
  },
  diagnoses: "HTN, mild cognitive impairment",
  history: "Family hx dementia",
  medications: "Lisinopril",
  previousTests: "None",
  previousTestsDate: null,
};

console.log("callListSnapshot:");

check("boundReasoning keeps only rendered keys for qualifying tests", () => {
  const bounded = boundReasoning(patient.reasoning, patient.qualifyingTests);
  // Only qualifying tests present.
  assert.deepEqual(Object.keys(bounded).sort(), ["BrainWave"]);
  const bw = bounded.BrainWave;
  assert.equal(bw.clinician_understanding, "Memory decline noted.");
  assert.deepEqual(bw.qualifying_factors, ["age > 65", "memory complaints"]);
  assert.equal(bw.confidence, "high");
  assert.deepEqual(bw.pearls, ["Screen early."]);
  // Excluded keys must NOT be frozen.
  assert.equal((bw as any).patient_talking_points, undefined);
  assert.equal((bw as any).icd10_codes, undefined);
  assert.equal((bw as any).approvalRequired, undefined);
});

check("boundReasoning handles string reasoning + missing gracefully", () => {
  const bounded = boundReasoning({ BrainWave: "just a string" }, ["BrainWave"]);
  assert.equal(bounded.BrainWave.clinician_understanding, "just a string");
  assert.deepEqual(boundReasoning(null, ["BrainWave"]), {});
  assert.deepEqual(boundReasoning({}, ["BrainWave"]), {});
});

check("buildAtlasPayloadSnapshot freezes render-ready bounded fields incl Dx/Hx/Rx", () => {
  const atlas = buildAtlasPayloadSnapshot(patient);
  assert.equal(atlas.name, "Jane Smith");
  assert.equal(atlas.dob, "1950-04-02");
  assert.equal(atlas.age, 75);
  assert.equal(atlas.phoneNumber, "555-0100");
  assert.equal(atlas.email, "jane@example.com");
  assert.equal(atlas.insurance, "Medicare");
  assert.deepEqual(atlas.qualifyingTests, ["BrainWave", "Renal Artery Doppler"]);
  assert.deepEqual(Object.keys(atlas.reasoning).sort(), ["BrainWave"]);
  // Chart review (approved) frozen.
  assert.equal(atlas.diagnoses, "HTN, mild cognitive impairment");
  assert.equal(atlas.history, "Family hx dementia");
  assert.equal(atlas.medications, "Lisinopril");
});

check("buildDemographicsSnapshot is the bounded roster subset (no name/dob/phone)", () => {
  const d = buildDemographicsSnapshot(patient);
  assert.deepEqual(d, {
    age: 75,
    gender: "F",
    insurance: "Medicare",
    facility: "Taylor Family Practice",
    email: "jane@example.com",
    time: "09:00",
  });
  assert.equal((d as any).name, undefined);
  assert.equal((d as any).phoneNumber, undefined);
});

check("buildQualificationSummary lists services + per-test confidence", () => {
  const q = buildQualificationSummary(patient);
  assert.deepEqual(q.qualifyingTests, ["BrainWave", "Renal Artery Doppler"]);
  assert.equal(q.confidenceByTest.BrainWave, "high");
  assert.equal(q.confidenceByTest["Renal Artery Doppler"], undefined);
});

check("package IMMUTABILITY — repo exposes no member-mutation function", () => {
  const repo = packagesRepo as Record<string, unknown>;
  // Only header lifecycle mutations exist; members are never updated/deleted
  // after creation. Guard against a future accidental mutator.
  for (const forbidden of [
    "updatePackageMember",
    "updateMembers",
    "updatePackageMembers",
    "setMember",
    "deleteMember",
    "removeMember",
  ]) {
    assert.equal(typeof repo[forbidden], "undefined", `unexpected member mutator: ${forbidden}`);
  }
  // Sanity: the creation + header-lifecycle functions DO exist.
  for (const present of [
    "createPackageForMember",
    "setGenerationStatus",
    "revokePackageShare",
    "extendPackageShare",
    "regeneratePackageShareToken",
  ]) {
    assert.equal(typeof repo[present], "function", `missing expected fn: ${present}`);
  }
});

console.log(`\ncallListSnapshot: ${passed} checks passed\n`);
