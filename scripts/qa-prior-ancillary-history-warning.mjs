// QA: Prior ancillary history warning (Batch B14).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const SVC = "shared/priorAncillaryHistory.ts";
const TEST = "tests/unit/priorAncillaryHistory.test.ts";
for (const rel of [SVC, TEST]) if (read(rel) === null) failures.push(`Missing file: ${rel}`);

for (const n of [
  "checkRecommendedTests",
  "hasBlockingAncillaryWarning",
  "ANCILLARY_RESTRICTED_INTERVAL_DAYS",
  "brainwave",
  "vitalwave",
  "bilateral carotid duplex",
  "echocardiogram tte",
  "renal artery doppler",
  "lower extremity arterial doppler",
  "upper extremity arterial doppler",
  "abdominal aortic aneurysm duplex",
  "stress echocardiogram",
  "lower extremity venous duplex",
  "upper extremity venous duplex",
  "duplicate_in_window",
  "duplicate_outside_window",
]) {
  const c = read(SVC) ?? "";
  if (!c.includes(n)) failures.push(`${SVC} missing "${n}"`);
}

if (failures.length === 0) {
  try { execSync(`npx tsx ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] }); }
  catch { failures.push("Prior ancillary history test FAILED"); }
}

if (failures.length > 0) {
  console.error("Prior ancillary history warning QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Prior ancillary history warning QA passed.");
