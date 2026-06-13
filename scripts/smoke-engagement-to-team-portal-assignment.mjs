// Smoke — End-to-end shape check for the Engagement → Team Portal
// feed wiring.
//
// This is a static smoke (no server boot). It walks the chain by
// reading the actual source files and verifying the integer
// scheduler.id flows unbroken:
//
//   1. Engagement writes: assignedTeamMemberId = newScheduler.id
//   2. Schema column: integer
//   3. Repository filter type: number
//   4. Scope helper returns: number | null with locked: boolean
//   5. Route applies: filters.assignedTeamMemberId = scope.schedulerId ?? -1
//   6. Client helper forwards: workspace context "pcs"|"acs"
//   7. Shell computes workspace context from workspaceRole
//
// Each step is a one-grep assertion. Any single break here means
// Anthony / Callista's Engagement assignments will fail to surface
// in their workspace right panel.
//
// Run: node scripts/smoke-engagement-to-team-portal-assignment.mjs

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fails = [];
const passes = [];

function check(label, file, predicate) {
  const src = fs.readFileSync(path.join(root, file), "utf8");
  if (predicate(src)) passes.push(label);
  else fails.push(`${label} — not satisfied in ${file}`);
}

check(
  "1. Engagement writes scheduler.id (integer) as assignedTeamMemberId",
  "server/routes/engagementAssignmentBoard.ts",
  (s) => s.includes("assignedTeamMemberId: newScheduler.id"),
);

check(
  "2. patient_execution_cases.assignedTeamMemberId schema is integer",
  "shared/schema/executionCase.ts",
  (s) => /assignedTeamMemberId:\s*integer\("assigned_team_member_id"\)/.test(s),
);

check(
  "3. Repository filter types assignedTeamMemberId as number",
  "server/repositories/executionCase.repo.ts",
  (s) => s.includes("assignedTeamMemberId?: number"),
);

check(
  "4a. Scope helper exists",
  "server/services/teamMemberScope.ts",
  (s) => s.includes("export async function resolveCallListAssignmentScope"),
);
check(
  "4b. Scope helper returns schedulerId: number | null + locked: boolean",
  "server/services/teamMemberScope.ts",
  (s) => /schedulerId:\s*number\s*\|\s*null/.test(s) && /locked:\s*boolean/.test(s),
);

check(
  "5. Call-list route applies locked scope (with -1 impossible fallback)",
  "server/routes/executionCases.ts",
  (s) => /filters\.assignedTeamMemberId = assignmentScope\.schedulerId \?\? -1/.test(s),
);

check(
  "6. Client helper forwards workspace param to /api/scheduler-portal/cases",
  "client/src/lib/workflow/teamMemberWorkspaceApi.ts",
  (s) => s.includes('appendIf(qs, "workspace", params.workspace)'),
);

check(
  "7. Shell computes workspaceCallListContext from workspaceRole",
  "client/src/components/portal/TeamPortalShell.tsx",
  (s) =>
    s.includes("workspaceCallListContext") &&
    /workspaceRole === "patientCareSpecialist"[\s\S]*?\?\s*"pcs"/.test(s) &&
    /workspaceRole === "ancillaryCareSpecialist"[\s\S]*?\|\|\s*workspaceRole === "technician"[\s\S]*?\?\s*"acs"/.test(s),
);

check(
  "8. Center canvas mounts Patient Directory facts card",
  "client/src/components/portal/PatientCommandCanvas.tsx",
  (s) => s.includes("<PatientDirectoryFactsCard patientScreeningId={patientScreeningId}"),
);

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of fails) console.log(`FAIL  ${f}`);
if (fails.length > 0) {
  console.error(`Smoke failed: ${fails.length} step(s) broken`);
  process.exit(1);
}
console.log("Smoke passed: Engagement → Team Portal chain intact.");
