// QA: import preview/confirm activation (Batch G).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const RT = read("server/routes/patientDirectory.ts") ?? "";
for (const n of [
  '"/api/patient-directory/import-preview"',
  '"/api/patient-directory/import-confirm"',
  "parseCsv",
  "parseTxt",
  "classifyImportRows",
  "createPatientDirectoryProfile",
  'kind: "imported"',
]) if (!RT.includes(n)) failures.push(`routes missing "${n}"`);

// Client API helper exposes import wrappers.
const API = read("client/src/lib/patientDirectoryApi.ts") ?? "";
for (const n of ["importPreview", "importConfirm"]) if (!API.includes(n)) failures.push(`client API missing "${n}"`);

if (failures.length > 0) {
  console.error("Patient Directory import-confirm QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Directory import-confirm QA passed.");
