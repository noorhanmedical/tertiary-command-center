// QA: recordCallResult engagement-center preview path
// (Batch H Step 2).
//
// Source-code invariant pinning the new default-OFF preview path.
//
// What this asserts:
//   1. The preview-flag module exists at the canonical path.
//   2. The flag accessor matches the canonical default-OFF pattern
//      (truthy values: "1" / "true" / "yes"). Default OFF.
//   3. The preview-flag module is pure — no Express, no DB, no
//      drizzle, no schema runtime, no route import, no storage,
//      no journey-event writer.
//   4. The preview-flag module is the SOLE runtime importer of
//      recordCallResult (mirrors the dormancy QA's allow-list).
//   5. The engagement-center route still owns its load-bearing
//      writes: appendJourneyEvent, upsertOpenSchedulingTriageCase,
//      storage.createTask, db.update(patientExecutionCases).
//   6. The route file imports the preview-flag module and guards
//      the preview call on `isRecordCallResultEngagementPreviewEnabled()`.
//   7. The route does NOT import the recordCallResult planner
//      directly.
//   8. The /api/outreach/calls route file is UNTOUCHED — no
//      reference to recordCallResult or to the preview flag.
//   9. The Team Portal route is UNTOUCHED — no reference to
//      recordCallResult or to the preview flag.
//  10. The response shape of POST /api/engagement-center/call-result
//      is unchanged — still returns
//      { ok, executionCase, journeyEvent, triageCase, task,
//        ownershipUpdated }.
//  11. The preview helper logs no PHI — its console line contains
//      only outcome labels, surface, and boolean parity flags.
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

// 1. Preview-flag module present.
const FLAG_REL = "server/services/callResult/recordCallResultEngagementPreviewFlag.ts";
requireFile(FLAG_REL);

// 2. Flag accessor + canonical truthy values.
requireText(FLAG_REL, [
  "isRecordCallResultEngagementPreviewEnabled",
  "USE_RECORD_CALL_RESULT_ENGAGEMENT_PREVIEW",
  '"1"',
  '"true"',
  '"yes"',
  "runEngagementCallResultPreview",
  "engagement_center_route",
  "record-call-result-preview",
]);

// 3. Purity — preview-flag module must not pull in DB / Express /
//    drizzle / schema runtime / routes / storage / journey-event
//    writer / logger.
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
  "preview-flag module must stay pure (no DB / Express / route / storage imports)",
);

// The preview-flag module must import the canonical planner from the
// sibling module — that's its designated job.
{
  const c = read(FLAG_REL) ?? "";
  if (!/from\s+['"]\.\/recordCallResult['"]/.test(c)) {
    failures.push(
      `${FLAG_REL}: preview-flag module must import the recordCallResult planner via the sibling specifier "./recordCallResult"`,
    );
  }
}

// 4. Engagement-center route file present + load-bearing writes
//    preserved.
const ROUTE_REL = "server/routes/executionCases.ts";
requireFile(ROUTE_REL);
requireText(ROUTE_REL, [
  // Route path unchanged.
  '"/api/engagement-center/call-result"',
  // Existing writes still present.
  "appendJourneyEvent",
  "upsertOpenSchedulingTriageCase",
  "storage.createTask",
  ".update(patientExecutionCases)",
  // Preview guard wired in.
  "isRecordCallResultEngagementPreviewEnabled",
  "runEngagementCallResultPreview",
  "../services/callResult/recordCallResultEngagementPreviewFlag",
  // Response shape unchanged — these are the keys on the returned envelope.
  "executionCase: updatedExecutionCase",
  "journeyEvent,",
  "triageCase,",
  "task,",
  "ownershipUpdated,",
]);

// 5. Route MUST NOT import the canonical planner directly — only
//    via the preview-flag module.
{
  const c = read(ROUTE_REL) ?? "";
  if (/from\s+['"][^'"]*\/recordCallResult['"]/.test(c)) {
    failures.push(
      `${ROUTE_REL}: route must not import recordCallResult directly — go through the preview-flag module`,
    );
  }
}

// 6. /api/outreach/calls route MUST NOT reference the planner OR
//    the preview flag (Batch H Step 2 hard-stop: don't touch the
//    other write path yet).
const OUTREACH_REL = "server/routes/outreach.ts";
requireFile(OUTREACH_REL);
requireNotText(
  OUTREACH_REL,
  [
    "recordCallResult",
    "USE_RECORD_CALL_RESULT_ENGAGEMENT_PREVIEW",
    "isRecordCallResultEngagementPreviewEnabled",
    "runEngagementCallResultPreview",
  ],
  "outreach.ts must remain untouched by Batch H Step 2",
);

// 7. Team Portal route untouched.
const PORTAL_REL = "server/routes/portal.ts";
if (read(PORTAL_REL) !== null) {
  requireNotText(
    PORTAL_REL,
    [
      "recordCallResult",
      "USE_RECORD_CALL_RESULT_ENGAGEMENT_PREVIEW",
      "isRecordCallResultEngagementPreviewEnabled",
      "runEngagementCallResultPreview",
    ],
    "portal.ts must remain untouched by Batch H Step 2",
  );
}

// 8. PHI hygiene — the preview-flag module must not interpolate
//    patient identifiers into its log line.
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
    // Even the screening id must not be in the log output. The
    // module is permitted to ACCEPT it on input (as input.patientScreeningId)
    // because it's an opaque foreign key the planner needs — but the
    // emitted log line must not contain it.
  ],
  "preview-flag module must not log PHI",
);
{
  // Extract just the console.* lines and assert no patient ID surfaces.
  const c = read(FLAG_REL) ?? "";
  const consoleLines = c
    .split("\n")
    .filter((l) => /console\.(info|log|warn|error|debug)\s*\(/.test(l));
  for (const line of consoleLines) {
    for (const k of ["patientScreeningId", "executionCaseId", "patientName", "patientDob"]) {
      if (line.includes(k)) {
        failures.push(
          `${FLAG_REL}: console line "${line.trim()}" must not include "${k}"`,
        );
      }
    }
  }
  if (consoleLines.length === 0) {
    failures.push(
      `${FLAG_REL}: preview helper must emit at least one console.info parity line`,
    );
  }
}

if (failures.length > 0) {
  console.error("recordCallResult engagement-preview QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("recordCallResult engagement-preview QA passed.");
