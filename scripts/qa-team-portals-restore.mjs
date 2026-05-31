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

function requireNotText(rel, needles, label) {
  const content = read(rel);
  if (content === null) {
    failures.push(`Missing file: ${rel}`);
    return;
  }
  for (const needle of needles) {
    if (content.includes(needle)) {
      failures.push(`${label}: ${rel} contains "${needle}"`);
    }
  }
}

const home = "client/src/components/HomeDashboard.tsx";
const app = "client/src/App.tsx";
const hub = "client/src/pages/team-member-portals.tsx";
const pcs = "client/src/pages/patient-care-specialist-portal.tsx";
const acs = "client/src/pages/ancillary-care-specialist-portal.tsx";
const ec = "client/src/pages/engagement-center.tsx";
const portalShell = "client/src/components/portal/PortalShell.tsx";
const workflow = "client/src/components/workflow/ClinicWorkflowPortal.tsx";
const workspaceModeSwitcher =
  "client/src/components/portal/WorkspaceModeSwitcher.tsx";
const plexusModal =
  "client/src/components/plexus-iq/PlexusIQAddPatientModal.tsx";
const plexusHub =
  "client/src/components/plexus-iq/PlexusIQAddPatientHub.tsx";
const plexusPage = "client/src/pages/plexus-iq.tsx";
const canonicalCalendar =
  "client/src/components/calendar/CanonicalCommandCalendar.tsx";
const calendarViewModel =
  "client/src/lib/calendar/commandCalendarViewModel.ts";

// ────────────────────────────────────────────────────────────────────
// 1. Home dashboard — Team Member Portals tile present; Plexus IQ tile
//    still present; Visit/Outreach standalone tiles still NOT present.
// ────────────────────────────────────────────────────────────────────

requireText(home, [
  'data-testid="tile-plexus-iq"',
  'testId="tile-team-member-portals"',
  'href="/team-member-portals"',
  'label="Team Member Portals"',
]);

requireNotText(
  home,
  [
    'testId="tile-visit-patients"',
    'testId="tile-outreach-patients"',
    'label="Visit Patients"',
    'label="Outreach Patients"',
  ],
  "Home dashboard must not re-add Visit/Outreach standalone tiles",
);

// ────────────────────────────────────────────────────────────────────
// 2. App.tsx — new portal routes wired + legacy routes still in place.
// ────────────────────────────────────────────────────────────────────

requireText(app, [
  "TeamMemberPortalsPage",
  "PatientCareSpecialistPortalPage",
  "AncillaryCareSpecialistPortalPage",
  "EngagementCenterPage",
  '/team-member-portals',
  '/patient-care-specialist-portal',
  '/ancillary-care-specialist-portal',
  '/engagement-center',
  // Legacy spine must survive.
  '/plexus-iq',
  '/scheduler-portal',
  '/liaison-technician-portal',
]);

// ────────────────────────────────────────────────────────────────────
// 3. Portal page files exist + are thin wrappers / hub.
// ────────────────────────────────────────────────────────────────────

requireFile(hub);
requireFile(pcs);
requireFile(acs);
requireFile(ec);

requireText(hub, [
  '"/patient-care-specialist-portal"',
  '"/ancillary-care-specialist-portal"',
  '"/engagement-center"',
  "Patient Care Specialist",
  "Ancillary Care Specialist",
  "Engagement Center",
  "card-patient-care-specialist-workspace",
  "card-ancillary-care-specialist-workspace",
  "card-engagement-center",
]);

requireText(pcs, [
  "ClinicWorkflowPortal",
  'role="patientCareSpecialist"',
]);

requireText(acs, [
  "ClinicWorkflowPortal",
  'role="ancillaryCareSpecialist"',
]);

requireText(ec, ["OutreachPage"]);

// ────────────────────────────────────────────────────────────────────
// 4. ClinicWorkflowPortal adapter accepts the new 4-value WorkspaceRole
//    union and PortalShell exposes the optional props that adapter
//    needs.
// ────────────────────────────────────────────────────────────────────

requireText(workflow, [
  "WorkspaceRole",
  '"patientCareSpecialist"',
  '"ancillaryCareSpecialist"',
  '"technician"',
  '"liaison"',
  "PortalShell",
  "INTERNAL_ROLE",
  "WORKSPACE_LABEL",
]);

requireText(portalShell, [
  "workspaceLabel",
  "defaultMode",
  "workspaceRole",
]);

requireFile(workspaceModeSwitcher);
requireText(workspaceModeSwitcher, [
  "TeamMemberWorkspaceMode",
  '"clinicSchedule"',
  '"ancillarySchedule"',
  '"callList"',
]);

// ────────────────────────────────────────────────────────────────────
// 5. Plexus IQ protection — none of the restore work disturbed the
//    canonical Plexus IQ + command-tile architecture.
// ────────────────────────────────────────────────────────────────────

requireText(plexusModal, [
  "VisitOutreachKindToggle",
  "@/features/command-center/tiles",
  'surface="plexusIq"',
  "defaultPatientType",
]);

requireText(plexusHub, [
  "onPickVisit",
  "onPickOutreach",
  "onPickBatchFlow",
  "button-plexus-iq-add-patient-tile-visit",
  "button-plexus-iq-add-patient-tile-outreach",
  "button-plexus-iq-add-patient-tile-batchflow",
  "Plexus BatchFlow",
]);

requireText(plexusPage, [
  "PlexusIQAddPatientHub",
  "PlexusIQAddPatientModal",
  "PlexusIQBulkImportModal",
  'setDefaultPatientType("visit")',
  'setDefaultPatientType("outreach")',
  "setAddOpen(true)",
  "setBulkOpen(true)",
  "CanonicalCommandCalendar",
]);

// ────────────────────────────────────────────────────────────────────
// 6. Canonical command-center subsystem still in place.
// ────────────────────────────────────────────────────────────────────

const commandCenterRequired = [
  "client/src/features/command-center/tiles/VisitOutreachKindToggle.tsx",
  "client/src/features/command-center/tiles/VisitCommandTile.tsx",
  "client/src/features/command-center/tiles/OutreachCommandTile.tsx",
  "client/src/features/command-center/tiles/CommandTile.tsx",
  "client/src/features/command-center/tiles/commandTileTypes.ts",
  "client/src/features/command-center/tiles/commandTileProfiles.ts",
];
for (const rel of commandCenterRequired) {
  requireFile(rel);
}

// ────────────────────────────────────────────────────────────────────
// 7. Calendar spine intact.
// ────────────────────────────────────────────────────────────────────

requireFile(canonicalCalendar);
requireFile(calendarViewModel);

// ────────────────────────────────────────────────────────────────────
// 8. No Plexus-only Visit/Outreach duplicate tile/card files anywhere.
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
  console.error("Team Portals restore QA failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Team Portals restore QA passed.");
