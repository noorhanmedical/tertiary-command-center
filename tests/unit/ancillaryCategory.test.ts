// Unit test for getAncillaryCategory — the shared classifier used by:
//   - server/routes/batches.ts (calendar-summary aggregation)
//   - server/services/plexusIq/adminReviewRegenerateAncillaryService.ts
//   - server/services/plexusIq/adminReviewRegenerateAllService.ts
//   - server/services/plexusIq/adminReviewRemoveService.ts
//   - server/services/ancillary/ancillaryReadinessRules.ts
//   - server/services/ancillary/ancillaryReadinessSummary.ts
//   - client/src/features/schedule/ancillaryMeta.tsx
//   - client/src/components/plexus-iq/PlexusIQCalendar.tsx
//
// The classifier does substring matching (t.includes(k)) on the
// lowercased serviceType. That means keyword variants must be listed
// explicitly — "aorta" does NOT match "aortic", and "abdomen" does NOT
// match "abdominal". These tests lock the current recognized surface
// AND regress the two adjective-form gaps.

import assert from "node:assert/strict";
import { getAncillaryCategory } from "../../shared/ancillaryCategory";

let failures = 0;
function expect(actual: unknown, expected: unknown, label: string): void {
  try {
    assert.strictEqual(actual, expected);
  } catch {
    failures++;
    console.error(`- ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─── §1: brainwave category ───────────────────────────────────────
expect(getAncillaryCategory("BrainWave"), "brainwave", "§1 BrainWave");
expect(getAncillaryCategory("EEG Study"), "brainwave", "§1 EEG");
expect(getAncillaryCategory("Neuro Diagnostics"), "brainwave", "§1 Neuro");

// ─── §2: vitalwave category ───────────────────────────────────────
expect(getAncillaryCategory("VitalWave"), "vitalwave", "§2 VitalWave");
expect(getAncillaryCategory("EKG"), "vitalwave", "§2 EKG");
expect(getAncillaryCategory("ECG (93000)"), "vitalwave", "§2 ECG");
expect(getAncillaryCategory("Cardiac monitor"), "vitalwave", "§2 Cardiac");

// ─── §3: ultrasound category — noun forms already worked ──────────
expect(getAncillaryCategory("Carotid Doppler"), "ultrasound", "§3 Carotid");
expect(getAncillaryCategory("Renal Ultrasound"), "ultrasound", "§3 Renal");
expect(getAncillaryCategory("Thyroid Ultrasound"), "ultrasound", "§3 Thyroid");
expect(getAncillaryCategory("Pelvic Ultrasound"), "ultrasound", "§3 Pelvic");
expect(getAncillaryCategory("Echocardiogram TTE (93306)"), "ultrasound", "§3 Echo");
expect(getAncillaryCategory("Aorta Doppler"), "ultrasound", "§3 Aorta noun");
expect(getAncillaryCategory("Abdomen study"), "ultrasound", "§3 Abdomen noun");

// ─── §4: ultrasound category — adjective forms (regression) ───────
// These previously mis-classified as "other" because "aortic" does not
// contain the substring "aorta" and "abdominal" does not contain the
// substring "abdomen". The fix adds those adjective forms explicitly.
expect(getAncillaryCategory("Aortic Doppler"), "ultrasound", "§4 Aortic adjective");
expect(getAncillaryCategory("Abdominal Ultrasound"), "ultrasound", "§4 Abdominal adjective");
expect(getAncillaryCategory("Aortic ultrasound"), "ultrasound", "§4 lowercase adjective");
expect(getAncillaryCategory("ABDOMINAL DOPPLER"), "ultrasound", "§4 uppercase adjective");

// ─── §5: unknowns fall through to other ───────────────────────────
expect(getAncillaryCategory("Pulmonary Function Test"), "other", "§5 PFT → other");
expect(getAncillaryCategory(""), "other", "§5 empty → other");
expect(getAncillaryCategory("N/A"), "other", "§5 N/A → other");

if (failures > 0) {
  console.error(`ancillaryCategory.test.ts: ${failures} failure(s)`);
  process.exit(1);
}
console.log("ancillaryCategory.test.ts: all tests passed");
