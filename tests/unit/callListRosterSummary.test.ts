// Unit tests for computeRosterSummary (Task 7) — the pure roster metrics used
// by the package header summaryMetrics AND the PDF summary page.
//
// Run: DATABASE_URL='postgres://u:p@localhost:5432/x' npx tsx tests/unit/callListRosterSummary.test.ts

import assert from "node:assert/strict";
import { computeRosterSummary } from "../../shared/engagement/callListSnapshot";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("callListRosterSummary:");

check("counts totals, ancillary mix (once/patient), and status mix", () => {
  const s = computeRosterSummary([
    { servicesSnapshot: ["BrainWave"], cohortClassificationSnapshot: "never_called" },
    { servicesSnapshot: ["VitalWave", "Renal Artery Doppler"], cohortClassificationSnapshot: "lvm" },
    { servicesSnapshot: ["BrainWave", "Echocardiogram TTE"], cohortClassificationSnapshot: "never_called" },
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.ancillaryMix.brainwave, 2);
  assert.equal(s.ancillaryMix.vitalwave, 1);
  assert.equal(s.ancillaryMix.ultrasound, 2);
  assert.equal(s.statusMix.never_called, 2);
  assert.equal(s.statusMix.lvm, 1);
});

check("empty roster → zeros", () => {
  const s = computeRosterSummary([]);
  assert.equal(s.total, 0);
  assert.deepEqual(s.ancillaryMix, { brainwave: 0, vitalwave: 0, ultrasound: 0, other: 0 });
  assert.deepEqual(s.statusMix, {});
});

check("null services / missing classification handled", () => {
  const s = computeRosterSummary([
    { servicesSnapshot: null, cohortClassificationSnapshot: null },
    { servicesSnapshot: [], cohortClassificationSnapshot: undefined },
  ]);
  assert.equal(s.total, 2);
  assert.equal(s.statusMix.other, 2);
  assert.deepEqual(s.ancillaryMix, { brainwave: 0, vitalwave: 0, ultrasound: 0, other: 0 });
});

console.log(`\ncallListRosterSummary: ${passed} checks passed\n`);
