// QA: operational-queue → SchedulerAssignment projection parity
// (Batch 11d.2 / Bundle 12).
//
// Two-layer check:
//   1. Source-code invariants — the projection contract file exists and
//      the projection-design doc still names the 5 lossy fields.
//   2. Runs the parity test under server/modules/operational-queue/__tests__/
//      via tsx (the test itself runs without a DB, so this QA pass is
//      safe in any environment).
//
// No DB. No app boot. No network. No PHI.

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

// 1. The parity test file exists.
const TEST_REL = "server/modules/operational-queue/__tests__/projection-parity.test.ts";
requireFile(TEST_REL);

// 2. The test pins the canonical lossy-field list from the design doc.
//    These names are also load-bearing in the GAP_MAPPING_MARKER inside
//    the test itself.
requireText(TEST_REL, [
  "schedulerId",
  "assignedAt",
  "originalSchedulerId",
  "reason",
  "completedAt",
  "OPERATIONAL_QUEUE_ITEM_KINDS",
  "call_list_item",
  "projectQueueItemsToSchedulerAssignments_REFERENCE",
  "missing_row",
  "[operational-queue/projection/schedulerAssignment]",
]);

// 3. The test must not import the live DB or any service-layer module —
//    the no-DB invariant is the whole point.
requireNotText(
  TEST_REL,
  [
    'from "../../../db"',
    'from "../service"',
    'from "../repo"',
    'from "@shared/schema"',
  ],
  "projection-parity test pulls in DB / service / schema deps",
);

// 4. The projection-design doc still names the same five lossy fields
//    and the canonical PHI-safe log line. If a future PR changes the
//    contract, BOTH the doc and the test have to be updated together.
const DESIGN_REL = "docs/architecture/operational-queue-call-list-projection-design.md";
requireText(DESIGN_REL, [
  "schedulerId",
  "assignedAt",
  "originalSchedulerId",
  "reason",
  "completedAt",
  "[operational-queue/projection/schedulerAssignment] missing_row",
  "projectQueueItemsToSchedulerAssignments",
]);

// 5. The bulk-fetch single-call rule is pinned in the design doc.
requireText(DESIGN_REL, ["EXACTLY one DB query"]);

// 6. The PHI-safe log line in the design must remain counts-only —
//    no patient field names allowed in the log spec.
requireNotText(
  DESIGN_REL,
  ["patientName", "patientDob", "summary:"],
  "design doc PHI-safe log spec must remain counts-only",
);

if (failures.length > 0) {
  console.error("Operational queue projection parity QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

// 7. Run the parity test. The test is no-DB; tsx loads the .ts directly.
const testAbs = path.join(root, TEST_REL);
const result = spawnSync("npx", ["tsx", testAbs], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
if (result.status !== 0) {
  console.error(`Operational queue projection parity QA failed (test exit ${result.status}).`);
  process.exit(result.status ?? 1);
}

console.log("Operational queue projection parity QA passed.");
