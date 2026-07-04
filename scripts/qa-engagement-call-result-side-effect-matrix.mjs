// QA: engagement call-result side-effect matrix (Batch 9).
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

const FIX = "tests/fixtures/engagementCallResultSideEffectMatrix.fixture.ts";
requireFile(FIX);
requireText(FIX, [
  "ENGAGEMENT_CALL_RESULT_SIDE_EFFECT_MATRIX",
  "call_result_logged",
  "journeyEventAppended",
  "triageCaseUpserted",
  "followUpTaskCreated",
  "assignmentCompletedOnEngagement",
  "outreachCallCreatedOnEngagement",
]);

const TEST = "server/services/callResult/__tests__/engagementCallResultSideEffectMatrix.test.ts";
requireFile(TEST);

if (failures.length === 0) {
  try { execSync(`npx vitest run ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] }); }
  catch { failures.push("Engagement side-effect matrix test FAILED"); }
}

if (failures.length > 0) {
  console.error("Engagement side-effect matrix QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement side-effect matrix QA passed.");
