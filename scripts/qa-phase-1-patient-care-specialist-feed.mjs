// QA — Patient Care Specialist Workspace is wired to real feeds.
//
// Asserts source-level wiring only (DB-free). This script proves that
// the PCS page mounts the canonical ClinicWorkflowPortal shell and that
// no demo patient is injected ahead of real data.
//
// Run: node scripts/qa-phase-1-patient-care-specialist-feed.mjs

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

const pcsPage = "client/src/pages/patient-care-specialist-portal.tsx";
const workflowPortal = "client/src/components/workflow/ClinicWorkflowPortal.tsx";
const shell = "client/src/components/portal/TeamPortalShell.tsx";
const api = "client/src/lib/workflow/teamMemberWorkspaceApi.ts";

// 1) PCS page exists and renders ClinicWorkflowPortal with the
//    patientCareSpecialist role.
requireText(pcsPage, [
  "ClinicWorkflowPortal",
  'role="patientCareSpecialist"',
]);

// 2) ClinicWorkflowPortal maps patientCareSpecialist to the team-member
//    shell (TeamPortalShell), with the canonical defaultMode "callList".
requireText(workflowPortal, [
  "TeamPortalShell",
  'patientCareSpecialist',
  '"Patient Care Specialist Workspace"',
  '"callList"',
]);

// 3) TeamPortalShell consumes the 3 canonical workspace feeds + the
//    portal facility scope. Demo-patient injection must be gone.
requireText(shell, [
  "fetchWorkspaceCallList",
  "fetchWorkspaceClinicSchedule",
  "fetchWorkspaceAncillarySchedule",
  "fetchTeamMemberProfile",
  "/api/portal/my-facilities",
  "team-workspace-call-list",
  "team-workspace-clinic-schedule",
  "team-workspace-ancillary-schedule",
]);

// 4) The shell must NOT prepend a hardcoded demo patient to the live
//    feed. Slice 1.1 removed this; reintroducing it blocks real-feed
//    verification on staging.
requireNotText(
  shell,
  [
    "aliBoomayePatient",
    "Ali Boomaye",
    "ALI-900001",
  ],
  "PCS feed must not prepend a hardcoded demo patient",
);

// 5) The 3 workspace feed helpers in the API library point to the
//    canonical backend endpoints.
requireText(api, [
  "/api/technician-liaison/clinic-visits",
  "/api/technician-liaison/ancillary-schedule",
  "/api/scheduler-portal/cases",
  "fetchWorkspaceClinicSchedule",
  "fetchWorkspaceAncillarySchedule",
  "fetchWorkspaceCallList",
]);

if (failures.length > 0) {
  console.error("Patient Care Specialist feed QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Patient Care Specialist feed QA passed.");
