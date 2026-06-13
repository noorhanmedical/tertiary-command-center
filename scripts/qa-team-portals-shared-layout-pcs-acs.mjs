// QA — PCS and ACS share the same shell + layout.
//
// PCS and ACS pages must both mount ClinicWorkflowPortal, which routes
// the team-member workspace types to the same TeamPortalShell. The
// only differences are the workspace label and the default mode. No
// new shell, no separate visual system.
//
// Run: node scripts/qa-team-portals-shared-layout-pcs-acs.mjs

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

const pcs = "client/src/pages/patient-care-specialist-portal.tsx";
const acs = "client/src/pages/ancillary-care-specialist-portal.tsx";
const workflow = "client/src/components/workflow/ClinicWorkflowPortal.tsx";

// 1) Both pages render ClinicWorkflowPortal with only the role differing.
requireText(pcs, ['<ClinicWorkflowPortal role="patientCareSpecialist" />']);
requireText(acs, ['<ClinicWorkflowPortal role="ancillaryCareSpecialist" />']);

// 2) ClinicWorkflowPortal routes both team-member roles to the same
//    TeamPortalShell. Default modes differ; the shell is shared.
requireText(workflow, [
  "TeamPortalShell",
  "patientCareSpecialist",
  "ancillaryCareSpecialist",
  '"callList"',       // PCS default
  '"clinicSchedule"', // ACS default
  "isTeamMemberWorkspace",
]);

// 3) No file outside /pages/* shall mount a parallel "Team Portal"
//    shell with a different layout. We assert by ruling out a second
//    /portal/*Shell.tsx beyond the canonical ones.
const ALLOWED_SHELLS = new Set([
  "PortalShell.tsx", // legacy technician/liaison shell
  "TeamPortalShell.tsx", // canonical team-member shell
]);
const portalDir = path.join(root, "client", "src", "components", "portal");
if (fs.existsSync(portalDir)) {
  for (const entry of fs.readdirSync(portalDir)) {
    if (entry.endsWith("Shell.tsx") && !ALLOWED_SHELLS.has(entry)) {
      failures.push(
        `Unexpected portal shell found: client/src/components/portal/${entry} — PCS and ACS must share the existing TeamPortalShell.`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("PCS↔ACS shared-layout QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("PCS↔ACS shared-layout QA passed.");
