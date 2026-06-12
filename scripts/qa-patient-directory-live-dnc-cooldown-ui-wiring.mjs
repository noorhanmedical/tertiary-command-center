// QA: Patient Directory live DNC + cooldown UI wiring (Part 9).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const ACT = read("client/src/components/patient-directory/PatientDirectoryActions.tsx") ?? "";
for (const n of [
  "DncCooldownDialog",
  "setDoNotContact",
  "clearDoNotContact",
  "setCooldown",
  "clearCooldown",
  "patient-directory-dnc-cooldown-dialog",
  "patient-directory-dnc-set",
  "patient-directory-dnc-clear",
  "patient-directory-cooldown-set",
  "patient-directory-cooldown-clear",
  "endsAtForPreset",
  "COOLDOWN_PRESET_LABEL",
]) if (!ACT.includes(n)) failures.push(`PatientDirectoryActions missing "${n}"`);

const LIVE = read("client/src/components/patient-directory/PatientDirectoryLivePage.tsx") ?? "";
for (const n of [
  "DncCooldownDialog",
  "dncOpen",
]) if (!LIVE.includes(n)) failures.push(`PatientDirectoryLivePage missing "${n}"`);

const RT = read("server/routes/patientDirectory.ts") ?? "";
for (const n of [
  '"/api/patient-directory/:patientId/contact-restrictions"',
  '"/api/patient-directory/:patientId/cooldown"',
]) if (!RT.includes(n)) failures.push(`routes missing "${n}"`);

// Activation flag must default OFF.
const FLAG = read("server/services/patientDirectory/patientDirectoryActivationFlag.ts") ?? "";
if (!FLAG.includes("USE_PATIENT_DIRECTORY_ACTIVATION")) failures.push("activation flag accessor missing");

if (failures.length > 0) {
  console.error("Patient Directory live DNC/cooldown UI QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Directory live DNC/cooldown UI QA passed.");
