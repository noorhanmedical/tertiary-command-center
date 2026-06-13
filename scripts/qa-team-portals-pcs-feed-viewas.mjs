// QA — PCS Workspace feeds honor viewAsTeamMemberId end-to-end.
//
// PCS feeds (call-list + clinic-schedule + ancillary-schedule) must
// accept the viewAsTeamMemberId param + propagate it to the resolver
// with workspace="pcs" so the role check enforces the liaison role.
//
// Run: node scripts/qa-team-portals-pcs-feed-viewas.mjs

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
  if (src === null) { failures.push(`Missing file: ${rel}`); return; }
  for (const n of needles) if (!src.includes(n)) failures.push(`Missing "${n}" in ${rel}`);
}

const api = "client/src/lib/workflow/teamMemberWorkspaceApi.ts";
const execCases = "server/routes/executionCases.ts";
const globalSched = "server/routes/globalSchedule.ts";
const shell = "client/src/components/portal/TeamPortalShell.tsx";

// 1) Client helpers append viewAsTeamMemberId to the query string.
requireText(api, [
  'appendIf(qs, "viewAsTeamMemberId", params.viewAsTeamMemberId)',
  "fetchWorkspaceCallList",
  "fetchWorkspaceClinicSchedule",
  "fetchWorkspaceAncillarySchedule",
  "fetchTeamMembersForWorkspace",
]);

// 2) PCS call-list endpoint passes viewAsTeamMemberId. PR B made the
//    workspace arg conditional so both PCS and ACS can share the
//    shared call-list endpoint — the workspace is read from a
//    whitelisted query param ("pcs"|"acs"). The endpoint must:
//    a) still register at /api/scheduler-portal/cases
//    b) still call resolvePhase1FacilityScope with viewAsTeamMemberId
//    c) whitelist q.workspace as "pcs" | "acs" before passing it
requireText(execCases, [
  '"/api/scheduler-portal/cases"',
  'resolvePhase1FacilityScope(req, res, q.facilityId, q.viewAsTeamMemberId, wsParam)',
  'q.workspace === "acs" || q.workspace === "pcs"',
]);

// 3) Schedule endpoints (shared) pass viewAsTeamMemberId.
requireText(globalSched, [
  'resolvePhase1FacilityScope(req, res, q.facilityId, q.viewAsTeamMemberId)',
]);

// 4) Shell threads viewAsTeamMemberId into all three workspace
//    feed queries (key includes it AND the fetch call passes it).
requireText(shell, [
  '"team-workspace-call-list"',
  '"team-workspace-clinic-schedule"',
  '"team-workspace-ancillary-schedule"',
  "viewAsTeamMemberId,",
  "fetchWorkspaceCallList({",
  "fetchWorkspaceClinicSchedule({",
  "fetchWorkspaceAncillarySchedule({",
]);

if (failures.length > 0) {
  console.error("PCS feed view-as QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("PCS feed view-as QA passed.");
