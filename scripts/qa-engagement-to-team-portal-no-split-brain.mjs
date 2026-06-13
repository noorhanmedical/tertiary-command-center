// QA — No "split brain" between the Engagement write side and the
// PCS / ACS read side of patient_execution_cases.assignedTeamMemberId.
//
// Both sides must agree:
//   - Writer (Engagement Center): writes outreach_schedulers.id (integer)
//     into patient_execution_cases.assignedTeamMemberId.
//   - Reader (PCS/ACS feed): narrows by patient_execution_cases.assignedTeamMemberId
//     using the SAME outreach_schedulers.id integer.
//
// If a future refactor switched the writer to users.id (UUID) without
// updating the schema, the column would now hold mixed types — this
// QA catches that by asserting BOTH the writer and the reader agree
// on the integer-scheduler.id semantics, AND that the schema column
// is integer (not varchar / uuid).
//
// Run: node scripts/qa-engagement-to-team-portal-no-split-brain.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const schema = fs.readFileSync(
  path.join(root, "shared/schema/executionCase.ts"),
  "utf8",
);
if (!/assignedTeamMemberId:\s*integer\("assigned_team_member_id"\)/.test(schema)) {
  failures.push("patient_execution_cases.assignedTeamMemberId must remain integer — switching to varchar/uuid would break the writer / reader contract");
}

const engage = fs.readFileSync(
  path.join(root, "server/routes/engagementAssignmentBoard.ts"),
  "utf8",
);
if (!engage.includes("assignedTeamMemberId: newScheduler.id")) {
  failures.push("Engagement writer must continue to set assignedTeamMemberId = newScheduler.id (integer)");
}

const repo = fs.readFileSync(
  path.join(root, "server/repositories/executionCase.repo.ts"),
  "utf8",
);
if (!repo.includes("assignedTeamMemberId?: number")) {
  failures.push("listSchedulerPortalCases filter must type assignedTeamMemberId as number — never string");
}

const scope = fs.readFileSync(
  path.join(root, "server/services/teamMemberScope.ts"),
  "utf8",
);
if (!/schedulerId:\s*number\s*\|\s*null/.test(scope)) {
  failures.push("resolveCallListAssignmentScope must return schedulerId as number | null — the same integer the writer used");
}

if (failures.length > 0) {
  console.error("Engagement→Portal no-split-brain QA failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("Engagement→Portal no-split-brain QA passed.");
