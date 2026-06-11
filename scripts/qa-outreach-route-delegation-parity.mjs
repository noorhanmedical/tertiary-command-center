// QA: outreach route delegation parity harness (Batch B5).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const failures = [];
function read(rel) { const abs = path.join(root, rel); if (!fs.existsSync(abs)) return null; return fs.readFileSync(abs, "utf8"); }
function requireFile(rel) { const c = read(rel); if (c === null) failures.push(`Missing file: ${rel}`); return c; }
function requireText(rel, needles) {
  const c = read(rel); if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (!c.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
}

const TEST = "server/services/callResult/__tests__/outreachRouteDelegationParity.test.ts";
requireFile(TEST);
requireText(TEST, [
  "recordOutreachCallResult",
  '"scheduled"',
  '"completed"',
  '"callback"',
  '"no_answer"',
  '"voicemail"',
  '"wrong_number"',
  '"declined"',
  '"dnc"',
  '"do_not_contact"',
  '"deceased"',
  '"cancelled"',
  "TERMINAL_OUTREACH_OUTCOMES",
  "journey event suppressed",
]);

if (failures.length === 0) {
  try { execSync(`npx tsx ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] }); }
  catch { failures.push("Parity test FAILED"); }
}

if (failures.length > 0) {
  console.error("Outreach route delegation parity QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Outreach route delegation parity QA passed.");
