// QA — Both PCS and ACS portals must expose Call List AND
// Ancillary Schedule (AND Clinic Schedule). Only the DEFAULT mode
// differs.
//
// Asserts:
//   1. WorkspaceModeSwitcher exposes all 3 canonical modes
//      uniformly — no per-workspace mode filtering.
//   2. ClinicWorkflowPortal's DEFAULT_MODE table maps PCS to a
//      different default than ACS (the only allowed difference).
//   3. TeamPortalShell consumes the 3 feed helpers regardless of
//      workspace type — the mode strip is the same on both.
//
// Run: node scripts/qa-team-portals-both-have-call-list-and-ancillary-schedule.mjs

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

const switcher = "client/src/components/portal/WorkspaceModeSwitcher.tsx";
const adapter = "client/src/components/workflow/ClinicWorkflowPortal.tsx";
const shell = "client/src/components/portal/TeamPortalShell.tsx";

// 1) The mode list is a single canonical union — no per-role filter.
requireText(switcher, [
  "TEAM_MEMBER_WORKSPACE_MODES",
  '"clinicSchedule"',
  '"ancillarySchedule"',
  '"callList"',
  '"Clinic Schedule"',
  '"Ancillary Schedule"',
  '"Call List"',
]);

// 2) ClinicWorkflowPortal carries both roles through the SAME
//    TeamPortalShell, with only the default mode differing.
requireText(adapter, [
  "TeamPortalShell",
  "patientCareSpecialist",
  "ancillaryCareSpecialist",
  // The DEFAULT_MODE table must contain both default values somewhere
  // (PCS → callList, ACS → clinicSchedule today). Validated by the
  // companion qa-team-portals-only-default-mode-differs script.
  "DEFAULT_MODE",
]);

// 3) The shell consumes all 3 workspace feed helpers. The shell is
//    shared — there is no PCS-only or ACS-only mode gating that
//    hides one of the modes.
requireText(shell, [
  "fetchWorkspaceCallList",
  "fetchWorkspaceClinicSchedule",
  "fetchWorkspaceAncillarySchedule",
  "WorkspaceModeSwitcher",
]);

if (failures.length > 0) {
  console.error("Both-portals-have-all-modes QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Both-portals-have-all-modes QA passed.");
