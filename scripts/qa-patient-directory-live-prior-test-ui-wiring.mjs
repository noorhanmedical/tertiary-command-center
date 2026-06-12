// QA: Patient Directory live prior-test UI wiring (Part 10).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const ACT = read("client/src/components/patient-directory/PatientDirectoryActions.tsx") ?? "";
for (const n of [
  "AddPriorTestDialog",
  "addPriorTest",
  "patient-directory-add-prior-test-dialog",
  "patient-directory-add-prior-test-name",
  "patient-directory-add-prior-test-date",
  "patient-directory-add-prior-test-save",
  "Test name *",
  "patient_test_history",
]) if (!ACT.includes(n)) failures.push(`PatientDirectoryActions missing "${n}"`);

const LIVE = read("client/src/components/patient-directory/PatientDirectoryLivePage.tsx") ?? "";
for (const n of ["AddPriorTestDialog", "priorOpen"]) if (!LIVE.includes(n)) failures.push(`PatientDirectoryLivePage missing "${n}"`);

const RT = read("server/routes/patientDirectory.ts") ?? "";
if (!RT.includes('"/api/patient-directory/:patientId/prior-tests"')) failures.push("prior-tests POST route missing");

if (failures.length > 0) {
  console.error("Patient Directory live prior-test UI QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Directory live prior-test UI QA passed.");
