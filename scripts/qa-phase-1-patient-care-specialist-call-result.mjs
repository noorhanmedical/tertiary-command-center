// QA — PCS Workspace call-result write uses the canonical endpoint.
//
// PCS Workspace surfaces calls via the canonical /api/scheduler-portal/
// cases feed (queryKey ["team-workspace-call-list", ...]). When a call
// result is logged through DispositionSheet or CanonicalRowActions,
// the write must go through engagementCallResultEndpoint() (canonical
// by default after Slice 1.4) AND must invalidate the PCS workspace
// call list so the operator sees the next call without a manual refresh.
//
// Run: node scripts/qa-phase-1-patient-care-specialist-call-result.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

function requireText(rel, needles) {
  const src = read(rel);
  if (src === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const n of needles) {
    if (!src.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
  }
}

const disposition = "client/src/components/outreach/DispositionSheet.tsx";
const canonRow = "client/src/components/outreach/CanonicalRowActions.tsx";
const flagLib = "client/src/lib/engagementCanonicalCallResultsUiFlag.ts";

// 1) Both UI surfaces post through the canonical endpoint resolver.
requireText(disposition, [
  "engagementCallResultEndpoint",
  "apiRequest(\"POST\", engagementCallResultEndpoint()",
]);
requireText(canonRow, [
  "engagementCallResultEndpoint",
  "apiRequest(\"POST\", engagementCallResultEndpoint()",
]);

// 2) The resolver returns the canonical plural endpoint by default
//    (Slice 1.4 polarity flip). Legacy is reachable only via the
//    rollback flag VITE_LEGACY_CALL_RESULT_ROLLBACK.
requireText(flagLib, [
  "engagementCallResultEndpoint",
  "/api/engagement-center/call-results",
  "/api/engagement-center/call-result",
  "VITE_LEGACY_CALL_RESULT_ROLLBACK",
  // Default-canonical marker so the polarity isn't accidentally
  // re-inverted in a future refactor.
  "PHASE-1 CANONICAL CALL-RESULT DEFAULT",
]);

// 3) Both UI surfaces invalidate the PCS Workspace call list query
//    after save so the operator sees the next call without a manual
//    refresh. The key matches the prefix used by TeamPortalShell.
requireText(disposition, [
  "team-workspace-call-list",
]);
requireText(canonRow, [
  "team-workspace-call-list",
]);

if (failures.length > 0) {
  console.error("PCS call-result canonical writeback QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("PCS call-result canonical writeback QA passed.");
