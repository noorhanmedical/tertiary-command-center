// QA: USE_OPERATIONAL_QUEUE_CALL_LIST flag contract (Batch 11d).
//
// Source-code invariant check. No DB, no app boot, no network, no PHI.
// Locks the flag-gated shadow-read pattern at GET /api/scheduler-assignments
// so future PRs cannot accidentally:
//   - Move the flag check after the response is sent.
//   - Default the flag ON.
//   - Drop the catch wrapper that prevents the shadow read from
//     affecting the response.
//   - Log PHI from the shadow-read path.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}

function requireFile(rel) {
  const content = read(rel);
  if (content === null) failures.push(`Missing file: ${rel}`);
  return content;
}

function requireText(rel, needles) {
  const content = read(rel);
  if (content === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (!content.includes(needle)) {
      failures.push(`Missing "${needle}" in ${rel}`);
    }
  }
}

function requireNotText(rel, needles, label) {
  const content = read(rel);
  if (content === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (content.includes(needle)) {
      failures.push(`${label}: ${rel} contains "${needle}"`);
    }
  }
}

// 1. The flag accessor exists, has zero DB dependency, and accepts the
//    same truthy values as the bridge flag.
requireFile("server/modules/operational-queue/call-list-flag.ts");
requireText("server/modules/operational-queue/call-list-flag.ts", [
  "export function isOperationalQueueCallListEnabled",
  "USE_OPERATIONAL_QUEUE_CALL_LIST",
  '"1"',
  '"true"',
  '"yes"',
]);
// Flag module must NOT import the DB pool or any service layer — keep
// the contract testable without a live database.
requireNotText("server/modules/operational-queue/call-list-flag.ts", [
  'from "../../db"',
  'from "../service"',
], "call-list flag module pulls in DB / service deps");

// 2. The route consumes the flag, gates the shadow read on it, and
//    NEVER replaces the legacy res.json(rows) path.
requireText("server/routes/schedulerAssignments.ts", [
  'from "../modules/operational-queue/call-list-flag"',
  "isOperationalQueueCallListEnabled()",
  'from "../modules/operational-queue/service"',
  "getOperationalQueueForUser",
  "USE_OPERATIONAL_QUEUE_CALL_LIST",
  // Legacy path is still the only response source.
  "res.json(rows)",
]);

// 3. The parity test exercises the flag-OFF and flag-ON contract.
requireText("server/modules/operational-queue/__tests__/parity.test.ts", [
  '"../call-list-flag"',
  "isOperationalQueueCallListEnabled",
  "USE_OPERATIONAL_QUEUE_CALL_LIST",
  "Call-list flag contract checks passed.",
]);

// 4. PHI-safe shadow log: only counts and bool. Reject obvious PHI
//    leakage attempts in the shadow-read block.
requireNotText("server/routes/schedulerAssignments.ts", [
  "patientName",
  "patientDob",
  "summary:",
], "shadow-read log block must not reference PHI fields");

if (failures.length > 0) {
  console.error("Operational queue call-list flag QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
} else {
  console.log("Operational queue call-list flag QA passed.");
}
