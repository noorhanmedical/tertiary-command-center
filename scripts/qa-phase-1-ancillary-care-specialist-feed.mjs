// QA — Ancillary Care Specialist Workspace is wired to real feeds.
//
// Asserts source-level wiring only (DB-free). Mirrors the PCS feed QA
// for ACS and additionally verifies the clinicSchedule default mode
// and ancillary-service-type filtering scaffold.
//
// Run: node scripts/qa-phase-1-ancillary-care-specialist-feed.mjs

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

function requireNotText(rel, needles, label) {
  const src = read(rel);
  if (src === null) return;
  for (const n of needles) {
    if (src.includes(n)) failures.push(`${label}: forbidden "${n}" still present in ${rel}`);
  }
}

const acsPage = "client/src/pages/ancillary-care-specialist-portal.tsx";
const workflowPortal = "client/src/components/workflow/ClinicWorkflowPortal.tsx";
const shell = "client/src/components/portal/TeamPortalShell.tsx";
const api = "client/src/lib/workflow/teamMemberWorkspaceApi.ts";

// 1) ACS page exists and renders ClinicWorkflowPortal with the
//    ancillaryCareSpecialist role.
requireText(acsPage, [
  "ClinicWorkflowPortal",
  'role="ancillaryCareSpecialist"',
]);

// 2) ClinicWorkflowPortal maps ancillaryCareSpecialist to the team-
//    member shell with default mode clinicSchedule.
requireText(workflowPortal, [
  "ancillaryCareSpecialist",
  '"Ancillary Care Specialist Workspace"',
  '"clinicSchedule"',
]);

// 3) TeamPortalShell consumes the 3 canonical workspace feeds + the
//    portal facility scope + the ancillary service-type allow-list.
requireText(shell, [
  "fetchWorkspaceClinicSchedule",
  "fetchWorkspaceAncillarySchedule",
  "fetchWorkspaceCallList",
  "fetchTeamMemberProfile",
  "/api/portal/my-facilities",
  "allowedServiceTypes",
  "filteredAncillarySchedule",
]);

// 4) Demo patient must be gone (mirrors the PCS rule — both workspaces
//    share the same shell so they share the no-demo-patient rule).
requireNotText(
  shell,
  [
    "aliBoomayePatient",
    "Ali Boomaye",
    "ALI-900001",
  ],
  "ACS feed must not prepend a hardcoded demo patient",
);

// 5) Canonical ancillary feed endpoint.
requireText(api, [
  "/api/technician-liaison/ancillary-schedule",
  "fetchWorkspaceAncillarySchedule",
]);

if (failures.length > 0) {
  console.error("Ancillary Care Specialist feed QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Ancillary Care Specialist feed QA passed.");
