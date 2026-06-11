// QA: Patient Directory + duplicate-warning final report (Batch B16).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DOC = "docs/architecture/patient-directory-duplicate-warning-results.md";
const c = read(DOC);
if (c === null) failures.push(`Missing file: ${DOC}`);
else for (const n of [
  "Patient Directory + duplicate-warning runtime — final report",
  "Branch + PR",
  "Files added (this branch)",
  "Schema / migration status",
  "Duplicate warning surfaces added",
  "Patient Directory runtime status",
  "Audit trail status",
  "Import status",
  "DNC / cooldown status",
  "Prior ancillary status",
  "PDF / packet selection status",
  "Validation snapshot",
  "Remaining blockers",
  "Replit readiness checklist",
  "Replit must NOT pull this branch",
  "Review checklist for Ali",
  "What is real runtime vs scaffold",
]) if (!c.includes(n)) failures.push(`Missing "${n}" in ${DOC}`);

// Smoke script referenced.
if (read("scripts/smoke-patient-directory-duplicates.mjs") === null) {
  failures.push("scripts/smoke-patient-directory-duplicates.mjs missing");
}

// All B-batch QA scripts present.
for (const rel of [
  "scripts/qa-patient-identity-helper.mjs",
  "scripts/qa-qualification-run-ordering.mjs",
  "scripts/qa-patient-directory-runtime-implementation-audit.mjs",
  "scripts/qa-patient-directory-api-runtime-or-scaffold.mjs",
  "scripts/qa-patient-duplicate-warning-engine.mjs",
  "scripts/qa-run-comparison-selector-ui.mjs",
  "scripts/qa-plexus-iq-duplicate-warning-ui.mjs",
  "scripts/qa-admin-review-duplicate-warning-ui.mjs",
  "scripts/qa-engagement-team-portal-duplicate-warning-ui.mjs",
  "scripts/qa-patient-audit-trail-modal.mjs",
  "scripts/qa-patient-directory-ui-scaffold.mjs",
  "scripts/qa-patient-directory-import-preview.mjs",
  "scripts/qa-patient-directory-contact-restrictions-cooldown.mjs",
  "scripts/qa-prior-ancillary-history-warning.mjs",
  "scripts/qa-pdf-packet-patient-selection-dialog.mjs",
]) if (read(rel) === null) failures.push(`Missing QA script: ${rel}`);

if (failures.length > 0) {
  console.error("Patient Directory + duplicate-warning final report QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Directory + duplicate-warning final report QA passed.");
