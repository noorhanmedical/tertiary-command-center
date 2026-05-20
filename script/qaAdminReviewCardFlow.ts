// QA for the premium Admin Review card workflow.
//
// Run with: npm run qa:admin-review-card-flow
//
// Verifies (no DB required):
//   1. computeAdminReview returns ready_for_review when intake is
//      complete + qualification present + approval pending.
//   2. Missing DOB / phone / facility flips the result to incomplete.
//   3. Missing qualifying tests flips the result to incomplete.
//   4. Approved + rejected patients are *not* "ready for review".
//   5. Patients already sent to Engagement (commitStatus !== "Draft")
//      are not "ready for review" — they're past the gate.
//   6. The parser still accepts patients with missing DOB / phone as
//      warnings only — qualification is never blocked.
//   7. Category grouping by getAncillaryCategory matches the canonical
//      brainwave / vitalwave / ultrasound buckets.

import { parsePlexusIqClinicalImport } from "../client/src/lib/plexusIqClinicalImportParser";
import { computeAdminReview } from "../client/src/lib/adminReviewStatus";
import { getAncillaryCategory } from "@shared/ancillaryCategory";

let passes = 0;
let failures = 0;
function assert(cond: unknown, label: string) {
  if (cond) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

function basePatient(over: Partial<Parameters<typeof computeAdminReview>[0]> = {}): Parameters<typeof computeAdminReview>[0] {
  return {
    name: "Test Patient",
    dob: "1950-01-01",
    phoneNumber: "(555) 555-0188",
    facility: "TFP",
    qualifyingTests: ["BrainWave EEG", "VitalWave ABI"],
    commitStatus: "Draft",
    adminApprovalStatus: "pending",
    ...over,
  };
}

async function main() {
  // ─── computeAdminReview ────────────────────────────────────────────
  console.log("\n--- computeAdminReview: ready/incomplete cases ---");

  const ready = computeAdminReview(basePatient());
  assert(ready.status === "ready_for_review", "status = ready_for_review when complete + pending");
  assert(ready.readyForAdminReview, "readyForAdminReview=true triggers the lavender card");
  assert(ready.missing.length === 0, "no missing fields");
  assert(ready.hasQualification, "qualification present");
  assert(!ready.isPatientSent, "not yet sent to engagement");

  const noDob = computeAdminReview(basePatient({ dob: "" }));
  assert(noDob.status === "incomplete", "missing DOB → incomplete");
  assert(noDob.missing.includes("DOB"), "missing list mentions DOB");
  assert(!noDob.readyForAdminReview, "missing DOB blocks ready state");

  const noPhone = computeAdminReview(basePatient({ phoneNumber: "" }));
  assert(noPhone.status === "incomplete", "missing phone → incomplete");
  assert(noPhone.missing.includes("phone"), "missing list mentions phone");

  const noFacility = computeAdminReview(basePatient({ facility: "" }));
  assert(noFacility.status === "incomplete", "missing facility → incomplete");
  assert(noFacility.missing.includes("facility"), "missing list mentions facility");

  const noQualification = computeAdminReview(basePatient({ qualifyingTests: [] }));
  assert(noQualification.status === "incomplete", "no qualification → incomplete");
  assert(!noQualification.hasQualification, "hasQualification=false");
  assert(noQualification.missing.includes("qualification"), "missing list mentions qualification");

  const approved = computeAdminReview(basePatient({ adminApprovalStatus: "approved" }));
  assert(approved.status === "approved", "approved status maps through");
  assert(!approved.readyForAdminReview, "approved patients are not 'ready for review'");

  const rejected = computeAdminReview(basePatient({ adminApprovalStatus: "rejected" }));
  assert(rejected.status === "rejected", "rejected status maps through");
  assert(!rejected.readyForAdminReview, "rejected patients are not 'ready for review'");

  const needsInfo = computeAdminReview(basePatient({ adminApprovalStatus: "needs_info" }));
  assert(needsInfo.readyForAdminReview, "needs_info still surfaces as ready (admin can re-decide)");

  const sent = computeAdminReview(basePatient({ commitStatus: "Sent" }));
  assert(sent.isPatientSent, "isPatientSent flag flips when commitStatus differs from Draft");
  assert(!sent.readyForAdminReview, "patients already sent to Engagement are not 'ready for review'");

  // ─── parser independence ──────────────────────────────────────────
  console.log("\n--- parser still accepts missing DOB / phone as warnings ---");
  const head = ["Clinic", "Patient Name", "Dx", "DOB", "Phone Number"].join("\t");
  const noDobRow = ["TFP", "No DOB Patient", "HTN", "", "(602) 555-0188"].join("\t");
  const noPhoneRow = ["TFP", "No Phone Patient", "CAD", "1950-01-01", ""].join("\t");
  const result = parsePlexusIqClinicalImport(`${head}\n${noDobRow}\n${noPhoneRow}`, {});
  assert(result.format === "clinical-spreadsheet", "parser detects clinical format");
  assert(result.rows.length === 2, "both rows still parsed");
  assert(result.errors.length === 0, "no fatal errors for missing contact info");
  assert(
    result.rows.every((r) => (r.warnings ?? []).length > 0),
    "rows surface warnings instead of blocking",
  );

  // ─── category grouping mirrors the front-card tile row ───────────
  console.log("\n--- category grouping matches the card tile row ---");
  const sample = [
    "BrainWave EEG",
    "BrainWave Carotid",
    "VitalWave ABI",
    "Ultrasound Abdominal",
    "Ultrasound Renal",
  ];
  const groups = sample.reduce<Record<string, number>>((acc, t) => {
    const cat = getAncillaryCategory(t);
    acc[cat] = (acc[cat] ?? 0) + 1;
    return acc;
  }, {});
  assert(groups.brainwave === 2, "two brainwave tests bucketed");
  assert(groups.vitalwave === 1, "one vitalwave test bucketed");
  assert(groups.ultrasound === 2, "two ultrasound tests bucketed");

  // ─── delete behavior simulation (filter pattern used in dialog) ──
  console.log("\n--- delete simulation (qualifyingTests filter) ---");
  const beforeDelete = ["BrainWave EEG", "VitalWave ABI", "Ultrasound Renal"];
  const afterDelete = beforeDelete.filter((t) => t !== "VitalWave ABI");
  const reviewAfter = computeAdminReview(
    basePatient({ qualifyingTests: afterDelete }),
  );
  assert(afterDelete.length === 2, "removing one test shrinks the canonical list");
  assert(reviewAfter.hasQualification, "two tests remaining still counts as qualified");

  console.log("\n=========================");
  console.log(`PASS ${passes}  FAIL ${failures}`);
  console.log("=========================");
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
