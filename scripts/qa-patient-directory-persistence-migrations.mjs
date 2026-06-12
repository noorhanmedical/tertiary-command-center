// QA: Patient Directory persistence migrations (Batch A).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

// §1 — 0026 committed.
const M26 = "migrations/0026_add_patient_screening_mrn.sql";
const c26 = read(M26);
if (c26 === null) failures.push(`Missing migration: ${M26}`);
else {
  for (const n of [
    "ALTER TABLE patient_screenings",
    "ADD COLUMN IF NOT EXISTS mrn text",
    "CREATE INDEX IF NOT EXISTS idx_patient_screenings_mrn",
  ]) if (!c26.includes(n)) failures.push(`Missing "${n}" in ${M26}`);
  // No FK, no NOT NULL, no DEFAULT (lowest-risk additive).
  if (/REFERENCES /.test(c26)) failures.push(`${M26}: should not introduce foreign keys`);
  if (/NOT NULL/.test(c26)) failures.push(`${M26}: should be nullable to avoid backfill`);
}

// §2 — Migrations 0027/0028/0029 must NOT be committed (auto-mode policy).
//      Their SQL must be inlined in the blockers doc instead.
for (const f of [
  "0027_add_patient_screening_do_not_contact.sql",
  "0028_add_screening_batch_source_file.sql",
  "0029_add_patient_directory_events.sql",
]) {
  if (fs.existsSync(path.join(root, "migrations", f))) {
    failures.push(`Migration ${f} unexpectedly committed — should be inlined in blockers doc`);
  }
}

// §3 — Blockers doc contains the full SQL for 0027/0028/0029.
const DOC = "docs/architecture/patient-directory-full-activation-blockers.md";
const cdoc = read(DOC);
if (cdoc === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "0027_add_patient_screening_do_not_contact.sql",
  "0028_add_screening_batch_source_file.sql",
  "0029_add_patient_directory_events.sql",
  "do_not_contact boolean NOT NULL DEFAULT false",
  "do_not_contact_set_by_user_id",
  "source_file_name text",
  "source_importer_user_id",
  "CREATE TABLE IF NOT EXISTS patient_directory_events",
  "kind                  text NOT NULL",
  "USE_PATIENT_DIRECTORY_ACTIVATION",
  "default OFF",
]) if (!cdoc.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

// §4 — Apply order documented.
if (cdoc && !cdoc.includes("## Apply order")) failures.push(`${DOC} missing Apply order section`);

if (failures.length > 0) {
  console.error("Patient Directory persistence migrations QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Directory persistence migrations QA passed.");
