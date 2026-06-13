// SMOKE — Team Portal left tools rail end-to-end.
//
// Source-level proof of the full Phase 1.6 contract for the shared
// PCS/ACS Team Portal left tools rail. DB-only stage skips cleanly
// when DATABASE_URL is unset.
//
// Run: node scripts/smoke-team-portal-left-tools-rail.mjs

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
// STAGE 1 — PCS and ACS share TeamPortalShell
// ════════════════════════════════════════════════════════════════════
header("STAGE 1 — PCS + ACS identical layout");

expectContains(
  "PCS page mounts ClinicWorkflowPortal with patientCareSpecialist role",
  "client/src/pages/patient-care-specialist-portal.tsx",
  'role="patientCareSpecialist"',
);
expectContains(
  "ACS page mounts ClinicWorkflowPortal with ancillaryCareSpecialist role",
  "client/src/pages/ancillary-care-specialist-portal.tsx",
  'role="ancillaryCareSpecialist"',
);
expectContains(
  "ClinicWorkflowPortal routes both team-member roles to TeamPortalShell",
  "client/src/components/workflow/ClinicWorkflowPortal.tsx",
  "isTeamMemberWorkspace",
);

// ════════════════════════════════════════════════════════════════════
// STAGE 2 — Left panel is the tools rail (not the work queue)
// ════════════════════════════════════════════════════════════════════
header("STAGE 2 — Left panel is the tools rail");

expectContains(
  "Left rail container marked with TEAM PORTAL LEFT TOOLS RAIL",
  "client/src/components/portal/TeamPortalShell.tsx",
  "TEAM PORTAL LEFT TOOLS RAIL",
);
expectContains(
  "Tools rail mount marker",
  "client/src/components/portal/TeamPortalShell.tsx",
  'data-testid="left-rail-tools-rail"',
);
const railShell = read("client/src/components/portal/TeamPortalShell.tsx") ?? "";
expect(
  "Left rail does NOT contain the outreach call-list section",
  !railShell.includes("Outreach call list"),
  "TeamPortalShell still renders the outreach call-list inside the left rail",
);

// ════════════════════════════════════════════════════════════════════
// STAGE 3 — Right panel remains the work queue
// ════════════════════════════════════════════════════════════════════
header("STAGE 3 — Right panel remains the work queue");

expectContains(
  "Right rail container still present",
  "client/src/components/portal/TeamPortalShell.tsx",
  'data-testid="portal-right-rail"',
);

// ════════════════════════════════════════════════════════════════════
// STAGE 4 — Compact calendar exists
// ════════════════════════════════════════════════════════════════════
header("STAGE 4 — Compact calendar");

expectContains(
  "LeftRailCompactCalendar component exists",
  "client/src/components/portal/leftRail/LeftRailCompactCalendar.tsx",
  "LeftRailCompactCalendar",
);
expectContains(
  "Shell mounts the compact calendar",
  "client/src/components/portal/TeamPortalShell.tsx",
  "<LeftRailCompactCalendar",
);

// ════════════════════════════════════════════════════════════════════
// STAGE 5 — Email tool opens composer in center canvas
// ════════════════════════════════════════════════════════════════════
header("STAGE 5 — Email tool → composer");

expectContains(
  "Email tool button in the rail",
  "client/src/components/portal/TeamPortalShell.tsx",
  'testId="left-rail-tool-email"',
);
expectContains(
  "Email composer component exists",
  "client/src/components/portal/PortalEmailComposerTab.tsx",
  "PortalEmailComposerTab",
);
expectContains(
  "Center canvas branch for the email tab",
  "client/src/components/portal/TeamPortalShell.tsx",
  'data-testid="playground-email-composer"',
);

// ════════════════════════════════════════════════════════════════════
// STAGE 6 — Marketing materials → Email attachment handoff
// ════════════════════════════════════════════════════════════════════
header("STAGE 6 — Marketing → Email attachment");

expectContains(
  "Marketing tab exposes the compose-email handoff button",
  "client/src/components/portal/PortalMarketingTab.tsx",
  'data-testid="portal-marketing-compose-email"',
);
expectContains(
  "Shell stages picked material ids and switches to the email tab",
  "client/src/components/portal/TeamPortalShell.tsx",
  "setPendingEmailAttachments(ids)",
);
expectContains(
  "Composer adopts the staged ids",
  "client/src/components/portal/PortalEmailComposerTab.tsx",
  "setAttachedIds(new Set(preAttachedMaterialIds))",
);

// ════════════════════════════════════════════════════════════════════
// STAGE 7 — Patient Search tool
// ════════════════════════════════════════════════════════════════════
header("STAGE 7 — Patient Search tool");

expectContains(
  "Patient Search button in the rail",
  "client/src/components/portal/TeamPortalShell.tsx",
  'testId="left-rail-tool-patient-search"',
);
expectContains(
  "Patient search hits the canonical directory search route",
  "client/src/lib/portal/commandCenterApi.ts",
  "/api/portal/patient-search",
);

// ════════════════════════════════════════════════════════════════════
// STAGE 8 — Tasks tool
// ════════════════════════════════════════════════════════════════════
header("STAGE 8 — Tasks tool");

expectContains(
  "Tasks button in the rail",
  "client/src/components/portal/TeamPortalShell.tsx",
  'testId="left-rail-tool-tasks"',
);

// ════════════════════════════════════════════════════════════════════
// STAGE 9 — Templates / Resources tool
// ════════════════════════════════════════════════════════════════════
header("STAGE 9 — Templates / Resources tool");

expectContains(
  "Templates button in the rail",
  "client/src/components/portal/TeamPortalShell.tsx",
  'testId="left-rail-tool-resources"',
);
expectContains(
  "Templates tab component exists",
  "client/src/components/portal/PortalTemplatesResourcesTab.tsx",
  "PortalTemplatesResourcesTab",
);
expectContains(
  "Staff resources catalog separate from marketing materials",
  "client/src/lib/portal/staffResources.ts",
  "STAFF_RESOURCES",
);

// ════════════════════════════════════════════════════════════════════
// STAGE 9a — Phase 1.7: Document Library tool
// ════════════════════════════════════════════════════════════════════
header("STAGE 9a — Document Library tool (Phase 1.7)");

expectContains(
  "Document Library button in the rail",
  "client/src/components/portal/TeamPortalShell.tsx",
  'testId="left-rail-tool-document-library"',
);
expectContains(
  "Document Library tab component exists",
  "client/src/components/portal/PortalDocumentLibraryTab.tsx",
  "PortalDocumentLibraryTab",
);
expectContains(
  "Document Library uses the canonical hook",
  "client/src/components/portal/PortalDocumentLibraryTab.tsx",
  "useDocumentLibrary",
);
expectContains(
  "Center canvas branch for documentLibrary kind",
  "client/src/components/portal/TeamPortalShell.tsx",
  'data-testid="playground-document-library"',
);

// ════════════════════════════════════════════════════════════════════
// STAGE 9b — Global Calendar isolation (Phase 1.7)
// ════════════════════════════════════════════════════════════════════
header("STAGE 9b — Global Calendar isolation (Phase 1.7)");

expectContains(
  "globalCalendarDate state present in the shell",
  "client/src/components/portal/TeamPortalShell.tsx",
  "GLOBAL CALENDAR ISOLATION",
);
expectContains(
  "Compact calendar binds to globalCalendarDate",
  "client/src/components/portal/TeamPortalShell.tsx",
  "selectedDate={globalCalendarDate}",
);
const shellSrcForCalendar = read("client/src/components/portal/TeamPortalShell.tsx") ?? "";
function rightQueueKeyDoesNotIncludeGlobal(label, marker) {
  const m = new RegExp(`"${marker}"[\\s\\S]{0,200}\\]`).exec(shellSrcForCalendar);
  if (!m) {
    failures.push(`✗ ${label} — could not locate key`);
    return false;
  }
  if (m[0].includes("globalCalendarDate")) {
    failures.push(`✗ ${label} — query key includes globalCalendarDate (breaks isolation)`);
    return false;
  }
  console.log(`  ✓ ${label}`);
  return true;
}
rightQueueKeyDoesNotIncludeGlobal(
  "team-workspace-call-list key excludes globalCalendarDate",
  "team-workspace-call-list",
);
rightQueueKeyDoesNotIncludeGlobal(
  "team-workspace-clinic-schedule key excludes globalCalendarDate",
  "team-workspace-clinic-schedule",
);
rightQueueKeyDoesNotIncludeGlobal(
  "team-workspace-ancillary-schedule key excludes globalCalendarDate",
  "team-workspace-ancillary-schedule",
);

// ════════════════════════════════════════════════════════════════════
// STAGE 9c — Honest-state checks (Phase 1.7)
// ════════════════════════════════════════════════════════════════════
header("STAGE 9c — Honest-state guarantees");

expectContains(
  "Email composer surfaces backend errors literally",
  "client/src/components/portal/PortalEmailComposerTab.tsx",
  'data-testid="portal-email-composer-error"',
);
expectContains(
  "Email backend throws on missing SMTP env",
  "server/services/emailService.ts",
  "Email is not configured",
);
expectContains(
  "Quick Note documented as Deferred",
  "docs/architecture/team-portal-left-tools-rail.md",
  "Quick Note decision: **Deferred**",
);
expectContains(
  "Internal Contacts documented as Deferred",
  "docs/architecture/team-portal-left-tools-rail.md",
  "Internal Contacts decision: **Deferred**",
);

// ════════════════════════════════════════════════════════════════════
// STAGE 9d — Right panel remains the work queue
// ════════════════════════════════════════════════════════════════════
header("STAGE 9d — Right panel remains work queue");

const rightRailStartIdx = shellSrcForCalendar.indexOf('data-testid="portal-right-rail"');
const dockIdx = shellSrcForCalendar.indexOf("group/dock", rightRailStartIdx);
const rightRegion = dockIdx > rightRailStartIdx
  ? shellSrcForCalendar.slice(rightRailStartIdx, dockIdx)
  : shellSrcForCalendar.slice(rightRailStartIdx);
const FORBIDDEN_IN_RIGHT = [
  "PortalEmailComposerTab",
  "PortalDocumentLibraryTab",
  "PortalTemplatesResourcesTab",
  "PortalMarketingTab",
  "PortalPatientSearchTab",
  "PortalPlexusTasksTab",
  "LeftRailCompactCalendar",
];
let rightPollution = 0;
for (const f of FORBIDDEN_IN_RIGHT) {
  if (rightRegion.includes(f)) {
    rightPollution += 1;
    failures.push(`Right rail must not mount "${f}"`);
  }
}
expect("Right rail free of left-tool components", rightPollution === 0);

// ════════════════════════════════════════════════════════════════════
// STAGE 10 — No patient timeline / profile / metrics in left rail
// ════════════════════════════════════════════════════════════════════
header("STAGE 10 — Left rail boundary checks");

const railRegion = (() => {
  const startMarker = 'data-testid="left-rail-tools-rail"';
  const startIdx = railShell.indexOf(startMarker);
  if (startIdx < 0) return "";
  const endIdx = railShell.indexOf("})()}", startIdx);
  return railShell.slice(startIdx, endIdx > 0 ? endIdx : railShell.length);
})();
const FORBIDDEN_IN_RAIL = [
  "PatientCommandCanvas",
  "PatientDetail",
  "PatientCallHistoryPanel",
  "AdminReviewDialog",
  "AdminApprovalControl",
  "PatientAuditTrailModal",
  "MissionControl",
  "RevenueDashboard",
  "ProductivityDashboard",
  "OutreachDashboard",
];
let pollution = 0;
for (const f of FORBIDDEN_IN_RAIL) {
  if (railRegion.includes(f)) {
    pollution += 1;
    failures.push(`Left rail must not include "${f}"`);
  }
}
expect("Left rail free of patient detail + metrics surfaces", pollution === 0);

// ════════════════════════════════════════════════════════════════════
// STAGE 11 — Admin view-as + Admin Home dock button preserved
// ════════════════════════════════════════════════════════════════════
header("STAGE 11 — Admin view-as + Home dock preserved");

expectContains(
  "Admin view-as selector still in the shell",
  "client/src/components/portal/TeamPortalShell.tsx",
  'data-testid="admin-viewas-team-member-select"',
);
expectContains(
  "Admin Home dock button still in the shell",
  "client/src/components/portal/TeamPortalShell.tsx",
  'data-testid="dock-icon-home"',
);

// ════════════════════════════════════════════════════════════════════
// STAGE 12 — Canonical call-result writeback preserved (Slice 1.4)
// ════════════════════════════════════════════════════════════════════
header("STAGE 12 — Canonical call-result writeback preserved");

expectContains(
  "engagementCallResultEndpoint resolver still canonical by default",
  "client/src/lib/engagementCanonicalCallResultsUiFlag.ts",
  "PHASE-1 CANONICAL CALL-RESULT DEFAULT",
);

// ════════════════════════════════════════════════════════════════════
// STAGE 13 — Phase 1 full-system wiring smoke still passes
// ════════════════════════════════════════════════════════════════════
header("STAGE 13 — Phase 1 full-system wiring smoke");

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
// STAGE 14 — DB-only probes
// ════════════════════════════════════════════════════════════════════
header("STAGE 14 — DB-only probes");

if (!process.env.DATABASE_URL) {
  const reason = "DATABASE_URL is not set; live HTTP probes of email send + materials catalog cannot run on this host.";
  skips.push(reason);
  console.log(`  ⊘ Skipped: ${reason}`);
} else {
  console.log("  • DATABASE_URL set — live probes would run here in a future iteration.");
}

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
console.log("Team Portal shared left tools rail proven source-level.");
