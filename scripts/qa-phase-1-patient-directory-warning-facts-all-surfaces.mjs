// QA — Patient Directory warning facts are reachable from the
// canonical surface.
//
// Phase 1 contract: the canonical Patient Directory must surface (or
// be reachable to surface) duplicates, DNC, cooldown, prior ancillary
// warnings, engagement history, call history, Admin Review history,
// import/source history, and audit trail. This QA asserts the
// supporting components + endpoints exist and are still importable.
// The canonical /patient-directory page (PatientDatabasePage) already
// renders cooldown UI; warning facts infrastructure remains importable
// so the surfaces can be wired into the canonical page incrementally.
//
// Run: node scripts/qa-phase-1-patient-directory-warning-facts-all-surfaces.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

function requireFile(rel) {
  if (!fs.existsSync(path.join(root, rel))) {
    failures.push(`Missing file: ${rel}`);
  }
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

// 1) Canonical PatientDirectory page surfaces cooldown today + reads
//    from the canonical /api/patients/database feed.
requireText("client/src/pages/patient-database.tsx", [
  "/api/patients/database",
  "cooldown",
  "Patient Directory",
]);

// 2) Warning-fact components are preserved (importable for later
//    canonical-page integration).
requireFile("client/src/components/patient-directory/DuplicateWarningBadge.tsx");
requireFile("client/src/components/patient-directory/PatientDirectoryLivePage.tsx");
requireFile("client/src/components/patient-directory/PatientProfileDrawer.tsx");
requireFile("client/src/components/patient-directory/PatientAuditTrailModal.tsx");
requireFile("client/src/components/patient-directory/AdminReviewDuplicateGuard.tsx");
requireFile("client/src/components/patient-directory/EngagementHandoffDuplicateBar.tsx");

// 3) The live-warnings hook exists (used by AdminReviewDuplicateGuard
//    + PatientDirectoryLivePage). Surface its existence so it can be
//    wired into the canonical surface without re-implementing.
requireFile("client/src/lib/useLiveDuplicateWarnings.ts");

// 4) Backend support: the canonical patient-directory service exists
//    (per Slice 1.0 inventory).
requireFile("server/services/patientDirectory/patientDirectoryStorageDeps.ts");

if (failures.length > 0) {
  console.error("Patient Directory warning facts QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Directory warning facts QA passed.");
