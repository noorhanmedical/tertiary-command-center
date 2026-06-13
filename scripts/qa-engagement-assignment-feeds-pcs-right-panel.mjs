// QA — Engagement Center assignment must feed the PCS workspace
// right-panel call list.
//
// We assert by reading the code path, not by spinning up a server:
//   1. /api/scheduler-portal/cases applies an assignedTeamMemberId
//      filter resolved via resolveCallListAssignmentScope.
//   2. The shell's fetchWorkspaceCallList query passes the workspace
//      context "pcs" when the workspace role is patientCareSpecialist
//      (or legacy liaison).
//   3. The shared resolveCallListAssignmentScope helper lives in
//      server/services/teamMemberScope.ts.
//   4. Engagement assignment continues to write to
//      patient_execution_cases.assignedTeamMemberId.
//
// Run: node scripts/qa-engagement-assignment-feeds-pcs-right-panel.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const exec = fs.readFileSync(
  path.join(root, "server/routes/executionCases.ts"),
  "utf8",
);
if (!exec.includes("resolveCallListAssignmentScope")) {
  failures.push("executionCases.ts must invoke resolveCallListAssignmentScope on /api/scheduler-portal/cases");
}
if (!exec.includes("assignmentScope.locked")) {
  failures.push("executionCases.ts must honor the locked flag from resolveCallListAssignmentScope");
}
if (!exec.includes("filters.assignedTeamMemberId = assignmentScope.schedulerId")) {
  failures.push("executionCases.ts must apply assignmentScope.schedulerId as the assignedTeamMemberId filter");
}

const helper = fs.readFileSync(
  path.join(root, "server/services/teamMemberScope.ts"),
  "utf8",
);
if (!helper.includes("export async function resolveCallListAssignmentScope")) {
  failures.push("server/services/teamMemberScope.ts must export resolveCallListAssignmentScope");
}
if (!helper.includes("outreach_schedulers") && !helper.includes("getOutreachSchedulers")) {
  failures.push("teamMemberScope.ts must resolve through outreach_schedulers (the integer scheduler.id bridge)");
}

const shell = fs.readFileSync(
  path.join(root, "client/src/components/portal/TeamPortalShell.tsx"),
  "utf8",
);
if (!shell.includes("workspaceCallListContext")) {
  failures.push("TeamPortalShell must compute workspaceCallListContext to pass to fetchWorkspaceCallList");
}
if (!/workspaceRole === "patientCareSpecialist"[\s\S]*?\?\s*"pcs"/.test(shell)) {
  failures.push("TeamPortalShell must map patientCareSpecialist (and legacy liaison) to workspace=pcs");
}

const api = fs.readFileSync(
  path.join(root, "client/src/lib/workflow/teamMemberWorkspaceApi.ts"),
  "utf8",
);
if (!api.includes('appendIf(qs, "workspace", params.workspace)')) {
  failures.push("teamMemberWorkspaceApi.fetchWorkspaceCallList must forward the workspace param to /api/scheduler-portal/cases");
}

// Engagement assignment write path remains unchanged.
const engage = fs.readFileSync(
  path.join(root, "server/routes/engagementAssignmentBoard.ts"),
  "utf8",
);
if (!engage.includes("assignedTeamMemberId: newScheduler.id")) {
  failures.push("Engagement assignment must continue to write assignedTeamMemberId = outreach_schedulers.id");
}

if (failures.length > 0) {
  console.error("Engagement→PCS feed QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement→PCS feed QA passed.");
