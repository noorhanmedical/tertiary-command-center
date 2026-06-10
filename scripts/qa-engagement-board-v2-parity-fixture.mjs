// QA: Engagement Board v2 parity fixture (Bundle 22).
//
// Source-code invariants + runs the parity test via tsx. No DB, no
// app boot, no network, no PHI.

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

const TEST_REL = "server/modules/engagement-board/__tests__/parity-fixture.test.ts";
const CONTRACT_REL = "shared/contracts/engagementBoard.ts";
const ROUTE_REL = "server/routes/engagementAssignmentBoard.ts";

requireFile(TEST_REL);
requireFile(CONTRACT_REL);
requireFile(ROUTE_REL);

// Test pins the canonical fallback chains and the missingInfo rule
// names. If a future PR renames a field the legacy route reads
// (`engagementBucket`, `engagementStatus`, etc.), this list traps
// the change.
requireText(TEST_REL, [
  "projectToEngagementBoardRows_REFERENCE",
  "computeMissingInfo_REFERENCE",
  "patientScreeningId",
  "executionCaseId",
  "engagementBucket",
  "engagementStatus",
  "commitStatus",
  "assignedTeamMemberId",
  "missingInfo",
  "selectedServices",
  // Section labels.
  "§1",
  "§2",
  "§3",
  "§4",
  "§5",
  "§6",
]);

// Test must not pull DB / schema / route runtime deps.
requireNotText(
  TEST_REL,
  [
    'from "../../db"',
    'from "../../../db"',
    'from "@shared/schema"',
    'from "../../../routes/engagementAssignmentBoard"',
  ],
  "engagement-board parity test must not pull DB / schema / route at import",
);

// PHI-safe at the source level.
requireNotText(
  TEST_REL,
  ["patientName: \"John", "patientName: \"Jane", "(555)", "diagnosis", "insurance"],
  "engagement-board parity test contains a PHI-shaped string",
);

// The contract still exports EngagementBoardRow — the test imports it.
requireText(CONTRACT_REL, ["export type EngagementBoardRow"]);

// And the legacy route still defines the projection at the line
// range this test mirrors. If the route's projection logic moves
// significantly, the line citation in the test header may need an
// update; the test itself will catch any actual rule change.
requireText(ROUTE_REL, [
  "computeMissingInfo",
  "engagementBucket",
  "engagementStatus",
  "assignedTeamMemberId",
]);

if (failures.length > 0) {
  console.error("Engagement Board v2 parity fixture QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

// Run the test.
const testAbs = path.join(root, TEST_REL);
const result = spawnSync("npx", ["tsx", testAbs], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
if (result.status !== 0) {
  console.error(`Engagement Board v2 parity fixture QA failed (test exit ${result.status}).`);
  process.exit(result.status ?? 1);
}

console.log("Engagement Board v2 parity fixture QA passed.");
