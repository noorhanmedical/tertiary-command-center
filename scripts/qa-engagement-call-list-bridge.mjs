// QA: engagement → call-list bridge contract + safety (Batch E).
//
// Source-code invariant pinning the bridge module against the
// safety rules in docs/architecture/engagement-call-list-bridge-contract.md.
//
// No DB. No app boot. No network. No PHI.

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

// 1. Contract doc exists.
const CONTRACT_REL = "docs/architecture/engagement-call-list-bridge-contract.md";
requireFile(CONTRACT_REL);

// 2. Bridge + flag files exist.
const BRIDGE_REL = "server/modules/operational-queue/bridge.ts";
const FLAG_REL = "server/modules/operational-queue/bridge-flag.ts";
requireFile(BRIDGE_REL);
requireFile(FLAG_REL);

// 3. The contract still names the load-bearing concepts.
requireText(CONTRACT_REL, [
  "ENGAGEMENT_TO_CALL_LIST_BRIDGE",
  "scheduler_assignments",
  "operational-queue/bridge",
  "bridge-flag",
  // Safety rules.
  "Never throws",
  "Never creates a duplicate",
  "Never modifies an existing active",
  // Module boundary rules.
  "MUST NOT import any UI",
  // Staging gate.
  "staging",
  "Rollback drill",
]);

// 4. The flag accessor is pure — no DB / schema / service deps.
requireText(FLAG_REL, [
  "ENGAGEMENT_TO_CALL_LIST_BRIDGE",
  "isEngagementToCallListBridgeEnabled",
  // Truthy values pinned by Bundle 14's flag pattern.
  '"1"',
  '"true"',
  '"yes"',
]);
requireNotText(
  FLAG_REL,
  [
    'from "../../db"',
    'from "../../../db"',
    'from "@shared/schema"',
    'from "../service"',
    'from "../repo"',
    "drizzle-orm",
  ],
  "bridge-flag accessor must stay pure (no DB / schema / drizzle)",
);

// 5. The bridge writes only through the scheduler_assignments
//    schema identifier, never to patient_execution_cases /
//    outreach_calls / patient_journey_events / etc.
const bridgeSrc = read(BRIDGE_REL) ?? "";
// 5a. Bridge must import schedulerAssignments (its only write target).
requireText(BRIDGE_REL, ["schedulerAssignments"]);
// 5b. Bridge must NOT write to forbidden tables.
const FORBIDDEN_WRITE_TARGETS = [
  "db.insert(patientExecutionCases",
  "db.update(patientExecutionCases",
  "db.delete(patientExecutionCases",
  "db.insert(outreachCalls",
  "db.update(outreachCalls",
  "db.insert(patientJourneyEvents",
  "db.update(patientJourneyEvents",
  "db.insert(plexusTasks",
  "db.update(plexusTasks",
  "db.insert(patientScreenings",
  "db.update(patientScreenings",
  "db.delete(patientScreenings",
];
for (const needle of FORBIDDEN_WRITE_TARGETS) {
  if (bridgeSrc.includes(needle)) {
    failures.push(
      `${BRIDGE_REL}: contains forbidden write "${needle}" — bridge may only write to scheduler_assignments`,
    );
  }
}

// 6. The bridge consumes the flag through bridge-flag.ts, not via
//    an inline process.env read.
requireText(BRIDGE_REL, ['from "./bridge-flag"']);
requireNotText(
  BRIDGE_REL,
  ['process.env["ENGAGEMENT_TO_CALL_LIST_BRIDGE"]', "process.env.ENGAGEMENT_TO_CALL_LIST_BRIDGE"],
  "bridge must read the flag via bridge-flag accessor, not inline process.env",
);

// 7. The bridge does NOT import client / UI code.
requireNotText(
  BRIDGE_REL,
  ['from "@/', 'from "client/', "react", "useState", "useEffect"],
  "bridge must not import UI / React code",
);

// 8. Operational queue read modules stay read-only (re-stated
//    invariant; Bundle 46 also pins this).
for (const rel of [
  "server/modules/operational-queue/repo.ts",
  "server/modules/operational-queue/service.ts",
]) {
  const c = read(rel) ?? "";
  for (const needle of ["db.insert(", "db.update(", "db.delete("]) {
    if (c.includes(needle)) {
      failures.push(
        `${rel}: contains write verb "${needle}" — Operational Queue must remain read-only`,
      );
    }
  }
}

// 9. The engagement-board route still invokes the bridge under
//    the flag gate — the only place bridgeEngagementAssignmentToCallList
//    is called. Today the route reads process.env directly inline
//    rather than via the bridge-flag accessor; either pattern is
//    acceptable for the route — the QA pins that the bridge call
//    exists and is gated by the canonical flag name.
const ROUTE_REL = "server/routes/engagementAssignmentBoard.ts";
requireFile(ROUTE_REL);
requireText(ROUTE_REL, [
  "ENGAGEMENT_TO_CALL_LIST_BRIDGE",
  "bridgeEngagementAssignmentToCallList",
  // Bridge import path is stable.
  '"../modules/operational-queue/bridge"',
]);

if (failures.length > 0) {
  console.error("Engagement → call-list bridge QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("Engagement → call-list bridge QA passed.");
