// QA: Patient Directory persistence service (Batch B).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const DEPS = "server/services/patientDirectory/patientDirectoryStorageDeps.ts";
const WRITER = "server/services/patientDirectory/patientDirectoryWriter.ts";
for (const rel of [DEPS, WRITER]) if (read(rel) === null) failures.push(`Missing file: ${rel}`);

const deps = read(DEPS) ?? "";
for (const n of [
  "createPatientDirectoryStorageDeps",
  "loadProfile",
  "loadEngagement",
  "loadCallHistory",
  "loadCooldown",
  "loadPriorTests",
  "loadEvents",
  "storage.getPatientScreening",
  "storage.listOutreachCallsForPatient",
  "storage.getActiveAssignmentForPatient",
  "storage.getPatientGroupTestHistory",
  "cooldown_records",
  "patient_directory_events",
]) if (!deps.includes(n)) failures.push(`${DEPS} missing "${n}"`);

const writer = read(WRITER) ?? "";
for (const n of [
  "isPatientDirectoryActivationEnabled",
  "USE_PATIENT_DIRECTORY_ACTIVATION",
  "writePatientDirectoryEvent",
  "searchPatientDirectory",
  "createPatientDirectoryProfile",
  "updatePatientDirectoryProfile",
  "buildDuplicateFacts",
  "setDoNotContact",
  "clearDoNotContact",
  "setCooldown",
  "clearCooldown",
  "addPriorTest",
  "patient_created",
  "dnc_set",
  "dnc_cleared",
  "cooldown_set",
  "cooldown_cleared",
  "prior_test_added",
  "profile_updated",
]) if (!writer.includes(n)) failures.push(`${WRITER} missing "${n}"`);

// Defensive reads — every load helper must wrap in try/catch.
for (const fn of ["loadEngagement", "loadCallHistory", "loadCooldown", "loadPriorTests", "loadEvents"]) {
  if (!new RegExp(`async function ${fn}[\\s\\S]+?try {[\\s\\S]+?catch`).test(deps)) {
    failures.push(`${DEPS}: ${fn} must guard against schema gaps with try/catch`);
  }
}

// Writer should never throw on missing 0027 / 0029 — verify the DNC + event writes use try/catch.
for (const fn of ["writePatientDirectoryEvent", "setDoNotContact", "clearDoNotContact", "setCooldown", "clearCooldown"]) {
  if (!new RegExp(`export async function ${fn}[\\s\\S]+?try {[\\s\\S]+?catch`).test(writer)) {
    failures.push(`${WRITER}: ${fn} must wrap defensive db writes in try/catch`);
  }
}

if (failures.length > 0) {
  console.error("Patient Directory persistence service QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Directory persistence service QA passed.");
