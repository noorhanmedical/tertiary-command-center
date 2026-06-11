// QA: Patient duplicate warning engine (Batch B5).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const SVC = "client/src/lib/patientDuplicateWarnings.ts";
const TEST = "tests/unit/patientDuplicateWarnings.test.ts";
for (const rel of [SVC, TEST]) if (read(rel) === null) failures.push(`Missing file: ${rel}`);

for (const n of [
  "computeDuplicateWarnings",
  "DuplicateWarningResult",
  "hasBlockingWarning",
  "matched_prior_run",
  "previously_sent_to_engagement",
  "do_not_contact",
  "active_cooldown",
  "expired_cooldown_historical",
  "prior_ancillary_test",
  "BrainWave",
  "VitalWave",
  "Bilateral Carotid Duplex",
  "Echocardiogram TTE",
  "Renal Artery Doppler",
  "Lower Extremity Arterial Doppler",
  "Upper Extremity Arterial Doppler",
  "Abdominal Aortic Aneurysm Duplex",
  "Stress Echocardiogram",
  "Lower Extremity Venous Duplex",
  "Upper Extremity Venous Duplex",
]) {
  const c = read(SVC) ?? "";
  if (!c.includes(n)) failures.push(`${SVC} missing "${n}"`);
}

if (failures.length === 0) {
  try { execSync(`npx tsx ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] }); }
  catch { failures.push("Duplicate warning engine test FAILED"); }
}

if (failures.length > 0) {
  console.error("Patient duplicate warning engine QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient duplicate warning engine QA passed.");
