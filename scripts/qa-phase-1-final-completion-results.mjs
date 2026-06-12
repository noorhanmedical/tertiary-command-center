// QA: Phase 1 final-completion results report (Part 14).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/phase-1-final-completion-results.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "Phase 1 final-completion results",
  "Branch + PR",
  "Validation snapshot",
  "What was finished in this pass",
  "Migration status",
  "Activation flag",
  "What is now visible in Plexus IQ",
  "Confirmation matrix",
  "Replit pull instructions",
  "Safe to merge?",
  "DO NOT MERGE",
  "USE_PATIENT_DIRECTORY_ACTIVATION",
  "0026_add_patient_screening_mrn.sql",
  "0027_add_patient_screening_do_not_contact.sql",
  "0028_add_screening_batch_source_file.sql",
  "0029_add_patient_directory_events.sql",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

if (failures.length > 0) {
  console.error("Phase 1 final-completion results QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Phase 1 final-completion results QA passed.");
