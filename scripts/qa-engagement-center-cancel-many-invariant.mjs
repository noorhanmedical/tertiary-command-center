// QA: Engagement Center cancel-many invariant (Bundle 50).
//
// Source-code invariant pinning the cancel-many write pattern in
// server/routes/engagementAssignmentBoard.ts so a future PR cannot
// silently change the cancellation semantics the Operational Queue
// + Engagement Center read filters depend on.
//
// What this asserts:
//   1. The POST /api/engagement/assignment-board/cancel-many route
//      still exists and is the only place the cancel-many flow lives.
//   2. The route writes BOTH lifecycleStatus="cancelled" AND
//      engagementStatus="cancelled" in the same db.update() block
//      (this is the load-bearing pattern the assignment-board read
//      filter at line ~173 looks for to hide cancelled rows).
//   3. The route nulls assignedTeamMemberId when cancelling — the
//      Operational Queue's call-list filter depends on this.
//   4. A patient_journey_events audit row is appended (best-effort
//      try/catch already in the route).
//   5. The cancel-many block does NOT call any billing / packet /
//      PDF / scheduler-write surface.
//   6. The cancel-many block does NOT change patient_screenings
//      (the cancellation deletes the assignment, not the patient).
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

const ROUTE_REL = "server/routes/engagementAssignmentBoard.ts";
requireFile(ROUTE_REL);

// 1. The cancel-many route + schema still exist.
requireText(ROUTE_REL, [
  '"/api/engagement/assignment-board/cancel-many"',
  "cancelManySchema",
]);

// Extract the cancel-many handler body so the field-level checks
// below apply ONLY to the cancel-many block.
function extractCancelManyBlock(src) {
  const startMarker = '"/api/engagement/assignment-board/cancel-many"';
  const startIdx = src.indexOf(startMarker);
  if (startIdx === -1) return null;
  // Closing brace of the handler — look for the next top-level
  // `// suppress unused warnings for narrow type imports in future variants`
  // marker that closes the entire registerEngagementAssignmentBoardRoutes
  // function. Cheaper: walk to a markedly-different next-route marker.
  const stopIdx = src.indexOf('"/api/engagement/assignment-board/', startIdx + 1);
  // No subsequent route → use end of file.
  const end = stopIdx === -1 ? src.length : stopIdx;
  return src.slice(startIdx, end);
}
const routeSrc = read(ROUTE_REL) ?? "";
const block = extractCancelManyBlock(routeSrc);
if (block === null) {
  failures.push(`${ROUTE_REL}: cancel-many handler not found`);
} else {
  // 2. Both lifecycleStatus AND engagementStatus are set to
  //    "cancelled" inside the SAME .set({...}) block.
  if (!block.includes('engagementStatus: "cancelled"')) {
    failures.push(
      `${ROUTE_REL}: cancel-many must write engagementStatus: "cancelled"`,
    );
  }
  if (!block.includes('lifecycleStatus: "cancelled"')) {
    failures.push(
      `${ROUTE_REL}: cancel-many must write lifecycleStatus: "cancelled"`,
    );
  }

  // 3. assignedTeamMemberId is nulled.
  if (!block.includes("assignedTeamMemberId: null")) {
    failures.push(
      `${ROUTE_REL}: cancel-many must null assignedTeamMemberId so the call-list filter hides the row`,
    );
  }

  // 4. Journey-event append is present via the typed writer
  //    (Bundle 12c — appendJourneyEvent) OR the raw insert
  //    (legacy fallback).
  if (
    !block.includes("appendJourneyEvent(") &&
    !block.includes("db.insert(patientJourneyEvents")
  ) {
    failures.push(
      `${ROUTE_REL}: cancel-many must append a patient_journey_events row (via appendJourneyEvent or db.insert)`,
    );
  }
  if (!block.includes('eventType: "engagement_assignment_cancelled"')) {
    failures.push(
      `${ROUTE_REL}: cancel-many must use the canonical eventType "engagement_assignment_cancelled"`,
    );
  }
  if (!block.includes('eventSource: "engagement_assignment_board"')) {
    failures.push(
      `${ROUTE_REL}: cancel-many must use the canonical eventSource "engagement_assignment_board"`,
    );
  }

  // 5. No billing / packet / PDF / scheduler-write surface inside
  //    the cancel-many block. These string fragments would
  //    indicate scope creep.
  const FORBIDDEN_IN_BLOCK = [
    "billing_records",
    "billingDocuments",
    "billingDocumentRequests",
    "completedBillingPackages",
    "invoices",
    "projectedInvoices",
    "openPatientPacketPrintPreview",
    "openSchedulerPacketPrintPreview",
    "html2pdf",
    // Don't reach into scheduler_assignments writes — assignment
    // writes are NOT part of cancel-many; the cancellation flips
    // execution-case state and lets the read filters hide the row.
    "schedulerAssignments).set(",
    "db.insert(schedulerAssignments",
  ];
  for (const needle of FORBIDDEN_IN_BLOCK) {
    if (block.includes(needle)) {
      failures.push(
        `${ROUTE_REL}: cancel-many block must not reference "${needle}" (scope creep)`,
      );
    }
  }

  // 6. No write to patient_screenings inside the cancel-many block.
  if (block.includes("db.update(patientScreenings")) {
    failures.push(
      `${ROUTE_REL}: cancel-many block must not update patient_screenings`,
    );
  }
  if (block.includes("db.delete(patientScreenings")) {
    failures.push(
      `${ROUTE_REL}: cancel-many block must not delete patient_screenings`,
    );
  }
}

// 7. The read-side filter the cancel-many write makes effective is
//    still in place at the top of the file (lines ~165-176). A
//    future PR that drops "cancelled" from this filter would un-
//    hide the cancelled rows.
requireText(ROUTE_REL, [
  "'archived','closed','cancelled','completed'",
]);

// 8. PHI envelope — the cancel-many block's non-audit logs MUST
//    NOT carry PHI identifiers. The audit envelope (the
//    appendJourneyEvent call) IS allowed to carry patientName /
//    patientDob per Bundle 8's audit-trail exception. We scope
//    the PHI check to the `console.error` / `console.log` lines
//    inside the block.
if (block !== null) {
  const consoleLines = block
    .split(/\r?\n/)
    .filter((l) => l.includes("console.error") || l.includes("console.log") || l.includes("console.warn"));
  const consoleText = consoleLines.join("\n");
  for (const needle of [
    "patientName",
    "patientDob",
    "phoneNumber",
    "diagnosis",
    "mrn",
    "insurance",
  ]) {
    if (consoleText.includes(needle)) {
      failures.push(
        `${ROUTE_REL}: cancel-many non-audit log line carries PHI identifier "${needle}"`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Engagement Center cancel-many invariant QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("Engagement Center cancel-many invariant QA passed.");
