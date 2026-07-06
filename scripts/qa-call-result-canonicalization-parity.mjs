// QA: call-result canonicalization parity fixture (Batch B).
//
// Source-code invariant + runs the parity test via tsx. No DB.
// No app boot. No network. No PHI.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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
  if (c === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (!c.includes(needle)) failures.push(`Missing "${needle}" in ${rel}`);
  }
}
function requireNotText(rel, needles, label) {
  const c = read(rel);
  if (c === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (c.includes(needle)) failures.push(`${label}: ${rel} contains "${needle}"`);
  }
}

const FIXTURE_REL = "tests/fixtures/callResultCanonicalization.fixture.ts";
const TEST_REL =
  "server/services/__tests__/callResultCanonicalization-parity.test.ts";

requireFile(FIXTURE_REL);
requireFile(TEST_REL);

// Fixture exposes the canonical outcome set + envelope shape.
requireText(FIXTURE_REL, [
  "CALL_RESULT_OUTCOMES_FIXTURE",
  "CALL_RESULT_PARITY_FIXTURE",
  // All ten canonical outcomes the contract names.
  "scheduled",
  "callback",
  "no_answer",
  "voicemail",
  "wrong_number",
  "declined",
  "needs_records",
  "insurance_prior_auth_issue",
  "manager_review",
  "facility_specific_issue",
  // Envelope keys.
  "outreachCallCreated",
  "appointmentStatus",
  "journeyEventType",
  "executionCaseEngagementStatus",
  "executionCaseNextActionAtRequired",
  "assignmentCompleted",
  "followUpTaskRequired",
  "triageCaseRequired",
  "terminal",
  // The canonical journey event type.
  "call_result_logged",
]);

// PHI envelope.
requireNotText(
  FIXTURE_REL,
  [
    "@gmail",
    "@hotmail",
    "@yahoo",
    "(555)",
    "John ",
    "Jane ",
    "Smith ",
    "patientName:",
    "patientDob:",
  ],
  "call-result parity fixture must remain PHI-free",
);

// Test must not pull DB / schema / route runtime deps.
requireNotText(
  TEST_REL,
  [
    'from "../../../db"',
    'from "../../db"',
    'from "@shared/schema"',
    'from "../../routes/outreach"',
    'from "../../routes/executionCases"',
  ],
  "call-result parity test must not pull DB / schema / route at import",
);

// Test exercises every section.
requireText(TEST_REL, [
  "§1",
  "§2",
  "§3",
  "§4",
  "§5",
  "§6",
  "§7",
  "§8",
  "§9",
  "§10",
  "§11",
]);

if (failures.length > 0) {
  console.error("Call-result canonicalization parity QA failed (pre-run):");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

const testAbs = path.join(root, TEST_REL);
const result = spawnSync("npx", ["vitest", "run", testAbs], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
if (result.status !== 0) {
  console.error(
    `Call-result canonicalization parity QA failed (test exit ${result.status}).`,
  );
  process.exit(result.status ?? 1);
}

console.log("Call-result canonicalization parity QA passed.");
