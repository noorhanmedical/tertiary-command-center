// Task 2 — Ultrasound category expansion / service filter classification.
//
// filterServiceNamesByCategory is the PURE classification step of category
// expansion (Ultrasound → canonical ultrasound service names), reusing the
// shared getAncillaryCategory taxonomy. The DB distinct-scan + fail-closed
// SQL behavior is covered at the acceptance level; this locks the exact
// canonical category membership per selection.
//
// Run: DATABASE_URL='postgres://u:p@localhost:5432/x' npx tsx tests/unit/callListServiceFilter.test.ts

import assert from "node:assert/strict";
import { filterServiceNamesByCategory } from "../../server/services/engagement/callListCohortService";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Representative set of real service/test names that appear in selected_services.
const ALL_NAMES = [
  "BrainWave",
  "VitalWave",
  "Bilateral Carotid Duplex (93880)",
  "Echocardiogram TTE",
  "Renal Artery Doppler",
  "Lower Extremity Arterial Doppler",
  "Lower Extremity Venous Duplex",
  "Abdominal Aortic Aneurysm Duplex",
  "Stress Echocardiogram",
];

console.log("callListServiceFilter:");

check("Ultrasound expands to ONLY the canonical ultrasound names", () => {
  const us = filterServiceNamesByCategory(ALL_NAMES, ["ultrasound"]).sort();
  assert.deepEqual(
    us,
    [
      "Abdominal Aortic Aneurysm Duplex",
      "Bilateral Carotid Duplex (93880)",
      "Echocardiogram TTE",
      "Lower Extremity Arterial Doppler",
      "Lower Extremity Venous Duplex",
      "Renal Artery Doppler",
      "Stress Echocardiogram",
    ].sort(),
  );
  // BrainWave / VitalWave excluded.
  assert.ok(!us.includes("BrainWave"));
  assert.ok(!us.includes("VitalWave"));
});

check("BrainWave only", () => {
  assert.deepEqual(filterServiceNamesByCategory(ALL_NAMES, ["brainwave"]), ["BrainWave"]);
});

check("VitalWave only", () => {
  assert.deepEqual(filterServiceNamesByCategory(ALL_NAMES, ["vitalwave"]), ["VitalWave"]);
});

check("BrainWave + Ultrasound", () => {
  const r = filterServiceNamesByCategory(ALL_NAMES, ["brainwave", "ultrasound"]);
  assert.ok(r.includes("BrainWave"));
  assert.ok(r.includes("Renal Artery Doppler"));
  assert.ok(!r.includes("VitalWave"));
});

check("VitalWave + Ultrasound", () => {
  const r = filterServiceNamesByCategory(ALL_NAMES, ["vitalwave", "ultrasound"]);
  assert.ok(r.includes("VitalWave"));
  assert.ok(r.includes("Echocardiogram TTE"));
  assert.ok(!r.includes("BrainWave"));
});

check("no categories → empty (caller treats as no filter / All Ancillaries)", () => {
  assert.deepEqual(filterServiceNamesByCategory(ALL_NAMES, []), []);
});

check("dedupes + skips blanks/nulls", () => {
  const r = filterServiceNamesByCategory(["BrainWave", "BrainWave", "", null, undefined, "  "], ["brainwave"]);
  assert.deepEqual(r, ["BrainWave"]);
});

console.log(`\ncallListServiceFilter: ${passed} checks passed\n`);
