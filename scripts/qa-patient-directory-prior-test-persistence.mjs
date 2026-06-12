// QA: prior ancillary persistence activation (Batch H).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const WRITER = read("server/services/patientDirectory/patientDirectoryWriter.ts") ?? "";
for (const n of [
  "addPriorTest",
  "storage.createTestHistory",
  '"prior_test_added"',
]) if (!WRITER.includes(n)) failures.push(`writer missing "${n}"`);

const DEPS = read("server/services/patientDirectory/patientDirectoryStorageDeps.ts") ?? "";
for (const n of ["loadPriorTests", "storage.getPatientGroupTestHistory"]) {
  if (!DEPS.includes(n)) failures.push(`deps missing "${n}"`);
}

const RT = read("server/routes/patientDirectory.ts") ?? "";
for (const n of [
  '"/api/patient-directory/:patientId/prior-tests"',
  "addPriorTest",
]) if (!RT.includes(n)) failures.push(`routes missing "${n}"`);

// Shared helper still pins the restricted-test list.
const SHARED = read("shared/priorAncillaryHistory.ts") ?? "";
for (const n of [
  "checkRecommendedTests",
  "hasBlockingAncillaryWarning",
  "ANCILLARY_RESTRICTED_INTERVAL_DAYS",
  "brainwave",
  "echocardiogram tte",
]) if (!SHARED.includes(n)) failures.push(`shared helper missing "${n}"`);

if (failures.length > 0) {
  console.error("Prior ancillary persistence QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Prior ancillary persistence QA passed.");
