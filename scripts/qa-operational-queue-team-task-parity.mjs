// QA: OperationalQueue ↔ TeamTask projection parity (Bundle 45).
//
// Source-code invariants + runs the no-DB parity test via tsx. No
// DB. No app boot. No network. No PHI.

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

const TEST_REL = "server/modules/team-tasks/__tests__/operational-queue-projection-parity.test.ts";
const TEAM_TASKS_CONTRACTS = "server/modules/team-tasks/contracts.ts";
const OP_QUEUE_CONTRACTS = "server/modules/operational-queue/contracts.ts";

requireFile(TEST_REL);
requireFile(TEAM_TASKS_CONTRACTS);
requireFile(OP_QUEUE_CONTRACTS);

requireText(TEST_REL, [
  "OPERATIONAL_QUEUE_ITEM_KINDS",
  "TEAM_TASK_OWNER_TYPES",
  "makeTeamTaskCompositeId",
  "makeOpQueueCompositeIdFromTask",
  "buildTeamTaskFromAxes",
  "buildOpQueueItemFromAxes",
  // The load-bearing axes from the bundle spec.
  "ownerType",
  "assigneeUserId",
  "schedulerId",
  "completedAt",
  "cancellationLikeStatus",
  // Section labels.
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
]);

// Test must not pull DB / schema / repo deps.
requireNotText(
  TEST_REL,
  [
    'from "../../../db"',
    'from "../../db"',
    'from "@shared/schema"',
    'from "../repo"',
    'from "../service"',
    'from "../../operational-queue/repo"',
    'from "../../operational-queue/service"',
  ],
  "op-queue ↔ team-task parity test must not pull DB / schema / repo at import",
);

// PHI envelope at the source-text level — no real-shape phones / emails.
requireNotText(
  TEST_REL,
  [
    "@gmail",
    "@hotmail",
    "@yahoo",
    "(555)",
  ],
  "op-queue ↔ team-task parity test must remain PHI-free",
);

// Confirm the live contracts still expose the kinds + owner types
// the test depends on. If a future PR renames one, the test breaks
// AND this QA catches the rename at source-text level.
requireText(OP_QUEUE_CONTRACTS, [
  "OPERATIONAL_QUEUE_ITEM_KINDS",
  "call_list_item",
  "scheduler_task",
]);
requireText(TEAM_TASKS_CONTRACTS, [
  "TEAM_TASK_OWNER_TYPES",
  "plexus_task",
  "scheduler_assignment",
]);

if (failures.length > 0) {
  console.error("OperationalQueue ↔ TeamTask parity QA failed (pre-run):");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

const testAbs = path.join(root, TEST_REL);
const result = spawnSync("npx", ["tsx", testAbs], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
if (result.status !== 0) {
  console.error(
    `OperationalQueue ↔ TeamTask parity QA failed (test exit ${result.status}).`,
  );
  process.exit(result.status ?? 1);
}

console.log("OperationalQueue ↔ TeamTask parity QA passed.");
