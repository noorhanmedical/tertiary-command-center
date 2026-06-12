// QA: Patient Directory client API helper (Batch D).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const API = "client/src/lib/patientDirectoryApi.ts";
const c = read(API);
if (c === null) failures.push(`Missing file: ${API}`);
else for (const n of [
  "searchPatientDirectory",
  "getPatientDirectorySnapshot",
  "getPatientDirectoryAudit",
  "getPatientDirectoryRestrictions",
  "getPatientDirectoryPriorTests",
  "createPatientDirectoryProfile",
  "updatePatientDirectoryProfile",
  "importPreview",
  "importConfirm",
  "addPriorTest",
  "setDoNotContact",
  "clearDoNotContact",
  "setCooldown",
  "clearCooldown",
  "logPatientDirectoryEvent",
  "fetchDuplicateWarningFacts",
  "isPatientDirectoryActivationReachable",
  "apiRequest",
  "/api/patient-directory/search",
  "/api/patient-directory/duplicate-warning-facts",
  "/api/patient-directory/import-preview",
  "/api/patient-directory/import-confirm",
]) if (!c.includes(n)) failures.push(`${API} missing "${n}"`);

// Helper uses existing apiRequest / fetch — no new dependency imports.
if (c && /from "axios"|from "ky"|from "superagent"/.test(c)) {
  failures.push(`${API} introduces unauthorized HTTP dependency`);
}

if (failures.length > 0) {
  console.error("Patient Directory client API QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Directory client API QA passed.");
