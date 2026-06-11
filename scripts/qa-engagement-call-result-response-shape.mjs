// QA: engagement response-shape parity (Batch 8 of split-brain run).
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
  for (const needle of needles) {
    if (!c.includes(needle)) failures.push(`Missing "${needle}" in ${rel}`);
  }
}

const FIX = "tests/fixtures/engagementCallResultResponseShape.fixture.ts";
requireFile(FIX);
requireText(FIX, [
  "ENGAGEMENT_CALL_RESULT_RESPONSE_KEYS",
  "ENGAGEMENT_CALL_RESULT_RESPONSE_NULLABILITY",
  "ENGAGEMENT_CALL_RESULT_SUPPORTED_OUTCOMES",
  '"ok"',
  '"executionCase"',
  '"journeyEvent"',
  '"triageCase"',
  '"task"',
  '"ownershipUpdated"',
]);

const TEST = "server/services/callResult/__tests__/engagementCallResultResponseShape.test.ts";
requireFile(TEST);
requireText(TEST, [
  "ENGAGEMENT_CALL_RESULT_RESPONSE_KEYS",
  "ownershipUpdated",
]);

// Assert the legacy route still returns ALL six keys today.
const ROUTE = "server/routes/executionCases.ts";
requireFile(ROUTE);
requireText(ROUTE, [
  "executionCase: updatedExecutionCase",
  "journeyEvent",
  "triageCase",
  "task",
  "ownershipUpdated",
]);

// Run the parity test.
if (failures.length === 0) {
  try {
    execSync(`npx tsx ${TEST}`, { cwd: root, stdio: ["ignore", "inherit", "inherit"] });
  } catch {
    failures.push("Engagement response-shape test FAILED");
  }
}

if (failures.length > 0) {
  console.error("Engagement response-shape QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement response-shape QA passed.");
