// QA: recordCallResult outreach-call preview path
// (Batch H Step 3).
//
// Source-code invariant pinning the new default-OFF preview path on
// POST /api/outreach/calls.
//
// What this asserts:
//   1. The outreach preview-flag module exists at the canonical path.
//   2. The flag accessor matches the canonical default-OFF pattern
//      (truthy values: "1" / "true" / "yes"). Default OFF.
//   3. The outreach preview-flag module is pure — no Express, no DB,
//      no drizzle, no schema runtime, no route import, no storage,
//      no journey-event writer.
//   4. The outreach preview-flag module imports the canonical planner
//      via the sibling specifier (mirrors the dormancy allow-list
//      entry).
//   5. The outreach route still owns its load-bearing writes:
//      `createOutreachCallAtomic`, `deriveAppointmentStatus`,
//      `markSchedulerAssignmentCompleted` (terminal),
//      `ensureCanonicalSpineForScreening`. None of these are removed.
//   6. The outreach route imports the outreach preview-flag module
//      and guards the preview call on
//      `isRecordCallResultOutreachPreviewEnabled()`.
//   7. The outreach route does NOT import the canonical planner
//      directly.
//   8. The outreach route does NOT import the ENGAGEMENT preview
//      module (the helpers are surface-isolated).
//   9. `/api/engagement-center/call-result` (executionCases.ts) is
//      UNTOUCHED by this PR — it must not reference the outreach
//      preview flag or the outreach-specific helper.
//  10. The response of POST /api/outreach/calls is unchanged — still
//      `res.status(201).json(call)` with the raw call row.
//  11. The outreach preview helper logs no PHI — its console.* lines
//      contain only outcome labels, surface, and boolean parity flags.
//  12. The Team Portal route remains untouched by this PR.
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

// 1. Outreach preview-flag module present.
const FLAG_REL = "server/services/callResult/recordCallResultOutreachPreviewFlag.ts";
requireFile(FLAG_REL);

// 2. Flag accessor + canonical truthy values.
requireText(FLAG_REL, [
  "isRecordCallResultOutreachPreviewEnabled",
  "USE_RECORD_CALL_RESULT_OUTREACH_PREVIEW",
  '"1"',
  '"true"',
  '"yes"',
  "runOutreachCallResultPreview",
  "outreach_call_route",
  "record-call-result-preview",
]);

// 3. Purity — outreach preview-flag module stays free of runtime deps.
requireNotText(
  FLAG_REL,
  [
    'from "../../db"',
    'from "../../../db"',
    'from "../db"',
    'from "drizzle-orm"',
    'from "drizzle-orm/',
    'from "express"',
    'from "@shared/schema"',
    'from "../../routes/',
    'from "../routes/',
    'from "../../storage"',
    'from "../storage"',
    'from "../../modules/journey-events/appendJourneyEvent"',
    'from "../modules/journey-events/appendJourneyEvent"',
    'from "../journey/appendJourneyEvent"',
    'from "../../services/journey/appendJourneyEvent"',
    'from "../outreachService"',
  ],
  "outreach preview-flag module must stay pure (no DB / Express / route / storage imports)",
);

// 4. Outreach preview-flag module must import the planner via the
//    sibling specifier — that's its designated job.
{
  const c = read(FLAG_REL) ?? "";
  if (!/from\s+['"]\.\/recordCallResult['"]/.test(c)) {
    failures.push(
      `${FLAG_REL}: outreach preview-flag module must import the recordCallResult planner via the sibling specifier`,
    );
  }
}

// 5. Outreach route still owns its load-bearing writes.
const ROUTE_REL = "server/routes/outreach.ts";
requireFile(ROUTE_REL);
requireText(ROUTE_REL, [
  '"/api/outreach/calls"',
  "createOutreachCallAtomic",
  "deriveAppointmentStatus",
  "markSchedulerAssignmentCompleted",
  "ensureCanonicalSpineForScreening",
  // Preview guard wired in.
  "isRecordCallResultOutreachPreviewEnabled",
  "runOutreachCallResultPreview",
  "../services/callResult/recordCallResultOutreachPreviewFlag",
  // Response shape unchanged.
  "res.status(201).json(call)",
]);

// 6. Outreach route MUST NOT import the canonical planner directly.
{
  const c = read(ROUTE_REL) ?? "";
  if (/from\s+['"][^'"]*\/recordCallResult['"]/.test(c)) {
    failures.push(
      `${ROUTE_REL}: route must not import recordCallResult directly — go through the preview-flag module`,
    );
  }
}

// 7. Outreach route MUST NOT import the engagement preview helper.
requireNotText(
  ROUTE_REL,
  [
    "USE_RECORD_CALL_RESULT_ENGAGEMENT_PREVIEW",
    "isRecordCallResultEngagementPreviewEnabled",
    "runEngagementCallResultPreview",
    "recordCallResultEngagementPreviewFlag",
  ],
  "outreach route must not import the engagement preview helper (surface-isolated)",
);

// 8. /api/engagement-center/call-result route file (executionCases.ts)
//    is untouched by this PR — no reference to the outreach preview
//    path.
const EC_REL = "server/routes/executionCases.ts";
requireFile(EC_REL);
requireNotText(
  EC_REL,
  [
    "USE_RECORD_CALL_RESULT_OUTREACH_PREVIEW",
    "isRecordCallResultOutreachPreviewEnabled",
    "runOutreachCallResultPreview",
    "recordCallResultOutreachPreviewFlag",
  ],
  "engagement-center route must not import the outreach preview helper (surface-isolated)",
);

// 9. Team Portal route untouched.
const PORTAL_REL = "server/routes/portal.ts";
if (read(PORTAL_REL) !== null) {
  requireNotText(
    PORTAL_REL,
    [
      "recordCallResult",
      "USE_RECORD_CALL_RESULT_OUTREACH_PREVIEW",
      "isRecordCallResultOutreachPreviewEnabled",
      "runOutreachCallResultPreview",
    ],
    "portal.ts must remain untouched by Batch H Step 3",
  );
}

// 10. PHI hygiene — outreach preview-flag module must not interpolate
//     patient identifiers into its log line.
requireNotText(
  FLAG_REL,
  [
    "patientName",
    "patientDob",
    "mrn",
    "ssn",
    "phoneNumber",
    "phoneE164",
    "address",
  ],
  "outreach preview-flag module must not log PHI",
);
{
  // Extract console.* lines; assert no patient ID surfaces and at
  // least one parity line is emitted.
  const c = read(FLAG_REL) ?? "";
  const consoleLines = c
    .split("\n")
    .filter((l) => /console\.(info|log|warn|error|debug)\s*\(/.test(l));
  for (const line of consoleLines) {
    for (const k of [
      "patientScreeningId",
      "executionCaseId",
      "patientName",
      "patientDob",
    ]) {
      if (line.includes(k)) {
        failures.push(
          `${FLAG_REL}: console line "${line.trim()}" must not include "${k}"`,
        );
      }
    }
  }
  if (consoleLines.length === 0) {
    failures.push(
      `${FLAG_REL}: outreach preview helper must emit at least one console.info parity line`,
    );
  }
}

if (failures.length > 0) {
  console.error("recordCallResult outreach-preview QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("recordCallResult outreach-preview QA passed.");
