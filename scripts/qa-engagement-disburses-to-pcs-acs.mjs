// QA — Engagement Center is the assignment / disbursement surface.
//
// Engagement Center receives Admin Review approved patients and
// disburses them to PCS / ACS team members. It is NOT a working
// portal — actual call work happens in PCS Workspace, ancillary work
// in ACS Workspace.
//
// Asserts:
//   1. /engagement-center mounts EngagementCenterPage with the
//      EngagementAssignmentBoard component (the assignment surface).
//   2. EngagementAssignmentBoard is fed by the canonical
//      /api/engagement/assignment-board route.
//   3. The Engagement Center route is NOT listed as a Team Portal
//      execution tile.
//
// Run: node scripts/qa-engagement-disburses-to-pcs-acs.mjs

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

const engagementPage = "client/src/pages/engagement-center.tsx";
const assignmentBoard = "client/src/components/engagement/EngagementAssignmentBoard.tsx";
const tile = "client/src/pages/team-member-portals.tsx";
const app = "client/src/App.tsx";

// 1) Engagement Center page renders the EngagementAssignmentBoard.
requireText(engagementPage, [
  "EngagementCenterPage",
  "EngagementAssignmentBoard",
  // Eyebrow text (no surrounding quotes — the source is JSX, not a
  // string literal).
  "PLEXUS ANCILLARY · ENGAGEMENT CENTER",
]);

// 2) AssignmentBoard wired to canonical assignment-board route.
requireText(assignmentBoard, [
  "/api/engagement/assignment-board",
]);

// 3) Team Member Portals landing must not list Engagement Center as a
//    tile. Engagement is a manager-level disburse-to-PCS/ACS surface,
//    not an execution portal.
requireNotText(
  tile,
  [
    '"/engagement-center"',
    'card-engagement-center',
  ],
  "Team Member Portals landing must not list Engagement Center as an execution tile",
);

// 4) /engagement-center route exists and resolves to the assignment
//    surface.
requireText(app, [
  '<EngagementCenterPage />',
]);

if (failures.length > 0) {
  console.error("Engagement-disburses-to-PCS-ACS QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement-disburses-to-PCS-ACS QA passed.");
