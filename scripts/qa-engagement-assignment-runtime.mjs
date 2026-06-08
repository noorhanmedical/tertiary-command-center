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

// ────────────────────────────────────────────────────────────────────
// 1. Engagement UI components exist.
// ────────────────────────────────────────────────────────────────────

const board = "client/src/components/engagement/EngagementAssignmentBoard.tsx";
const changeDialog =
  "client/src/components/qualification/ChangeEngagementAssignmentDialog.tsx";
const badge = "client/src/components/qualification/EngagementAssignmentBadge.tsx";
const page = "client/src/pages/engagement-center.tsx";

requireFile(board);
requireFile(changeDialog);
requireFile(badge);
requireFile(page);

requireText(board, [
  "EngagementAssignmentBoard",
  "/api/engagement/assignment-board",
  "/api/engagement/assignment-board/assign",
  "/api/outreach/schedulers",
]);

requireText(changeDialog, ["ChangeEngagementAssignmentDialog"]);
requireText(badge, ["EngagementAssignmentBadge"]);

// ────────────────────────────────────────────────────────────────────
// 2. /engagement-center renders the assignment board (NOT the legacy
//    OutreachPage wrapper).
// ────────────────────────────────────────────────────────────────────

requireText(page, [
  "EngagementAssignmentBoard",
  "Engagement Center",
  "PLEXUS ANCILLARY",
  "text-engagement-center-title",
]);

requireNotText(
  page,
  ["import OutreachPage", "return <OutreachPage />"],
  "Engagement Center must own its own shell — not the OutreachPage wrapper",
);

// ────────────────────────────────────────────────────────────────────
// 3. App.tsx routes are intact.
// ────────────────────────────────────────────────────────────────────

requireText("client/src/App.tsx", [
  "EngagementCenterPage",
  "/engagement-center",
  "/team-member-portals",
  "/patient-care-specialist-portal",
  "/ancillary-care-specialist-portal",
  "/plexus-iq",
  "/scheduler-portal",
  "/liaison-technician-portal",
]);

// ────────────────────────────────────────────────────────────────────
// 4. Backend route registered.
// ────────────────────────────────────────────────────────────────────

const routeFile = "server/routes/engagementAssignmentBoard.ts";
requireFile(routeFile);
requireText(routeFile, [
  "registerEngagementAssignmentBoardRoutes",
  '"/api/engagement/assignment-board"',
  '"/api/engagement/assignment-board/assign"',
  // Cancel-many route: Engagement Center delete removes assignment
  // not patient record; scoped to the current group via the bulk
  // executionCaseIds payload.
  '"/api/engagement/assignment-board/cancel-many"',
  "Engagement Center delete removes assignment not patient record",
  "Engagement Center delete all is scoped to current group",
  "engagement_assignment_cancelled",
]);

// Engagement Center page UI: grouping toolbar, per-group actions,
// scheduler PDFs, delete controls. Mirrors the Admin Review tab.
requireText("client/src/components/engagement/EngagementAssignmentBoard.tsx", [
  // Toolbar + group modes.
  "engagement-center-grouped-board",
  "engagement-center-group-mode-date",
  "engagement-center-group-mode-facility",
  "engagement-center-group-mode-scheduler",
  // Per-group sections + actions (Date / Facility / Scheduler).
  "engagement-center-date-group",
  "engagement-center-date-group-patient",
  "engagement-center-date-select-all",
  "engagement-center-date-plexus-pdf",
  "engagement-center-date-clinician-pdf",
  "engagement-center-date-delete-all",
  "engagement-center-facility-group",
  "engagement-center-facility-group-patient",
  "engagement-center-facility-select-all",
  "engagement-center-facility-plexus-pdf",
  "engagement-center-facility-clinician-pdf",
  "engagement-center-facility-delete-all",
  "engagement-center-scheduler-group",
  "engagement-center-scheduler-group-patient",
  "engagement-center-scheduler-select-all",
  "engagement-center-scheduler-plexus-pdf",
  "engagement-center-scheduler-clinician-pdf",
  "engagement-center-scheduler-delete-all",
  // Cross-cutting selection + delete + PDF testIds.
  "engagement-center-select-patient",
  "engagement-center-select-all-patients",
  "engagement-center-selected-count",
  "engagement-center-delete-patient",
  "engagement-center-delete-group",
  "engagement-center-delete-group-confirm",
  "engagement-center-plexus-pdf",
  "engagement-center-clinician-pdf",
  // Source markers documenting the contract.
  "Engagement Center can group by date facility scheduler",
  "Engagement Center scheduler PDFs are scoped to assigned scheduler",
  "Engagement Center call lists grouped by scheduler",
  "PDF by team member uses assigned scheduler group",
  "Engagement Center delete removes assignment not patient record",
  "Engagement Center delete all is scoped to current group",
  "Engagement Center PDF packets use selected patients only",
  "Engagement Center PDFs validate facility date packet",
  // Canonical PDF helpers reused as-is.
  "generatePlexusPDF",
  "generateClinicianPDF",
  "validateSameFacilityDatePacket",
  // Cancel-many wire endpoint.
  "/api/engagement/assignment-board/cancel-many",
  // Change-assignment picker must live on grouped rows as well as
  // the flat table — the grouped views are the default surface so
  // a regression here removes the picker from view entirely.
  "InlineSchedulerPicker",
  "engagement-center-change-assignment",
  "engagement-center-change-assignment-select",
  "engagement-center-change-assignment-save",
  // Per-group bulk assign + distribute-across-schedulers. The
  // popover lives on every grouped section's action cluster.
  "GroupAssignPopover",
  "engagement-center-bulk-assign-trigger",
  "engagement-center-bulk-assign-popover",
  "engagement-center-bulk-assign-one-select",
  "engagement-center-bulk-assign-one-save",
  "engagement-center-distribute-scheduler-checkbox",
  "engagement-center-distribute-save",
  "engagement-center-distribute-preview",
  "Engagement Center bulk assign selected to one scheduler",
  "Engagement Center distribute evenly across schedulers",
]);

// Outreach (no-date) packets must be allowed by the PDF validator
// so a group of outreach patients sharing one facility produces a
// real Plexus / Clinician packet. The validator returns
// isOutreachPacket = true and consumers render "Outreach" in the
// batch label.
requireText("client/src/lib/pdfPacketGrouping.ts", [
  "isOutreachPacket",
  "outreach call-list packet",
  "all-outreach patients",
]);

requireText("server/routes.ts", [
  "registerEngagementAssignmentBoardRoutes",
  'from "./routes/engagementAssignmentBoard"',
  "registerEngagementAssignmentBoardRoutes(app)",
]);

// ────────────────────────────────────────────────────────────────────
// 5. Engagement route reuses the canonical spine — no new tables,
//    no parallel storage.
// ────────────────────────────────────────────────────────────────────

requireText(routeFile, [
  "patientExecutionCases",
  "patientJourneyEvents",
  "patientScreenings",
  "screeningBatches",
  "outreachSchedulers",
]);

// No engagement-specific migration should have been added with this
// transplant. Walk migrations/ to confirm nothing matches the
// engagement-assignment naming.
const migrationsDir = path.join(root, "migrations");
if (fs.existsSync(migrationsDir)) {
  for (const file of fs.readdirSync(migrationsDir)) {
    if (!file.endsWith(".sql")) continue;
    if (/engagement.?assignment|engagement_assignment_board/i.test(file)) {
      failures.push(
        `Unexpected engagement assignment migration: migrations/${file}. ` +
          `This PR transplants the route only — no schema change should ship.`,
      );
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// 6. Protection — Plexus IQ, command-center tile subsystem, calendar
//    spine, TeamPortalShell, and legacy PortalShell all preserved.
// ────────────────────────────────────────────────────────────────────

requireText("client/src/components/plexus-iq/PlexusIQAddPatientModal.tsx", [
  "VisitOutreachKindToggle",
  "@/features/command-center/tiles",
  'surface="plexusIq"',
]);

requireText("client/src/components/plexus-iq/PlexusIQAddPatientHub.tsx", [
  "onPickVisit",
  "onPickOutreach",
  "onPickBatchFlow",
  "Plexus BatchFlow",
]);

requireText("client/src/pages/plexus-iq.tsx", [
  "PlexusIQAddPatientHub",
  "CanonicalCommandCalendar",
]);

const required = [
  "client/src/features/command-center/tiles/VisitOutreachKindToggle.tsx",
  "client/src/features/command-center/tiles/VisitCommandTile.tsx",
  "client/src/features/command-center/tiles/OutreachCommandTile.tsx",
  "client/src/features/command-center/tiles/CommandTile.tsx",
  "client/src/components/calendar/CanonicalCommandCalendar.tsx",
  "client/src/lib/calendar/commandCalendarViewModel.ts",
  "client/src/components/portal/TeamPortalShell.tsx",
  "client/src/components/portal/PortalShell.tsx",
];
for (const rel of required) {
  requireFile(rel);
}

// HomeDashboard tile-team-member-portals + tile-plexus-iq stay; no
// re-introduction of Visit/Outreach standalone tiles.
const home = "client/src/components/HomeDashboard.tsx";
requireText(home, [
  'data-testid="tile-plexus-iq"',
  'testId="tile-team-member-portals"',
]);

requireNotText(
  home,
  [
    'testId="tile-visit-patients"',
    'testId="tile-outreach-patients"',
    'label="Visit Patients"',
    'label="Outreach Patients"',
  ],
  "HomeDashboard must not re-add Visit/Outreach standalone tiles",
);

// ────────────────────────────────────────────────────────────────────
// 7. No Plexus-only Visit/Outreach duplicate tile/card files.
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
  console.error("Engagement assignment runtime QA failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Engagement assignment runtime QA passed.");
