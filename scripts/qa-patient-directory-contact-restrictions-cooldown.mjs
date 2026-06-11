// QA: contact restrictions + cooldown (Batch B13).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }

const SVC = "shared/contactRestrictions.ts";
const TEST = "tests/unit/contactRestrictions.test.ts";
for (const rel of [SVC, TEST]) if (read(rel) === null) failures.push(`Missing file: ${rel}`);

for (const n of [
  "COOLDOWN_PRESET_LABEL",
  "COOLDOWN_PRESET_DAYS",
  "endsAtForPreset",
  "gateOutreach",
  "isCooldownActive",
  '"30d"',
  '"60d"',
  '"90d"',
  '"6m"',
  '"12m"',
  '"custom"',
  "dnc",
  "active_cooldown",
]) {
  const c = read(SVC) ?? "";
  if (!c.includes(n)) failures.push(`${SVC} missing "${n}"`);
}

if (failures.length === 0) {
  try { execSync(`npx tsx ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] }); }
  catch { failures.push("Contact restrictions test FAILED"); }
}

if (failures.length > 0) {
  console.error("Contact restrictions QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Contact restrictions QA passed.");
