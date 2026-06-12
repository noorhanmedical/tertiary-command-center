// QA: Patient Directory live import UI + confirm (Part 8).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

// Dialog file + helpers
const ACT = read("client/src/components/patient-directory/PatientDirectoryActions.tsx") ?? "";
for (const n of [
  "BulkImportDialog",
  "importPreview",
  "importConfirm",
  "patient-directory-bulk-import-dialog",
  "patient-directory-bulk-import-preview",
  "patient-directory-bulk-import-confirm",
  "missing_required_fields",
  "Confirm import",
  "parsing not supported",
]) if (!ACT.includes(n)) failures.push(`PatientDirectoryActions missing "${n}"`);

// Live page wires the dialog up.
const LIVE = read("client/src/components/patient-directory/PatientDirectoryLivePage.tsx") ?? "";
for (const n of [
  "BulkImportDialog",
  "bulkImportOpen",
  "onBulkImport",
]) if (!LIVE.includes(n)) failures.push(`PatientDirectoryLivePage missing "${n}"`);

// Routes already cover preview + confirm.
const RT = read("server/routes/patientDirectory.ts") ?? "";
for (const n of [
  '"/api/patient-directory/import-preview"',
  '"/api/patient-directory/import-confirm"',
]) if (!RT.includes(n)) failures.push(`routes missing "${n}"`);

if (failures.length > 0) {
  console.error("Patient Directory live import UI QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Directory live import UI QA passed.");
