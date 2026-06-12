// QA: Patient Directory API runtime / scaffold (Batch B4).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }
function requireFile(rel) { const c = read(rel); if (c === null) failures.push(`Missing file: ${rel}`); return c; }
function requireText(rel, needles) {
  const c = read(rel);
  if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (!c.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
}
function requireNotText(rel, needles, label) {
  const c = read(rel);
  if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (c.includes(n)) failures.push(`${label}: ${rel} contains "${n}"`);
}

const SVC = "server/services/patientDirectory/patientDirectoryService.ts";
const TEST = "server/services/patientDirectory/__tests__/patientDirectoryService.test.ts";
const BLOCKERS = "docs/architecture/patient-directory-runtime-blockers.md";

requireFile(SVC);
requireFile(TEST);
requireFile(BLOCKERS);

requireText(SVC, [
  "PatientDirectorySnapshot",
  "PatientDirectoryProfile",
  "PatientDirectoryEngagementSummary",
  "PatientDirectoryCallHistoryEntry",
  "PatientDirectoryCooldown",
  "PatientDirectoryPriorTest",
  "PatientDirectoryEvent",
  "getPatientDirectorySnapshot",
  "isPatientDirectoryServiceEnabled",
  "USE_PATIENT_DIRECTORY_SERVICE",
  "sent_to_engagement",
  "admin_review_approved",
  "dnc_set",
  "dnc_cleared",
  "cooldown_set",
  "cooldown_cleared",
  "prior_test_logged",
]);

requireText(BLOCKERS, [
  "Patient Directory runtime blockers",
  "0026_add_patient_screening_mrn.sql",
  "0027_add_patient_screening_do_not_contact.sql",
  "0028_add_screening_batch_source_file.sql",
  "0029_add_patient_directory_events.sql",
  "this branch does NOT commit the migrations",
  "What this branch ships instead",
  "Apply order (when approved)",
]);

// Purity — no db / express / schema / routes / PHI logging.
requireNotText(SVC, [
  'from "../../db"',
  'from "../../../db"',
  'from "drizzle-orm"',
  'from "express"',
  'from "@shared/schema"',
  'from "../../routes/',
  'from "../../storage"',
  "console.log",
  "console.info",
], "patient directory service must stay pure");

// Activation branch wires server/routes/patientDirectory.ts to consume
// the scaffold via patientDirectoryStorageDeps. Authorized importers
// allowlist scoped to that route file.
{
  const ALLOWED_ROUTES = new Set([
    "server/routes/patientDirectory.ts",
  ]);
  const ROUTES = path.join(root, "server/routes");
  const RE = /(?:from|import)\s+['"][^'"]*\/patientDirectoryService(?:\.\w+)?['"]/;
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(ts|tsx|mts|cts)$/.test(e.name)) continue;
      const rel = path.relative(root, abs);
      if (ALLOWED_ROUTES.has(rel)) continue;
      const src = fs.readFileSync(abs, "utf8");
      if (RE.test(src)) failures.push(`Route ${rel} unauthorized importer of patientDirectoryService`);
    }
  }
  walk(ROUTES);
}

// 0027/0028/0029 migration files must still NOT be committed; 0026
// is now committed by the activation branch (lowest-risk additive
// column, approved in the run brief).
{
  const migrations = fs.readdirSync(path.join(root, "migrations")).filter((f) => /^00(2[7-9])/.test(f));
  if (migrations.length > 0) {
    failures.push(`Migrations 0027-0029 must remain in the activation blockers doc; found committed: ${migrations.join(", ")}`);
  }
}

// Run the unit test.
if (failures.length === 0) {
  try { execSync(`npx tsx ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] }); }
  catch { failures.push("Patient Directory service test FAILED"); }
}

if (failures.length > 0) {
  console.error("Patient Directory API scaffold QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Directory API scaffold QA passed.");
