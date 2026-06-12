// QA: Patient Directory API routes (Batch C).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const RT = "server/routes/patientDirectory.ts";
const r = read(RT);
if (r === null) failures.push(`Missing file: ${RT}`);
else for (const n of [
  "registerPatientDirectoryRoutes",
  "isPatientDirectoryActivationEnabled",
  '"/api/patient-directory/search"',
  '"/api/patient-directory/:patientId"',
  '"/api/patient-directory/:patientId/audit"',
  '"/api/patient-directory/:patientId/prior-tests"',
  '"/api/patient-directory/:patientId/contact-restrictions"',
  '"/api/patient-directory/:patientId/cooldown"',
  '"/api/patient-directory/:patientId/events"',
  '"/api/patient-directory/duplicate-warning-facts"',
  '"/api/patient-directory/import-preview"',
  '"/api/patient-directory/import-confirm"',
  '"/api/patient-directory"',
  "if (!isPatientDirectoryActivationEnabled()) {",
  "createPatientDirectoryStorageDeps",
  "writePatientDirectoryEvent",
  "buildDuplicateFacts",
]) if (!r.includes(n)) failures.push(`${RT} missing "${n}"`);

// Registered in routes.ts.
{
  const reg = read("server/routes.ts") ?? "";
  if (!reg.includes("registerPatientDirectoryRoutes(app)")) {
    failures.push("server/routes.ts must call registerPatientDirectoryRoutes(app)");
  }
  if (!reg.includes('from "./routes/patientDirectory"')) {
    failures.push("server/routes.ts must import registerPatientDirectoryRoutes");
  }
}

// Every handler wraps body in try/catch.
{
  const matches = (r ?? "").match(/app\.(get|post|patch|delete)\([^)]*async \(req, res\) =>/g) ?? [];
  if (matches.length < 12) failures.push(`Expected ≥12 route handlers; found ${matches.length}`);
  // Each handler should have try/catch — count "try {" occurrences.
  const tryCount = ((r ?? "").match(/try {/g) ?? []).length;
  if (tryCount < matches.length) failures.push(`Each handler should be wrapped in try/catch (try=${tryCount} vs handlers=${matches.length})`);
}

if (failures.length > 0) {
  console.error("Patient Directory routes QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Directory routes QA passed.");
