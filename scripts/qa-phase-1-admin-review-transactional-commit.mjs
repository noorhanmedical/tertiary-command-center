// QA — Admin Review approval commit fan-out audit.
//
// The /api/patient-screenings/:id/admin-approval handler fans out to
// multiple downstream surfaces:
//
//   1. patient_screenings.adminApprovalStatus update (REQUIRED)
//   2. commitPatient(id, userId, { auto: true })       (REQUIRED on approve)
//      → execution case create-or-update
//      → engagement assignment routing via Scheduler Settings
//   3. patientJourneyEvents insert "admin_approval_updated" (OPTIONAL)
//   4. logAudit (OPTIONAL, fire-and-forget)
//   5. invalidatePatientDatabase() (cache only)
//
// Phase 1 contract:
//   - REQUIRED writes (1 + 2) must succeed together or fail together.
//   - On execution case / engagement routing failure, the response must
//     surface the failure to the client (no silent failure).
//   - OPTIONAL writes (3 + 4) may fail without blocking the request,
//     but failures must be logged.
//
// This QA asserts the source-level contract. The transactional
// wrapping of patient_screening + commitPatient + journey event into a
// single DB transaction is intentionally deferred to Phase 2 because
// commitPatient is a multi-write service that needs its own audit
// before being placed inside a tx. See docs/architecture/phase-1-full-
// system-inventory.md §12.
//
// Run: node scripts/qa-phase-1-admin-review-transactional-commit.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

function requireText(rel, needles) {
  const src = read(rel);
  if (src === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const n of needles) {
    if (!src.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
  }
}

const patientsRoute = "server/routes/patients.ts";

// 1) The required REQUIRED-writes block (admin-approval handler).
requireText(patientsRoute, [
  "/api/patient-screenings/:id/admin-approval",
  "storage.updatePatientScreening",
  "adminApprovalStatus",
  "commitPatient",
  // PHASE-1 fan-out audit marker — placed by Slice 1.3 in a top-of-
  // handler comment so future refactors don't accidentally regress.
  "PHASE-1 ADMIN-REVIEW COMMIT FAN-OUT",
]);

// 2) Silent-failure guard: when commitPatient throws on an approval,
//    the response must surface the failure to the client. The
//    canonical shape introduced in Slice 1.3 uses:
//      commitFailed: boolean
//      commitError: string | null
//    Both must be present in the JSON response payload so the client
//    can distinguish "no commit attempted" from "commit attempted and
//    failed".
requireText(patientsRoute, [
  "commitFailed",
  "commitError",
]);

// 3) Audit-trail capture: the optional patientJourneyEvents insert must
//    include the commit-failure flags in its metadata so the failure is
//    preserved in the audit trail even when the engagement routing
//    couldn't complete.
requireText(patientsRoute, [
  "[admin-approval] commit/scheduler routing failed:",
  "[admin-approval] journey event append failed:",
  "eventType: \"admin_approval_updated\"",
]);

if (failures.length > 0) {
  console.error("Admin Review transactional-commit QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Admin Review transactional-commit QA passed.");
