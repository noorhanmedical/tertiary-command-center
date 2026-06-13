// QA — Call-result canonical writeback full invalidation contract.
//
// After a call-result write through DispositionSheet or
// CanonicalRowActions, every cache that surfaces the call status to a
// human must be invalidated:
//
//   - call list           → /api/portal/outreach-call-list (legacy outreach UI)
//                         → /api/scheduler-portal/cases    (engagement / PCS)
//                         → team-workspace-call-list       (PCS Workspace shell)
//   - assigned work       → /api/scheduler-portal/cases
//   - Engagement status   → /api/engagement-center/cases
//   - call history        → portal-call-history (DispositionSheet only)
//   - Patient Directory   → /api/patient-directory/... if surfaced
//
// This QA asserts each invalidation is present in the source code.
// Source-level only — runtime invalidation is verified by React Query.
//
// Run: node scripts/qa-phase-1-call-result-canonical-writeback-full.mjs

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

// DispositionSheet must invalidate every consumer surface.
requireText(disposition, [
  // legacy outreach UI
  "/api/portal/outreach-call-list",
  // engagement
  "/api/engagement-center/cases",
  // PCS Workspace shell
  "team-workspace-call-list",
  // portal task list (consumes the case)
  "/api/portal/my-tasks",
  // call history per patient
  "portal-call-history",
]);

// CanonicalRowActions must invalidate every consumer surface used by
// the outreach scheduler portal AND the PCS Workspace.
requireText(canonRow, [
  "/api/scheduler-portal/cases",
  "/api/engagement-center/cases",
  "/api/patient-journey-events",
  "/api/portal/outreach-call-list",
  "/api/portal/my-tasks",
  "team-workspace-call-list",
]);

if (failures.length > 0) {
  console.error("Call-result canonical writeback (full) QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Call-result canonical writeback (full) QA passed.");
