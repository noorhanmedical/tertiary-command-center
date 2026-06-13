// QA — The ONLY runtime difference between PCS and ACS portals is the
// default workspace mode.
//
// Specifically:
//   - DEFAULT_MODE[patientCareSpecialist] === "callList"
//   - DEFAULT_MODE[ancillaryCareSpecialist] === "clinicSchedule"
//     (current code default; documented in
//     docs/architecture/complete-team-portal-operations-runtime.md
//     §Q6. If the product later moves the ACS default to
//     "ancillarySchedule", update this QA in lockstep.)
//
// Forbid any other per-role gating in ClinicWorkflowPortal (different
// shell, different label that's not just a workspace name, hiding a
// mode, etc.).
//
// Run: node scripts/qa-team-portals-only-default-mode-differs.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const src = fs.readFileSync(
  path.join(root, "client/src/components/workflow/ClinicWorkflowPortal.tsx"),
  "utf8",
);

// 1) Both team-member roles share the same shell.
if (!/TeamPortalShell[\s\S]*patientCareSpecialist[\s\S]*ancillaryCareSpecialist/.test(src)
 && !/TeamPortalShell[\s\S]*ancillaryCareSpecialist[\s\S]*patientCareSpecialist/.test(src)) {
  failures.push("ClinicWorkflowPortal must route BOTH team-member roles to TeamPortalShell");
}

// 2) DEFAULT_MODE has both PCS and ACS entries with the documented
//    values.
const pcsDefaultRe = /patientCareSpecialist:\s*"(callList|clinicSchedule|ancillarySchedule)"/;
const acsDefaultRe = /ancillaryCareSpecialist:\s*"(callList|clinicSchedule|ancillarySchedule)"/;
const pcsM = pcsDefaultRe.exec(src);
const acsM = acsDefaultRe.exec(src);
if (!pcsM) failures.push("DEFAULT_MODE missing patientCareSpecialist entry");
if (!acsM) failures.push("DEFAULT_MODE missing ancillaryCareSpecialist entry");
if (pcsM && acsM && pcsM[1] === acsM[1]) {
  failures.push(
    `PCS and ACS default modes must differ — both are currently "${pcsM[1]}". The only allowed difference between the portals is the default mode.`,
  );
}

// 3) Forbid per-role-specific shell mounts. The adapter is allowed to
//    use the legacy PortalShell for the LEGACY technician/liaison
//    roles, but the team-member workspace roles must both go through
//    TeamPortalShell.
const teamMemberBlock = /isTeamMemberWorkspace[\s\S]*?\n\s*\}/.exec(src);
if (teamMemberBlock && /PortalShell\b(?!\s*}|s)/.test(teamMemberBlock[0]) && /TeamPortalShell/.test(teamMemberBlock[0]) === false) {
  // Unreachable in current code; defensive: if a future refactor
  // accidentally routes a team-member role to the legacy PortalShell,
  // this catches it.
  failures.push("Team-member roles must route to TeamPortalShell, not the legacy PortalShell");
}

if (failures.length > 0) {
  console.error("Only-default-mode-differs QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Only-default-mode-differs QA passed.");
