import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}

function requireFile(rel) {
  const content = read(rel);
  if (content === null) failures.push(`Missing file: ${rel}`);
  return content;
}

function requireText(rel, needles) {
  const content = read(rel);
  if (content === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (!content.includes(needle)) {
      failures.push(`Missing "${needle}" in ${rel}`);
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// 1. Support libs from Phase 2.
// ────────────────────────────────────────────────────────────────────

requireFile("client/src/lib/portal/portalCapabilities.ts");
requireFile("client/src/lib/portal/scheduleInvalidations.ts");
requireFile("client/src/lib/portal/commandCenterApi.ts");
requireFile("client/src/lib/workflow/teamMemberWorkspaceApi.ts");
requireFile("client/src/lib/workflow/teamMemberProfileApi.ts");
requireFile("shared/teamMemberProfile.ts");

requireText("client/src/lib/portal/portalCapabilities.ts", [
  "resolvePortalCapabilities",
]);

requireText("shared/teamMemberProfile.ts", [
  "TEAM_MEMBER_WORKSPACE_TYPES",
  '"patientCareSpecialist"',
  '"ancillaryCareSpecialist"',
]);

// ────────────────────────────────────────────────────────────────────
// 2. Workspace components from Phase 3.
// ────────────────────────────────────────────────────────────────────

requireFile("client/src/components/portal/PatientCommandCanvas.tsx");
requireFile("client/src/components/portal/PatientMiniCalendar.tsx");
requireFile("client/src/components/portal/SchedulePatientDialog.tsx");
requireFile("client/src/components/portal/SchedulePatientPlayground.tsx");
requireFile("client/src/components/portal/LogCommunicationDialog.tsx");
requireFile("client/src/components/portal/PortalMyPatientsTab.tsx");
requireFile("client/src/components/portal/PortalMarketingTab.tsx");
requireFile("client/src/components/portal/PortalPatientSearchTab.tsx");
requireFile("client/src/components/portal/PortalPlexusTasksTab.tsx");
requireFile("client/src/components/playground/PromoteToPlaygroundButton.tsx");
requireFile("client/src/lib/playground/panelPlaygroundContext.ts");

// ────────────────────────────────────────────────────────────────────
// 3. TeamPortalShell from Phase 4 — exists and consumes the expanded
//    components.
// ────────────────────────────────────────────────────────────────────

const teamShell = "client/src/components/portal/TeamPortalShell.tsx";
requireFile(teamShell);
requireText(teamShell, [
  "export function TeamPortalShell",
  "WorkspaceModeSwitcher",
  "PatientCommandCanvas",
  "PatientMiniCalendar",
  "SchedulePatientDialog",
  "SchedulePatientPlayground",
  "PortalMyPatientsTab",
  "PortalPatientSearchTab",
  "PortalMarketingTab",
  "PortalPlexusTasksTab",
  "CanonicalCommandCalendar",
  "resolvePortalCapabilities",
  "fetchTeamMemberProfile",
  "fetchWorkspaceCallList",
  "fetchWorkspaceClinicSchedule",
  "fetchWorkspaceAncillarySchedule",
]);

// ────────────────────────────────────────────────────────────────────
// 4. Legacy PortalShell still exists and is intentionally NOT the same
//    shell as TeamPortalShell. Technician / Liaison spine preserved.
// ────────────────────────────────────────────────────────────────────

const legacyShell = "client/src/components/portal/PortalShell.tsx";
requireFile(legacyShell);
requireText(legacyShell, ["export function PortalShell"]);

const legacyShellContent = read(legacyShell) ?? "";
if (legacyShellContent.includes("export function TeamPortalShell")) {
  failures.push(
    `Legacy PortalShell.tsx should not be renamed — TeamPortalShell must live in TeamPortalShell.tsx`,
  );
}

// ────────────────────────────────────────────────────────────────────
// 5. ClinicWorkflowPortal adapter routes PCS / ACS through
//    TeamPortalShell and routes technician / liaison through the
//    legacy PortalShell.
// ────────────────────────────────────────────────────────────────────

const workflowAdapter = "client/src/components/workflow/ClinicWorkflowPortal.tsx";
requireText(workflowAdapter, [
  "TeamPortalShell",
  "PortalShell",
  '"patientCareSpecialist"',
  '"ancillaryCareSpecialist"',
  '"technician"',
  '"liaison"',
  "INTERNAL_ROLE",
  "WORKSPACE_LABEL",
  "DEFAULT_MODE",
  "isTeamMemberWorkspace",
]);

// ────────────────────────────────────────────────────────────────────
// 6. PCS / ACS pages still mount through ClinicWorkflowPortal with
//    the new roles.
// ────────────────────────────────────────────────────────────────────

requireText("client/src/pages/patient-care-specialist-portal.tsx", [
  "ClinicWorkflowPortal",
  'role="patientCareSpecialist"',
]);

requireText("client/src/pages/ancillary-care-specialist-portal.tsx", [
  "ClinicWorkflowPortal",
  'role="ancillaryCareSpecialist"',
]);

// ────────────────────────────────────────────────────────────────────
// 7. App.tsx still mounts the four new routes from PR #7.
// ────────────────────────────────────────────────────────────────────

requireText("client/src/App.tsx", [
  "/team-member-portals",
  "/patient-care-specialist-portal",
  "/ancillary-care-specialist-portal",
  "/engagement-center",
  // Legacy spine must survive.
  "/plexus-iq",
  "/scheduler-portal",
  "/liaison-technician-portal",
]);

// ────────────────────────────────────────────────────────────────────
// 8. Plexus IQ canonical wiring untouched.
// ────────────────────────────────────────────────────────────────────

requireText("client/src/components/plexus-iq/PlexusIQAddPatientModal.tsx", [
  "VisitOutreachKindToggle",
  "@/features/command-center/tiles",
  'surface="plexusIq"',
  "defaultPatientType",
]);

requireText("client/src/components/plexus-iq/PlexusIQAddPatientHub.tsx", [
  "onPickVisit",
  "onPickOutreach",
  "onPickBatchFlow",
  "button-plexus-iq-add-patient-tile-visit",
  "button-plexus-iq-add-patient-tile-outreach",
  "button-plexus-iq-add-patient-tile-batchflow",
  "Plexus BatchFlow",
]);

requireText("client/src/pages/plexus-iq.tsx", [
  "PlexusIQAddPatientHub",
  "PlexusIQAddPatientModal",
  "PlexusIQBulkImportModal",
  'setDefaultPatientType("visit")',
  'setDefaultPatientType("outreach")',
  "CanonicalCommandCalendar",
]);

// ────────────────────────────────────────────────────────────────────
// 9. Canonical command-center subsystem files still exist.
// ────────────────────────────────────────────────────────────────────

const commandCenterRequired = [
  "client/src/features/command-center/tiles/VisitOutreachKindToggle.tsx",
  "client/src/features/command-center/tiles/VisitCommandTile.tsx",
  "client/src/features/command-center/tiles/OutreachCommandTile.tsx",
  "client/src/features/command-center/tiles/CommandTile.tsx",
];
for (const rel of commandCenterRequired) {
  requireFile(rel);
}

// ────────────────────────────────────────────────────────────────────
// 10. Calendar spine untouched.
// ────────────────────────────────────────────────────────────────────

requireFile("client/src/components/calendar/CanonicalCommandCalendar.tsx");
requireFile("client/src/lib/calendar/commandCalendarViewModel.ts");

// ────────────────────────────────────────────────────────────────────
// 11. No Plexus-only Visit/Outreach tile/card duplicate files.
// ────────────────────────────────────────────────────────────────────

const forbiddenPatterns = [
  /Plexus(IQ|Iq)?VisitTile\.tsx$/,
  /Plexus(IQ|Iq)?OutreachTile\.tsx$/,
  /Plexus(IQ|Iq)?VisitCard\.tsx$/,
  /Plexus(IQ|Iq)?OutreachCard\.tsx$/,
];

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".git" ||
      entry.name === "dist" ||
      entry.name === "build" ||
      entry.name === "tmp_recovery" ||
      entry.name === "artifacts"
    ) {
      continue;
    }
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(next));
    } else if (entry.isFile()) {
      out.push(next);
    }
  }
  return out;
}

for (const file of walk(root)) {
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(file)) {
      failures.push(
        `Forbidden Plexus-only tile/card file: ${path.relative(root, file)}`,
      );
    }
  }
}

if (failures.length) {
  console.error("Team Portal workspace engine QA failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Team Portal workspace engine QA passed.");
