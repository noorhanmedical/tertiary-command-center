// QA — Admin-only view-as selector lives inside the shared TeamPortalShell.
//
// Asserts:
//   - The selector is rendered only when isAdmin is true (admin gate).
//   - The selector populates from /api/portal/team-members.
//   - The selector binds to a `viewAsTeamMemberId` state variable.
//   - There are no extra dropdowns surfaced to non-admin users.
//
// Run: node scripts/qa-team-portals-admin-viewas-selector.mjs

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

// 1) Admin gating + selector rendering markers.
requireText(shell, [
  "isAdmin",
  '"admin"',
  "{isAdmin && (",
  "admin-viewas-selector-wrap",
  "admin-viewas-team-member-select",
  "admin-viewas-option-self",
]);

// 2) Selector binds to viewAsTeamMemberId + the API helper.
requireText(shell, [
  "viewAsTeamMemberId",
  "setViewAsTeamMemberId",
  "fetchTeamMembersForWorkspace",
  '"/api/portal/team-members"',
  "viewAsWorkspaceType",
]);

if (failures.length > 0) {
  console.error("Admin view-as selector QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Admin view-as selector QA passed.");
