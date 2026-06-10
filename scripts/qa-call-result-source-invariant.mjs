// QA: call-result source invariant (Batch C).
//
// Protects the current dual-route state of the call-result write
// surface until the canonical recordCallResult service extraction
// is approved. The Batch A contract names the two routes; this
// invariant asserts neither one silently loses its load-bearing
// side effects while we wait for the canonical service.
//
// What this asserts:
//   1. POST /api/outreach/calls route still exists.
//   2. POST /api/engagement-center/call-result route still exists.
//   3. The outreach route still writes outreach_calls (via
//      storage.createOutreachCallAtomic) and still has the
//      terminal-status assignment-completion path (via
//      markSchedulerAssignmentCompleted).
//   4. The execution-case route still appends a
//      'call_result_logged' patient_journey_events row via the
//      typed appendJourneyEvent writer.
//   5. The execution-case route still updates
//      patient_execution_cases.
//   6. The execution-case route still handles callback,
//      no_answer, voicemail, and wrong_number outcomes (per the
//      triage mapping the Batch B fixture mirrors).
//   7. Team Portal does NOT own call-list generation — portal.ts
//      contains no writes to scheduler_assignments or
//      patient_execution_cases.
//   8. Operational Queue stays read-only (re-asserted from
//      Bundle 46).
//   9. Team Tasks stay read-only (re-asserted from Bundle 47).
//
// Source-code invariant only. No DB. No app boot. No network. No PHI.

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

// ─── 1. /api/outreach/calls route — write surface ────────────────
const OUTREACH = "server/routes/outreach.ts";
requireFile(OUTREACH);
requireText(OUTREACH, [
  '"/api/outreach/calls"',
  // Writes outreach_calls via storage helper.
  "createOutreachCallAtomic",
  // Zod schema for the body.
  "insertOutreachCallSchema",
  // Derives appointmentStatus from outcome.
  "deriveAppointmentStatus",
  // Terminal-status assignment-completion path.
  "markSchedulerAssignmentCompleted",
  // Canonical spine sync.
  "ensureCanonicalSpineForScreening",
]);

// ─── 2. /api/engagement-center/call-result route ─────────────────
const EXEC = "server/routes/executionCases.ts";
requireFile(EXEC);
requireText(EXEC, [
  '"/api/engagement-center/call-result"',
  // Typed journey event writer.
  "appendJourneyEvent",
  '"call_result_logged"',
  // Execution-case write surface — Drizzle table identifier.
  "patientExecutionCases",
  // Triage mapping covers the four documented outcomes.
  '"callback"',
  '"no_answer"',
  '"voicemail"',
  '"wrong_number"',
]);

// ─── 3. Team Portal does NOT own call-list generation ────────────
const PORTAL = "server/routes/portal.ts";
requireFile(PORTAL);
requireNotText(
  PORTAL,
  [
    // Direct writes to scheduler_assignments.
    "db.insert(schedulerAssignments",
    "db.update(schedulerAssignments",
    "db.delete(schedulerAssignments",
    // Direct writes to patient_execution_cases.
    "db.insert(patientExecutionCases",
    "db.update(patientExecutionCases",
    "db.delete(patientExecutionCases",
    // Direct writes to outreach_calls (call-result write path
    // is the canonical /api/outreach/calls + /api/engagement-center/
    // call-result; portal must NOT have a parallel writer).
    "db.insert(outreachCalls",
    "db.update(outreachCalls",
    // Direct call to markSchedulerAssignmentCompleted (portal MUST
    // delegate to the canonical write path, not call the storage
    // helper itself).
    "markSchedulerAssignmentCompleted",
  ],
  "portal route must not own call-list generation or call-result side effects",
);

// ─── 4. Operational Queue stays read-only (re-stated invariant) ─
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

// ─── 5. Team Tasks stay read-only (re-stated invariant) ─────────
for (const rel of [
  "server/modules/team-tasks/repo.ts",
  "server/modules/team-tasks/service.ts",
]) {
  const c = read(rel) ?? "";
  for (const needle of ["db.insert(", "db.update(", "db.delete("]) {
    if (c.includes(needle)) {
      failures.push(
        `${rel}: contains write verb "${needle}" — Team Tasks must remain read-only`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Call-result source invariant QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("Call-result source invariant QA passed.");
