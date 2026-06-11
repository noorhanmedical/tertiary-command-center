// QA: engagement route delegation parity harness (Batch 4).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const failures = [];
function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}
function requireFile(rel) {
  const c = read(rel);
  if (c === null) failures.push(`Missing file: ${rel}`);
  return c;
}
function requireText(rel, needles) {
  const c = read(rel);
  if (c === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (!c.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
}

const TEST = "server/services/callResult/__tests__/engagementRouteDelegationParity.test.ts";
requireFile(TEST);
requireText(TEST, [
  "recordEngagementCallResult",
  "ENGAGEMENT_CALL_RESULT_RESPONSE_KEYS",
  "CALL_RESULT_PARITY_FIXTURE",
  '"scheduled"',
  '"callback"',
  '"no_answer"',
  '"voicemail"',
  '"wrong_number"',
  '"declined"',
  '"needs_records"',
  '"insurance_prior_auth_issue"',
  '"manager_review"',
  '"facility_specific_issue"',
  'engagementStatusSemantics: "coarse"',
  "TERMINAL_OUTCOMES",
]);

if (failures.length === 0) {
  try { execSync(`npx tsx ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] }); }
  catch { failures.push("Parity test FAILED"); }
}

if (failures.length > 0) {
  console.error("Engagement route delegation parity QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement route delegation parity QA passed.");
