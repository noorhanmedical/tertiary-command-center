// QA — The ACS workspace right-panel call list must respect the
// SAME assignedTeamMemberId narrowing as PCS. The only difference
// is the workspace=acs context tag (which gates admin view-as
// role-compat to technician-role users instead of liaison).
//
// Run: node scripts/qa-engagement-assignment-feeds-acs-right-panel.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const shell = fs.readFileSync(
  path.join(root, "client/src/components/portal/TeamPortalShell.tsx"),
  "utf8",
);
if (!/workspaceRole === "ancillaryCareSpecialist"[\s\S]*?\|\|\s*workspaceRole === "technician"[\s\S]*?\?\s*"acs"/.test(shell)) {
  failures.push("TeamPortalShell must map ancillaryCareSpecialist (and legacy technician) to workspace=acs");
}

const exec = fs.readFileSync(
  path.join(root, "server/routes/executionCases.ts"),
  "utf8",
);
// The call-list endpoint should treat "acs" as a valid workspace
// hint (whitelisting both pcs and acs).
if (!/q\.workspace === "acs"[\s\S]*?\|\|\s*q\.workspace === "pcs"/.test(exec)) {
  failures.push("executionCases.ts must whitelist both workspace=pcs and workspace=acs on the call-list endpoint");
}

// resolveAdminViewAsUserId enforces role compat when workspace is
// supplied — re-asserted here so a future refactor doesn't regress.
const portal = fs.readFileSync(
  path.join(root, "server/routes/portal.ts"),
  "utf8",
);
if (!portal.includes('VIEWAS_WORKSPACE_TO_ROLE')) {
  failures.push("portal.ts must define VIEWAS_WORKSPACE_TO_ROLE so workspace=acs maps to technician-role view-as");
}
if (!portal.includes('acs: "technician"')) {
  failures.push("VIEWAS_WORKSPACE_TO_ROLE must map acs → technician");
}

if (failures.length > 0) {
  console.error("Engagement→ACS feed QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement→ACS feed QA passed.");
