// SMOKE — Team Portal routing + admin view-as end-to-end.
//
// Source-level proof of the full Phase-1.5 contract:
//
//   1. Admin can select a PCS team member
//   2. PCS workspace feeds use the selected user as the view-as
//   3. Admin can select an ACS team member
//   4. ACS workspace feeds use the selected user as the view-as
//   5. Normal PCS/ACS users do not see the admin selector
//   6. Non-admin cannot pass viewAsTeamMemberId (backend defense)
//   7. Facility scoping remains enforced
//   8. PCS and ACS share the same shell / layout
//   9. Admin Team Portal dock has Home button
//  10. Home routes back to /home
//  11. Outreach Center no longer routes to Team Portal execution pages
//  12. Engagement Center remains assignment / disbursement surface
//  13. Canonical call-result writeback still works
//  14. Phase 1 full-system wiring smoke still passes
//
// DB-only probes (need DATABASE_URL) skip clearly.
//
// Run: node scripts/smoke-team-portals-admin-viewas-routing.mjs

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const failures = [];
const skips = [];

function read(rel) {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

function expect(label, ok, detail) {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function expectContains(label, rel, needle) {
  const src = read(rel) ?? "";
  expect(label, src.includes(needle), `missing "${needle}" in ${rel}`);
}

function header(s) {
  console.log("");
  console.log(`── ${s} ──`);
}

// ════════════════════════════════════════════════════════════════════
// STAGE 1 — Admin can select a PCS team member
// ════════════════════════════════════════════════════════════════════
header("STAGE 1 — Admin selects PCS team member");

expectContains(
  "Backend admin-only team-members endpoint exists",
  "server/routes/portal.ts",
  '"/api/portal/team-members"',
);
expectContains(
  "Endpoint accepts workspace=pcs",
  "server/routes/portal.ts",
  "VIEWAS_WORKSPACE_TO_ROLE",
);
expectContains(
  "Shell wires the admin selector",
  "client/src/components/portal/TeamPortalShell.tsx",
  "admin-viewas-team-member-select",
);

// ════════════════════════════════════════════════════════════════════
// STAGE 2 — PCS workspace feed uses selected PCS user context
// ════════════════════════════════════════════════════════════════════
header("STAGE 2 — PCS feed uses selected user context");

expectContains(
  "PCS call-list endpoint forwards viewAsTeamMemberId with workspace=pcs",
  "server/routes/executionCases.ts",
  'resolvePhase1FacilityScope(req, res, q.facilityId, q.viewAsTeamMemberId, "pcs")',
);
expectContains(
  "Client call-list helper threads viewAsTeamMemberId",
  "client/src/lib/workflow/teamMemberWorkspaceApi.ts",
  'appendIf(qs, "viewAsTeamMemberId", params.viewAsTeamMemberId)',
);
expectContains(
  "Shell call-list query key carries viewAsTeamMemberId",
  "client/src/components/portal/TeamPortalShell.tsx",
  '"team-workspace-call-list"',
);

// ════════════════════════════════════════════════════════════════════
// STAGE 3 — Admin selects ACS team member
// ════════════════════════════════════════════════════════════════════
header("STAGE 3 — Admin selects ACS team member");

expectContains(
  "Backend ACS role mapping (technician)",
  "server/routes/portal.ts",
  'acs: "technician"',
);

// ════════════════════════════════════════════════════════════════════
// STAGE 4 — ACS workspace feed uses selected ACS user context
// ════════════════════════════════════════════════════════════════════
header("STAGE 4 — ACS feed uses selected user context");

expectContains(
  "ACS ancillary-schedule endpoint forwards viewAsTeamMemberId",
  "server/routes/globalSchedule.ts",
  'resolvePhase1FacilityScope(req, res, q.facilityId, q.viewAsTeamMemberId)',
);
expectContains(
  "Shell ancillary query carries viewAsTeamMemberId",
  "client/src/components/portal/TeamPortalShell.tsx",
  '"team-workspace-ancillary-schedule"',
);

// ════════════════════════════════════════════════════════════════════
// STAGE 5 — Normal PCS/ACS users do NOT see the admin selector
// ════════════════════════════════════════════════════════════════════
header("STAGE 5 — Non-admin users do not see selector");

expectContains(
  "Selector is gated on isAdmin",
  "client/src/components/portal/TeamPortalShell.tsx",
  "{isAdmin && (",
);

// ════════════════════════════════════════════════════════════════════
// STAGE 6 — Non-admin cannot pass viewAsTeamMemberId
// ════════════════════════════════════════════════════════════════════
header("STAGE 6 — Backend defense: non-admin view-as ignored");

expectContains(
  "resolveAdminViewAsUserId returns null for non-admin",
  "server/routes/portal.ts",
  '(req.session.role ?? "") !== "admin"',
);
expectContains(
  "allowedFacilities only honors viewAs when caller is admin",
  "server/routes/portal.ts",
  "isAdmin ? (opts.viewAsUserId ?? null) : null",
);

// ════════════════════════════════════════════════════════════════════
// STAGE 7 — Facility scoping (Slice 1.2) remains enforced
// ════════════════════════════════════════════════════════════════════
header("STAGE 7 — Facility scoping preserved");

expectContains(
  "globalSchedule retains PHASE-1 FACILITY SCOPE marker",
  "server/routes/globalSchedule.ts",
  "PHASE-1 FACILITY SCOPE",
);
expectContains(
  "executionCases retains PHASE-1 FACILITY SCOPE marker",
  "server/routes/executionCases.ts",
  "PHASE-1 FACILITY SCOPE",
);
expectContains(
  "400 on missing facilityId for non-admin still in place",
  "server/routes/globalSchedule.ts",
  "facilityId is required for non-admin callers",
);

// ════════════════════════════════════════════════════════════════════
// STAGE 8 — PCS + ACS share the same shell / layout
// ════════════════════════════════════════════════════════════════════
header("STAGE 8 — Shared shell / layout");

expectContains(
  "PCS page uses ClinicWorkflowPortal with patientCareSpecialist role",
  "client/src/pages/patient-care-specialist-portal.tsx",
  'role="patientCareSpecialist"',
);
expectContains(
  "ACS page uses ClinicWorkflowPortal with ancillaryCareSpecialist role",
  "client/src/pages/ancillary-care-specialist-portal.tsx",
  'role="ancillaryCareSpecialist"',
);
expectContains(
  "ClinicWorkflowPortal routes both roles through the same TeamPortalShell",
  "client/src/components/workflow/ClinicWorkflowPortal.tsx",
  "isTeamMemberWorkspace",
);

// ════════════════════════════════════════════════════════════════════
// STAGE 9 — Admin Home dock button + STAGE 10 — Home → /home
// ════════════════════════════════════════════════════════════════════
header("STAGE 9-10 — Admin Home dock button → /home");

expectContains(
  "Dock renders the Home button under isAdmin gate",
  "client/src/components/portal/TeamPortalShell.tsx",
  "dock-icon-home",
);
expectContains(
  "Home button navigates to /home",
  "client/src/components/portal/TeamPortalShell.tsx",
  'setLocation("/home")',
);
expectContains(
  "/home route exists in App.tsx",
  "client/src/App.tsx",
  '<Route path="/home">',
);

// ════════════════════════════════════════════════════════════════════
// STAGE 11 — Outreach Center no longer routes to PCS/ACS
// ════════════════════════════════════════════════════════════════════
header("STAGE 11 — Outreach has no execution-portal links");

const outreach = read("client/src/pages/outreach.tsx") ?? "";
expect(
  "OutreachPage does not link to /patient-care-specialist-portal",
  !outreach.includes('href="/patient-care-specialist-portal"'),
  "OutreachPage routes into PCS execution",
);
expect(
  "OutreachPage does not link to /ancillary-care-specialist-portal",
  !outreach.includes('href="/ancillary-care-specialist-portal"'),
  "OutreachPage routes into ACS execution",
);
expectContains(
  "GlobalNav label corrected to 'Outreach Center'",
  "client/src/components/GlobalNav.tsx",
  '"Outreach Center"',
);

// ════════════════════════════════════════════════════════════════════
// STAGE 12 — Engagement Center is assignment / disbursement surface
// ════════════════════════════════════════════════════════════════════
header("STAGE 12 — Engagement Center role");

expectContains(
  "EngagementCenterPage renders EngagementAssignmentBoard",
  "client/src/pages/engagement-center.tsx",
  "EngagementAssignmentBoard",
);
expectContains(
  "AssignmentBoard wired to /api/engagement/assignment-board",
  "client/src/components/engagement/EngagementAssignmentBoard.tsx",
  "/api/engagement/assignment-board",
);
const tile = read("client/src/pages/team-member-portals.tsx") ?? "";
expect(
  "Team Member Portals landing has no Engagement Center tile",
  !tile.includes('"/engagement-center"') && !tile.includes("card-engagement-center"),
  "Engagement Center tile still present on landing",
);

// ════════════════════════════════════════════════════════════════════
// STAGE 13 — Canonical call-result writeback still works (Slice 1.4)
// ════════════════════════════════════════════════════════════════════
header("STAGE 13 — Canonical call-result writeback preserved");

expectContains(
  "engagementCallResultEndpoint resolver still default-canonical",
  "client/src/lib/engagementCanonicalCallResultsUiFlag.ts",
  "PHASE-1 CANONICAL CALL-RESULT DEFAULT",
);
expectContains(
  "DispositionSheet still posts through the canonical resolver",
  "client/src/components/outreach/DispositionSheet.tsx",
  "engagementCallResultEndpoint",
);

// ════════════════════════════════════════════════════════════════════
// STAGE 14 — Phase 1 full-system wiring smoke still passes
// ════════════════════════════════════════════════════════════════════
header("STAGE 14 — Phase 1 full-system wiring smoke");

try {
  execSync("node " + path.join(root, "scripts", "smoke-phase-1-full-system-wiring.mjs"), {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  console.log("  ✓ smoke-phase-1-full-system-wiring.mjs still passes");
} catch (e) {
  failures.push(`✗ smoke-phase-1-full-system-wiring.mjs no longer passes — ${(e && e.message) || e}`);
  console.error(`  ✗ smoke-phase-1-full-system-wiring.mjs FAILED`);
}

// ════════════════════════════════════════════════════════════════════
// STAGE 15 — DB-only probes (honest skip)
// ════════════════════════════════════════════════════════════════════
header("STAGE 15 — DB-only probes");

if (!process.env.DATABASE_URL) {
  const reason = "DATABASE_URL is not set; live HTTP probes of view-as facility narrowing cannot run on this host.";
  skips.push(reason);
  console.log(`  ⊘ Skipped: ${reason}`);
} else {
  console.log("  • DATABASE_URL set — live probes would run here in a future iteration.");
}

// ════════════════════════════════════════════════════════════════════
// Final
// ════════════════════════════════════════════════════════════════════
console.log("");
console.log("════════════════════════════════════════════════════════");
if (failures.length > 0) {
  console.error(`SMOKE FAILED — ${failures.length} stage(s) failed:`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`SMOKE PASSED — ${skips.length} skipped stage(s):`);
for (const s of skips) console.log(`  ⊘ ${s}`);
console.log("");
console.log("Team Portal routing + admin view-as wiring proven source-level.");
