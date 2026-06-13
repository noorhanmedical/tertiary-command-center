// QA — TeamPortalShell mode feeds end-to-end.
//
// Asserts that all three WorkspaceModeSwitcher modes (Clinic Schedule,
// Ancillary Schedule, Call List) are wired to canonical feeds and that
// server-side facility scoping is in place via /api/portal/my-facilities
// + facility allow-list narrowing in the shell.
//
// Run: node scripts/qa-phase-1-teamportal-shell-mode-feeds.mjs

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

const switcher = "client/src/components/portal/WorkspaceModeSwitcher.tsx";
const shell = "client/src/components/portal/TeamPortalShell.tsx";
const api = "client/src/lib/workflow/teamMemberWorkspaceApi.ts";

// 1) WorkspaceModeSwitcher exports the canonical 3-mode union.
requireText(switcher, [
  "TEAM_MEMBER_WORKSPACE_MODES",
  '"clinicSchedule"',
  '"ancillarySchedule"',
  '"callList"',
  '"Clinic Schedule"',
  '"Ancillary Schedule"',
  '"Call List"',
  "WorkspaceModeSwitcher",
  "workspace-mode-switcher",
]);

// 2) Each mode is consumed by a useQuery in the shell with the
//    canonical feed helper, all gated on a non-empty facility scope.
requireText(shell, [
  "WorkspaceModeSwitcher",
  "team-workspace-call-list",
  "team-workspace-clinic-schedule",
  "team-workspace-ancillary-schedule",
  "fetchWorkspaceCallList",
  "fetchWorkspaceClinicSchedule",
  "fetchWorkspaceAncillarySchedule",
  "enabled: !!facility",
]);

// 3) Server-side facility scope: /api/portal/my-facilities feeds the
//    facility allow-list, and the profile-driven narrowing applies the
//    assignedFacilityIds gate from the workspace profile.
requireText(shell, [
  "/api/portal/my-facilities",
  "assignedFacilityIds",
  "profileAssignedFacilities",
  "profileViewAllFacilities",
]);

// 4) The feed helpers point at the canonical backend routes.
requireText(api, [
  "/api/technician-liaison/clinic-visits",
  "/api/technician-liaison/ancillary-schedule",
  "/api/scheduler-portal/cases",
]);

if (failures.length > 0) {
  console.error("Team Portal Shell mode-feed QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Team Portal Shell mode-feed QA passed.");
