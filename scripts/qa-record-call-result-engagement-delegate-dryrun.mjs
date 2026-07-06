// QA: engagement delegate dry-run harness (Batch 11 of split-brain run).
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

const TEST = "server/services/callResult/__tests__/recordCallResultEngagementDelegateDryRun.test.ts";
requireFile(TEST);
requireText(TEST, [
  "recordEngagementCallResult",
  "isRecordCallResultEngagementDelegateEnabled",
  "CALL_RESULT_PARITY_FIXTURE",
  "ENGAGEMENT_CALL_RESULT_RESPONSE_KEYS",
  "makeCapturingDeps",
  "ownershipUpdated",
  "executionCase",
  "journeyEvent",
  "triageCase",
  "task",
]);

// Historical note: this QA originally asserted no route wired the
// delegate flag (Batch 11 of split-brain run shipped only the harness).
// Batch 3 of the Engagement completion run has since wired the
// engagement route behind a default-OFF flag. The wiring + safeguards
// are pinned by qa-record-call-result-engagement-delegation.mjs.

if (failures.length === 0) {
  try { execSync(`npx vitest run ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] }); }
  catch { failures.push("Engagement delegate dry-run test FAILED"); }
}

if (failures.length > 0) {
  console.error("Engagement delegate dry-run QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement delegate dry-run QA passed.");
