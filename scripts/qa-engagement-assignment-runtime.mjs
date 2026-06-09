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
  // No-duplicate-scheduler-per-date guard: assign route rejects an
  // assignment that would land the same patient (name + DOB) with
  // two different schedulers on the same scheduleDate.
  "findConflictingActiveAssignment",
  "Two schedulers cannot share the same patient for the same date",
  "Duplicate scheduler per date guard",
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
  // PDF failure surface — every failure path (no selection, no
  // patientScreeningId, fetch failure, validator rejection,
  // html2pdf crash, empty body) must produce a visible reason
  // through one of these two inline alerts.
  "engagement-center-pdf-generation-error",
  "engagement-center-pdf-validation-error",
  // Source markers documenting the contract.
  "Engagement Center can group by date facility scheduler",
  "Engagement Center scheduler PDFs are scoped to assigned scheduler",
  "Engagement Center call lists grouped by scheduler",
  "PDF by team member uses assigned scheduler group",
  "Engagement Center delete removes assignment not patient record",
  "Engagement Center delete all is scoped to current group",
  "Engagement Center PDF packets use selected patients only",
  "Engagement Center PDFs validate facility date packet",
  "Engagement Center PDF maps execution cases to patient screenings",
  "Engagement Center PDFs require patientScreeningId",
  "Engagement Center PDF fetches full patient records",
  "Engagement Center PDF generation error is surfaced",
  "Engagement Center PDF validation error is surfaced",
  // Platform stability pass — performance + pending-state +
  // stale-cleanup contract. Every marker below is grep-asserted so
  // a future "cleanup" cannot silently drop the guard.
  "Platform performance pass memoizes Engagement Center groups",
  "Engagement Center avoids rendering inactive heavy group content",
  "Assignment updates only invalidate assignment board",
  "Engagement Center PDF buttons are disabled while generating",
  "Engagement Center assign controls are disabled while pending",
  "PDF generation pending state is group scoped",
  "PDF generation clears stale error on success",
  "PDF generation runs on demand",
  "Engagement Center clears stale selection when group mode changes",
  "Engagement Center clears stale PDF errors when group mode changes",
  // Canonical PDF helpers reused as-is — awaitable variants are
  // required so the inline error surface can show the real reason
  // instead of the fire-and-forget alert fallback.
  "generatePlexusPDFAsync",
  "generateClinicianPDFAsync",
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
  // Distribute must tolerate uneven counts (round-robin) and the
  // toast must surface the actual per-call server error message.
  "Distribute round-robin tolerates uneven counts",
  "Distribute partially failed",
  "as even as possible",
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

// Platform stability pass — Admin Review dialog must not refetch the
// whole workspace on approve, must disable sibling nav while approve
// is in flight, and the sibling-reanchor effect must key off a stable
// signature so a same-length sibling-list mutation does not leave
// activeIndex pointing at the wrong patient.
requireText("client/src/components/qualification/AdminReviewDialog.tsx", [
  "Admin Review navigation does not refetch full workspace",
  "Admin Review navigation disabled during approve",
  "Admin Review sibling state reanchors safely",
  "Platform performance pass avoids unnecessary Admin Review resets",
  "siblingSignature",
  "approvalMutation.isPending",
]);

// PDF generation library must expose awaitable variants so callers
// can surface the real failure reason (selection / fetch / validator
// / html2pdf) instead of swallowing it through the fire-and-forget
// alert path. The html2pdf path must also fall back to a print
// window when html2pdf itself crashes (sandboxed embed, dynamic
// import failure, etc.) so the operator can still print to PDF.
requireText("client/src/lib/pdfGeneration.ts", [
  "generatePlexusPDFAsync",
  "generateClinicianPDFAsync",
  "exportPdfDocument",
  "html2pdf PDF export error is surfaced",
  "PDF export falls back when html2pdf fails",
  "Plexus PDF export is awaitable",
  "Clinician PDF export is awaitable",
  // Stability pass: read-only PDF path + dev-only timing instrumentation.
  "PDF generation does not invalidate data queries",
  "PDF generation runs on demand",
  "Development-only performance instrumentation",
  "import.meta.env.DEV",
  // Layout-and-speed pass.
  "PDF demographics omit schedule date",
  "Clinician PDF header uses stable two-column alignment",
  "Clinician PDF demographics do not overlap chart review",
  "Clinician PDF chart review has safe spacing",
  "Clinician PDF ancillary columns align cleanly",
  "Clinician PDF test rows have stable checkbox title alignment",
  "PDF export uses optimized html2canvas scale",
  "PDF template avoids expensive visual effects",
  "PDF generation optimized for large packets",
  // Speed knobs themselves — asserted as raw substrings so a future
  // regression that pushes scale back to 2.0 or re-adds windowWidth
  // gets caught by QA.
  "scale: 1.5",
]);

// Demographics block contract — facility / phone / email / DOB / age /
// sex still render; "Schedule Date:" is removed from the block.
const demoBlockSource = read("client/src/lib/pdfGeneration.ts") ?? "";
const demoBlockMatch = demoBlockSource.match(
  /export function buildPatientDemoBlock[\s\S]*?\n\}/,
);
if (!demoBlockMatch) {
  failures.push("Could not locate buildPatientDemoBlock to verify demographics contract");
} else {
  const block = demoBlockMatch[0];
  for (const needle of [
    "DOB:",
    "Age:",
    "Sex:",
    "Phone:",
    "Email:",
    "Insurance:",
    "Facility:",
  ]) {
    if (!block.includes(needle)) {
      failures.push(`buildPatientDemoBlock dropped required field: ${needle}`);
    }
  }
  if (block.includes("Schedule Date:")) {
    failures.push(
      'buildPatientDemoBlock must NOT render "Schedule Date:" — that lives in the page header now',
    );
  }
}

// Large-packet warning lives in the Engagement Center generateGroupPdf path.
requireText("client/src/components/engagement/EngagementAssignmentBoard.tsx", [
  "Large PDF packet generation warning",
  "Large PDF packet may take longer",
  // Scheduler-tab split: the scheduler group cannot be a single
  // packet because distribute legitimately mixes facility/date.
  // Routing branches into runSchedulerSplitPdf when groupMode is
  // "scheduler" — these markers + testIds keep that contract.
  "Scheduler tab PDF splits selected patients by facility date",
  "Scheduler call list PDF generates one packet per facility date",
  "Scheduler PDF uses selected patients from one scheduler group",
  "Scheduler PDF does not validate the entire scheduler group as one packet",
  "engagement-center-scheduler-pdf-packet-count",
  "engagement-center-scheduler-pdf-split-warning",
  "engagement-center-scheduler-pdf-error",
  // Toast copy: count + scheduler name surfaced before generation.
  "Generating 1 packet for",
  "by facility/date",
  "Failed to generate",
  "splitPatientsByFacilityDate",
]);

// Split helper lives in pdfPacketGrouping — the Scheduler / Team
// Member call list relies on it to fan one selection out into N
// valid facility/date packets without re-prompting the user.
requireText("client/src/lib/pdfPacketGrouping.ts", [
  "splitPatientsByFacilityDate",
  "SchedulerPdfPacket",
  "SchedulerPdfSplit",
  "Scheduler tab PDF splits selected patients by facility date",
  "Scheduler call list PDF generates one packet per facility date",
  "Scheduler PDF does not validate the entire scheduler group as one packet",
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
