// QA — PCS and ACS portals are visually identical.
//
// Asserts:
//   1. Both pages mount ClinicWorkflowPortal with only the workspace
//      role differing.
//   2. ClinicWorkflowPortal routes both team-member roles to the same
//      TeamPortalShell.
//   3. There is no parallel "AncillaryShell" or "ACSShell" or
//      "PCSShell" alongside TeamPortalShell.
//   4. The left tools rail testids are not specialized per workspace
//      type (no `data-testid="left-rail-pcs-*"` / `-acs-*` variants).
//
// Run: node scripts/qa-team-portals-identical-pcs-acs-layout.mjs

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

function requireNotText(rel, needles, label) {
  const src = read(rel);
  if (src === null) return;
  for (const n of needles) if (src.includes(n)) failures.push(`${label}: forbidden "${n}" in ${rel}`);
}

requireText("client/src/pages/patient-care-specialist-portal.tsx", [
  '<ClinicWorkflowPortal role="patientCareSpecialist" />',
]);
requireText("client/src/pages/ancillary-care-specialist-portal.tsx", [
  '<ClinicWorkflowPortal role="ancillaryCareSpecialist" />',
]);

requireText("client/src/components/workflow/ClinicWorkflowPortal.tsx", [
  "TeamPortalShell",
  "patientCareSpecialist",
  "ancillaryCareSpecialist",
  "isTeamMemberWorkspace",
]);

// 3) No parallel shell files for PCS or ACS.
const portalDir = path.join(root, "client", "src", "components", "portal");
if (fs.existsSync(portalDir)) {
  for (const entry of fs.readdirSync(portalDir)) {
    if (/^(PCS|ACS|PatientCareSpecialist|AncillaryCareSpecialist).*Shell\.tsx$/.test(entry)) {
      failures.push(
        `Forbidden parallel shell file: client/src/components/portal/${entry}. PCS and ACS share TeamPortalShell.`,
      );
    }
  }
}

// 4) Left rail testids must be workspace-agnostic.
requireNotText(
  "client/src/components/portal/TeamPortalShell.tsx",
  [
    'data-testid="left-rail-pcs-',
    'data-testid="left-rail-acs-',
    'data-testid="left-rail-tool-pcs-',
    'data-testid="left-rail-tool-acs-',
  ],
  "Left rail testids must be workspace-agnostic (PCS + ACS are identical)",
);

if (failures.length > 0) {
  console.error("PCS ↔ ACS identical layout QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("PCS ↔ ACS identical layout QA passed.");
