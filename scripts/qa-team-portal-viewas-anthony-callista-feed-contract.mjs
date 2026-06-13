// QA — Anthony / Callista feed contract.
//
// When an admin uses view-as to observe Anthony or Callista (or any
// other PCS/ACS user), the right-panel call list must narrow to
// THAT user's Engagement-assigned cases. This is the PR B fix for
// the Anthony / Callista root cause documented in
// docs/architecture/complete-team-portal-operations-runtime.md §B.
//
// We assert by reading the code:
//   - resolveCallListAssignmentScope (server-side) returns locked +
//     schedulerId when the caller is admin with viewAsUserId.
//   - Locked scope is applied to the assignedTeamMemberId filter
//     even when the client sends nothing.
//   - When no scheduler row matches (impossible filter), the feed
//     returns an empty result instead of falling back to "all cases
//     in facility" (which would silently regress the Anthony /
//     Callista visibility fix).
//   - Client-supplied assignedTeamMemberId is IGNORED when locked.
//
// Run: node scripts/qa-team-portal-viewas-anthony-callista-feed-contract.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const helper = fs.readFileSync(
  path.join(root, "server/services/teamMemberScope.ts"),
  "utf8",
);

if (!helper.includes("isAdmin && viewAsUserId && facilityId")) {
  failures.push("resolveCallListAssignmentScope must explicitly branch on (admin && viewAsUserId && facilityId) — Anthony/Callista view-as path");
}
if (!helper.includes("return { schedulerId, locked: true }")) {
  failures.push("Admin view-as branch must return locked: true so a client override cannot widen the queue");
}
if (!helper.includes("return { schedulerId: null, locked: false }")) {
  failures.push("Admin pass-through branch must return locked: false");
}

// Locked + schedulerId null → impossible filter (-1) so the queue is
// empty rather than silently unfiltered. This guards the regression
// where a misconfigured user (no outreach_schedulers row for the
// facility) would fall through to "all cases".
const exec = fs.readFileSync(
  path.join(root, "server/routes/executionCases.ts"),
  "utf8",
);
if (!/filters\.assignedTeamMemberId = assignmentScope\.schedulerId \?\? -1/.test(exec)) {
  failures.push("executionCases.ts must coerce a null schedulerId under locked to -1 (impossible filter) instead of leaving the queue unfiltered");
}
if (!/} else if \(q\.assignedTeamMemberId\)/.test(exec)) {
  failures.push("executionCases.ts must only honor a client-supplied assignedTeamMemberId when assignmentScope.locked is false");
}

if (failures.length > 0) {
  console.error("Anthony/Callista view-as contract QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Anthony/Callista view-as contract QA passed.");
