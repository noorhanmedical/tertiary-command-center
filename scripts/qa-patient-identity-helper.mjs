// QA: Patient identity helper (Batch B1 of duplicate-warning runtime).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const SVC = "shared/patientIdentity.ts";
const TEST = "tests/unit/patientIdentity.test.ts";
for (const rel of [SVC, TEST]) if (read(rel) === null) failures.push(`Missing file: ${rel}`);

const required = [
  "normalizeName",
  "normalizePhone",
  "normalizeDob",
  "normalizeMrn",
  "normalizeFacility",
  "buildPatientIdentityKeys",
  "matchPatientIdentity",
  "explainPatientMatch",
  "PATIENT_MATCH_TIER_LABEL",
  "PATIENT_MATCH_TIER_SCORE",
  "facility_mrn_dob",
  "mrn_dob",
  "name_dob_phone",
  "buildPatientIdentityIndex",
  "lookupPatientInIndex",
];
{
  const c = read(SVC) ?? "";
  for (const n of required) if (!c.includes(n)) failures.push(`shared/patientIdentity.ts missing "${n}"`);
}

// Run the unit test.
if (failures.length === 0) {
  try { execSync(`npx tsx ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] }); }
  catch { failures.push("Patient identity helper test FAILED"); }
}

if (failures.length > 0) {
  console.error("Patient identity helper QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient identity helper QA passed.");
