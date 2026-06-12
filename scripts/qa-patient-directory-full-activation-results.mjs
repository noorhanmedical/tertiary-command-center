// QA: Patient Directory full-activation final report (Batch N).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/patient-directory-full-activation-results.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "Patient Directory full-activation — final report",
  "Branch + PR",
  "Migrations",
  "Endpoints registered",
  "Service methods added",
  "UI surfaces wired",
  "What is live now",
  "What remains scaffold / deferred",
  "Validation snapshot",
  "Replit pull instructions",
  "Rollback considerations",
  "Safe to merge?",
  "Review checklist for Ali",
  "Replit must NOT pull this branch",
  "USE_PATIENT_DIRECTORY_ACTIVATION",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

// All B-N companion files / scripts present.
for (const rel of [
  "migrations/0026_add_patient_screening_mrn.sql",
  "docs/architecture/patient-directory-full-activation-blockers.md",
  "server/services/patientDirectory/patientDirectoryActivationFlag.ts",
  "server/services/patientDirectory/patientDirectoryStorageDeps.ts",
  "server/services/patientDirectory/patientDirectoryWriter.ts",
  "server/routes/patientDirectory.ts",
  "client/src/lib/patientDirectoryApi.ts",
  "client/src/lib/useLiveDuplicateWarnings.ts",
  "client/src/components/patient-directory/PatientDirectoryLivePage.tsx",
  "scripts/qa-patient-directory-persistence-migrations.mjs",
  "scripts/qa-patient-directory-persistence-service.mjs",
  "scripts/qa-patient-directory-routes.mjs",
  "scripts/qa-patient-directory-client-api.mjs",
  "scripts/qa-patient-directory-ui-route-wiring.mjs",
  "scripts/qa-patient-directory-duplicate-warning-live-wiring.mjs",
  "scripts/qa-patient-directory-import-confirm.mjs",
  "scripts/qa-patient-directory-prior-test-persistence.mjs",
  "scripts/qa-patient-directory-dnc-cooldown-persistence.mjs",
  "scripts/qa-patient-directory-audit-events.mjs",
  "scripts/smoke-patient-directory-full-activation.mjs",
]) if (read(rel) === null) failures.push(`Missing companion: ${rel}`);

if (failures.length > 0) {
  console.error("Patient Directory full-activation results QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Directory full-activation results QA passed.");
