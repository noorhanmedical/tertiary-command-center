// QA: Engagement call-list canonicalization contract (Batch A).
//
// Source-code invariant. Pins the docs/architecture/
// engagement-call-list-canonicalization-contract.md content so a
// future doc-edit cannot silently drop a load-bearing rule, AND
// asserts the runtime files the contract names still carry their
// load-bearing call-result behaviors (drift surface).
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

// ─── 1. The contract doc exists ───────────────────────────────────
const CONTRACT_REL =
  "docs/architecture/engagement-call-list-canonicalization-contract.md";
requireFile(CONTRACT_REL);

// ─── 2. The contract names every load-bearing concept ────────────
requireText(CONTRACT_REL, [
  // Tables / sources the canonical model spans.
  "patient_execution_cases",
  "scheduler_assignments",
  "outreach_calls",
  "Operational Queue",
  "Team Tasks",
  "Journey Events",
  "Execution Cases",
  // The canonical service.
  "recordCallResult",
  // Product terminology (per the terminology correction).
  "Team Member",
  "Patient Care Specialist",
  "Ancillary Care Specialist",
  // "scheduler" must be flagged as legacy/internal terminology.
  "legacy",
  "internal implementation",
  // Visit vs outreach.
  "visit patient",
  "outreach patient",
  // Existing endpoints the contract preserves.
  "/api/outreach/calls",
  "/api/engagement-center/call-result",
  "/api/portal/outreach-call-list",
  // Drift risks section.
  "drift",
  // Mandatory non-change clauses.
  "No runtime change",
  // Team Portal ownership boundary.
  "Team Portal",
  "owns",
]);

// ─── 3. Existing source files still carry the load-bearing
//        runtime behaviors the contract describes ────────────────

// 3a. /api/outreach/calls route still exists with the canonical
//     outreach-call write + assignment-completion side effects.
const OUTREACH_ROUTE = "server/routes/outreach.ts";
requireFile(OUTREACH_ROUTE);
requireText(OUTREACH_ROUTE, [
  '"/api/outreach/calls"',
  // The route writes outreach_calls rows via this storage helper.
  "createOutreachCallAtomic",
  // The Zod schema for the call body.
  "insertOutreachCallSchema",
  // Terminal-status assignment-completion path.
  "markSchedulerAssignmentCompleted",
]);

// 3b. /api/engagement-center/call-result route still exists with
//     the canonical journey-event + execution-case side effects.
//     NOTE: the route literal is /api/engagement-center/call-result
//     (not /api/execution-cases/call-result — the audit cited the
//     wrong path).
const EXEC_ROUTE = "server/routes/executionCases.ts";
requireFile(EXEC_ROUTE);
requireText(EXEC_ROUTE, [
  '"/api/engagement-center/call-result"',
  // Journey event append on the canonical path.
  "appendJourneyEvent",
  '"call_result_logged"',
  // Execution case write surface.
  "patientExecutionCases",
]);

// 3c. Engagement assignment board route still exists.
const BOARD_ROUTE = "server/routes/engagementAssignmentBoard.ts";
requireFile(BOARD_ROUTE);
requireText(BOARD_ROUTE, [
  '"/api/engagement/assignment-board"',
  '"/api/engagement/assignment-board/assign"',
  '"/api/engagement/assignment-board/cancel-many"',
]);

// 3d. Portal outreach-call-list endpoint still exists.
const PORTAL_ROUTE = "server/routes/portal.ts";
requireFile(PORTAL_ROUTE);
requireText(PORTAL_ROUTE, [
  '"/api/portal/outreach-call-list"',
]);

// 3e. Portal routes do NOT directly write scheduler_assignments
//     or patient_execution_cases (cancel-many + assignment writes
//     stay in their canonical homes per §3 of the contract).
requireNotText(
  PORTAL_ROUTE,
  [
    // Direct insert / update of scheduler_assignments.
    "db.insert(schedulerAssignments",
    "db.update(schedulerAssignments",
    "db.delete(schedulerAssignments",
    // Direct insert / update of patient_execution_cases.
    "db.insert(patientExecutionCases",
    "db.update(patientExecutionCases",
    "db.delete(patientExecutionCases",
  ],
  "portal route must not write scheduler_assignments or patient_execution_cases directly",
);

// 3f. Operational Queue stays read-only — Bundle 46 already pins
//     this, but the canonicalization contract restates it so a
//     drift surface lands here as well.
const OPQ_REPO = "server/modules/operational-queue/repo.ts";
const OPQ_SERVICE = "server/modules/operational-queue/service.ts";
requireFile(OPQ_REPO);
requireFile(OPQ_SERVICE);
for (const rel of [OPQ_REPO, OPQ_SERVICE]) {
  const c = read(rel) ?? "";
  for (const needle of ["db.insert(", "db.update(", "db.delete("]) {
    if (c.includes(needle)) {
      failures.push(
        `${rel}: contains write verb "${needle}" — Operational Queue must remain read-only (Batch A invariant)`,
      );
    }
  }
}

// 3g. Team Tasks stays read-only — Bundle 47 already pins this,
//     restated here for the canonicalization lens.
const TT_REPO = "server/modules/team-tasks/repo.ts";
const TT_SERVICE = "server/modules/team-tasks/service.ts";
requireFile(TT_REPO);
requireFile(TT_SERVICE);
for (const rel of [TT_REPO, TT_SERVICE]) {
  const c = read(rel) ?? "";
  for (const needle of ["db.insert(", "db.update(", "db.delete("]) {
    if (c.includes(needle)) {
      failures.push(
        `${rel}: contains write verb "${needle}" — Team Tasks must remain read-only (Batch A invariant)`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Engagement call-list canonicalization QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("Engagement call-list canonicalization QA passed.");
