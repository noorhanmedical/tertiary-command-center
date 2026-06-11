// QA: Patient Directory runtime implementation audit (Batch B3).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/patient-directory-runtime-implementation-audit.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "Patient Directory runtime implementation audit",
  "source-of-truth ownership is already established",
  "What today's schema persists per patient",
  "patient_screenings.name",
  "patient_screenings.adminApprovalStatus",
  "scheduler_assignments",
  "patient_execution_cases",
  "outreach_calls",
  "cooldown_records",
  "patient_journey_events",
  "patient_test_history",
  "documents",
  "audit_log",
  "Implicit DNC + cooldown today",
  "refused_dnc",
  "What Patient Directory routes / components exist today",
  "patient-database.tsx",
  "server/routes/patientDatabase.ts",
  "Runtime gaps that can be closed without migration",
  "Gaps that require schema work",
  "patient_screenings.mrn",
  "patient_directory_events",
  "How subsequent batches consume this audit",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

// Confirm the tables the audit references actually exist.
{
  const schemaFiles = [
    "shared/schema/screening.ts",
    "shared/schema/outreach.ts",
    "shared/schema/cooldown.ts",
    "shared/schema/executionCase.ts",
    "shared/schema/patientHistory.ts",
    "shared/schema/audit.ts",
    "shared/schema/documents.ts",
  ];
  for (const rel of schemaFiles) {
    if (read(rel) === null) failures.push(`Audit references missing schema file: ${rel}`);
  }
}

if (failures.length > 0) {
  console.error("Patient Directory runtime audit QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Directory runtime audit QA passed.");
