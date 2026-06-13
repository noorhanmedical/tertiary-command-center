// QA — ACS Workspace feeds honor viewAsTeamMemberId end-to-end.
//
// ACS uses the same shared shell + feed helpers as PCS — view-as wiring
// at the API level is shared. The workspace type derived in the shell
// (`viewAsWorkspaceType`) must switch to "acs" when the workspace is
// ancillary, so the team-members endpoint returns technician-role
// users and the role check enforces the technician role.
//
// Run: node scripts/qa-team-portals-acs-feed-viewas.mjs

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

const shell = "client/src/components/portal/TeamPortalShell.tsx";
const globalSched = "server/routes/globalSchedule.ts";
const portal = "server/routes/portal.ts";

// 1) Shell derives workspaceType (PCS↔ACS) from workspaceIsAncillaryCareSpecialist.
requireText(shell, [
  "workspaceIsAncillaryCareSpecialist",
  '"acs"',
  '"pcs"',
  "viewAsWorkspaceType",
]);

// 2) ACS ancillary feed propagates viewAsTeamMemberId via the shared
//    resolver in globalSchedule.ts.
requireText(globalSched, [
  '"/api/technician-liaison/ancillary-schedule"',
  'resolvePhase1FacilityScope(req, res, q.facilityId, q.viewAsTeamMemberId)',
]);

// 3) Backend role mapping for ACS uses "technician".
requireText(portal, [
  'acs: "technician"',
  "VIEWAS_WORKSPACE_TO_ROLE",
]);

if (failures.length > 0) {
  console.error("ACS feed view-as QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("ACS feed view-as QA passed.");
