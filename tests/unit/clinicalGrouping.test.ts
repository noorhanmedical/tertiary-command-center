// Unit tests for deterministic EHR clinical grouping helpers.
//   npx tsx tests/unit/clinicalGrouping.test.ts

import assert from "node:assert/strict";
import {
  icd10System, isPrnFrequency, allergySeverityTone, ORGAN_SYSTEM_ORDER,
} from "../../client/src/components/patient-directory/clinicalGrouping";

let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`ok  ${name}`); }
  catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).message}`); }
}

test("ICD-10 chapters map to organ systems", () => {
  assert.equal(icd10System("I10"), "Cardiovascular");
  assert.equal(icd10System("G20"), "Neurologic");
  assert.equal(icd10System("E11.9"), "Endocrine / Metabolic");
  assert.equal(icd10System("J45"), "Pulmonary");
  assert.equal(icd10System("K21.9"), "Gastrointestinal");
  assert.equal(icd10System("N18.3"), "Renal / Genitourinary");
  assert.equal(icd10System("M54.5"), "Musculoskeletal");
  assert.equal(icd10System("F41.1"), "Psychiatric");
  assert.equal(icd10System("C50"), "Neoplasm");
});

test("D and H sub-ranges split correctly", () => {
  assert.equal(icd10System("D12"), "Neoplasm");        // D00–D49
  assert.equal(icd10System("D64"), "Blood / Immune");  // D50–D89
  assert.equal(icd10System("H40"), "Ophthalmologic");  // H00–H59
  assert.equal(icd10System("H66"), "Ear / Mastoid");   // H60–H95
});

test("absent / unknown codes fall back to Other", () => {
  assert.equal(icd10System(null), "Other");
  assert.equal(icd10System(""), "Other");
  assert.equal(icd10System("Z99"), "Other");
});

test("Other is last in the canonical order", () => {
  assert.equal(ORGAN_SYSTEM_ORDER[ORGAN_SYSTEM_ORDER.length - 1], "Other");
});

test("PRN frequency detection", () => {
  assert.equal(isPrnFrequency("PRN"), true);
  assert.equal(isPrnFrequency("1 tab as needed for pain"), true);
  assert.equal(isPrnFrequency("as-needed"), true);
  assert.equal(isPrnFrequency("twice daily"), false);
  assert.equal(isPrnFrequency(null), false);
});

test("allergy severity tone", () => {
  assert.equal(allergySeverityTone("Severe"), "rose");
  assert.equal(allergySeverityTone("anaphylaxis"), "rose");
  assert.equal(allergySeverityTone("Moderate"), "amber");
  assert.equal(allergySeverityTone("mild"), "neutral");
  assert.equal(allergySeverityTone(null), "neutral");
});

if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
console.log(`\nAll clinicalGrouping tests passed`);
