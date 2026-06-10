// QA: Portal call-history read-only route (Batch I).
//
// Source-code invariant pinning the new flag-gated read-only route
// at GET /api/portal/calls.
//
// What this asserts:
//   1. The flag accessor exists, is pure (no DB / schema / service
//      deps), and matches the canonical truthy-value pattern.
//   2. The route file imports the flag accessor and gates the
//      handler on it.
//   3. The route is read-only — no db.insert / db.update /
//      db.delete inside the handler block.
//   4. The route delegates to storage.listOutreachCallsForPatient
//      (the existing helper).
//   5. The route applies the Batch G envelope (allowed fields only;
//      no money/Admin Review/PHI-shaped field leakage).
//   6. The route returns 404 (NOT 403) on cross-facility / not-found,
//      per Batch G §4.
//   7. The portal route still has zero writes to scheduler_assignments,
//      patient_execution_cases, or outreach_calls — Batch C invariant
//      restated.
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

// 1. Flag accessor exists and stays pure.
const FLAG_REL = "server/modules/portal/call-history-read-flag.ts";
requireFile(FLAG_REL);
requireText(FLAG_REL, [
  "isPortalCallHistoryReadEnabled",
  "USE_PORTAL_CALL_HISTORY_READ",
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
    'from "../../routes/',
    "drizzle-orm",
  ],
  "portal call-history flag accessor must stay pure",
);

// 2. Route file imports the flag accessor and gates the handler.
const ROUTE_REL = "server/routes/portal.ts";
requireFile(ROUTE_REL);
requireText(ROUTE_REL, [
  '"/api/portal/calls"',
  "isPortalCallHistoryReadEnabled",
  "../modules/portal/call-history-read-flag",
  // Delegates to existing storage helper — no parallel write path.
  "storage.listOutreachCallsForPatient",
  // Auth + facility scope helpers used to derive RBAC.
  "requirePortalRole",
  "allowedFacilities",
  "ensureFacility",
  "patientFacility",
  // Batch G §4 — cross-facility returns 404 not 403.
  'res.status(404)',
]);

// 3. Whole route file MUST NOT write to scheduler_assignments,
//    patient_execution_cases, outreach_calls, or
//    patient_journey_events. Re-asserts the Batch C invariant after
//    Batch I's additive route lands.
requireNotText(
  ROUTE_REL,
  [
    "db.insert(schedulerAssignments",
    "db.update(schedulerAssignments",
    "db.delete(schedulerAssignments",
    "db.insert(patientExecutionCases",
    "db.update(patientExecutionCases",
    "db.delete(patientExecutionCases",
    "db.insert(outreachCalls",
    "db.update(outreachCalls",
    "db.insert(patientJourneyEvents",
    "db.update(patientJourneyEvents",
  ],
  "portal route must not directly write canonical call-list tables (Batch C invariant restated)",
);

// 4. The Batch G envelope — extract the new route block and verify
//    the envelope projects ONLY the allowed Batch G §1 fields. The
//    block lives between `"/api/portal/calls"` and the next route
//    declaration (`"/api/portal/my-facilities"`).
{
  const routeSrc = read(ROUTE_REL) ?? "";
  const startMarker = '"/api/portal/calls"';
  const endMarker = '"/api/portal/my-facilities"';
  const startIdx = routeSrc.indexOf(startMarker);
  const endIdx = routeSrc.indexOf(endMarker, startIdx);
  const block = startIdx === -1 ? "" : routeSrc.slice(startIdx, endIdx === -1 ? routeSrc.length : endIdx);

  // Allowed envelope keys (Batch G §1) must appear in the route's
  // response projection.
  const ALLOWED_ENVELOPE = [
    "id:",
    "patientScreeningId:",
    "outcome:",
    "notes:",
    "callbackAt:",
    "attemptNumber:",
    "durationSeconds:",
    "startedAt:",
  ];
  for (const needle of ALLOWED_ENVELOPE) {
    if (!block.includes(needle)) {
      failures.push(
        `${ROUTE_REL}: portal call-history block missing envelope key "${needle}"`,
      );
    }
  }

  // Forbidden fields (Batch G §2) must NOT appear in the route's
  // response projection. The check scans the block for explicit
  // money / admin / PHI-shaped keys.
  const FORBIDDEN_IN_BLOCK = [
    // Money / billing.
    "fullAmountPaid",
    "claimAmount",
    "remittanceAmount",
    "totalAmount",
    "netAmount",
    "balanceDue",
    "invoiceId:",
    // Raw Admin Review internals.
    "reasoning:",
    "adminApprovalNote",
    "evidenceSnapshot",
    // Raw scheduler linkage.
    "scheduler_assignment_id",
    "schedulerUserId:",
    "scheduler_user_id",
  ];
  for (const needle of FORBIDDEN_IN_BLOCK) {
    if (block.includes(needle)) {
      failures.push(
        `${ROUTE_REL}: portal call-history block contains forbidden field "${needle}"`,
      );
    }
  }

  // PHI envelope at the block-text level — patient name / DOB / MRN
  // must not surface on the response projection.
  for (const needle of [
    "patientName:",
    "patientDob:",
    "mrn:",
  ]) {
    if (block.includes(needle)) {
      failures.push(
        `${ROUTE_REL}: portal call-history block must not surface "${needle}"`,
      );
    }
  }

  // The block must not contain a write verb anywhere inside it.
  for (const needle of [
    "db.insert(",
    "db.update(",
    "db.delete(",
  ]) {
    if (block.includes(needle)) {
      failures.push(
        `${ROUTE_REL}: portal call-history block contains write verb "${needle}" — route must be read-only`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Portal call-history route QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("Portal call-history route QA passed.");
