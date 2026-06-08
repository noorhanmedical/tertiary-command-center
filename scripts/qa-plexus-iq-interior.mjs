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

const page = "client/src/pages/plexus-iq.tsx";
const hub = "client/src/components/plexus-iq/PlexusIQAddPatientHub.tsx";
const workspace = "client/src/components/plexus-iq/PlexusIQWorkspace.tsx";
const dashboardRow = "client/src/components/plexus-iq/PlexusIQDashboardRow.tsx";
const dayModal = "client/src/components/plexus-iq/PlexusIQDayModal.tsx";
const addModal = "client/src/components/plexus-iq/PlexusIQAddPatientModal.tsx";
const bulkModal = "client/src/components/plexus-iq/PlexusIQBulkImportModal.tsx";

// 1-2. Hub + Workspace + the page must exist and wire them up.
requireFile(hub);
requireFile(workspace);
requireFile(dashboardRow);
requireFile(dayModal);

requireText(page, [
  "PlexusIQAddPatientHub",
  "PlexusIQWorkspace",
  "<PlexusIQAddPatientHub",
  "<PlexusIQWorkspace",
]);

// 3. The 3 choices must be on the hub: Visit, Outreach, Plexus BatchFlow.
// Labels may be inlined as `>Visit<` or passed via a `label="Visit"`
// prop into an internal HubTile helper. Both patterns are accepted.
requireText(hub, [
  "onPickVisit",
  "onPickOutreach",
  "onPickBatchFlow",
  "button-plexus-iq-add-patient-tile-visit",
  "button-plexus-iq-add-patient-tile-outreach",
  "button-plexus-iq-add-patient-tile-batchflow",
  "Plexus BatchFlow",
]);
const hubLabelContent = read(hub) ?? "";
const visitLabelPresent =
  hubLabelContent.includes(">Visit<") || hubLabelContent.includes('label="Visit"');
const outreachLabelPresent =
  hubLabelContent.includes(">Outreach<") ||
  hubLabelContent.includes('label="Outreach"');
if (!visitLabelPresent) {
  failures.push(`Missing "Visit" tile label in ${hub}`);
}
if (!outreachLabelPresent) {
  failures.push(`Missing "Outreach" tile label in ${hub}`);
}

// 4. BatchFlow must reach the canonical bulk-import modal.
requireText(page, [
  "PlexusIQBulkImportModal",
  "onPickBatchFlow",
  "setBulkOpen(true)",
]);

requireFile(bulkModal);

// 4b. Page must wire the hub state to the modal's defaultPatientType:
// each tile picks a kind, closes the hub explicitly, and opens the
// single modal with the right default. Plexus BatchFlow does the same
// for the bulk-import modal.
requireText(page, [
  "defaultPatientType",
  'setDefaultPatientType("visit")',
  'setDefaultPatientType("outreach")',
  "setAddHubOpen(false)",
  "setAddOpen(true)",
  "setBulkOpen(true)",
  "defaultPatientType={defaultPatientType}",
]);

// 4c. Hub itself must NOT be wired into the command-center popup /
// playground layer. Visit / Outreach inside the hub are direct
// actions, not panel previews.
const hubContent = read(hub) ?? "";
const forbiddenInHub = [
  "PanelPopupCard",
  "CommandPlayground",
  "promoteToPlayground",
  "setSelectedContext",
  "popup={true}",
  "popupPreview",
  'componentType: "visit"',
  'componentType: "outreach"',
  'href="/visit-patients"',
  'href="/outreach-patients"',
  'setLocation("/visit-patients")',
  'setLocation("/outreach-patients")',
];
for (const needle of forbiddenInHub) {
  if (hubContent.includes(needle)) {
    failures.push(
      `Hub must not use popup/panel/navigation behavior: "${needle}" present in ${hub}`,
    );
  }
}

// 4d. Home / dashboard must not advertise Visit/Outreach as standalone
// tiles anymore — those live inside the Plexus IQ Add Patient(s)
// hub. Plexus IQ launcher tile stays.
const homeDashboard = "client/src/components/HomeDashboard.tsx";
const homeContent = read(homeDashboard) ?? "";
const forbiddenOnHome = [
  "<VisitCommandTile",
  "<OutreachCommandTile",
  'label="Visit Patients"',
  'label="Outreach Patients"',
  'testId="tile-visit-patients"',
  'testId="tile-outreach-patients"',
  'href="/visit-patients"',
  'href="/outreach-patients"',
];
for (const needle of forbiddenOnHome) {
  if (homeContent.includes(needle)) {
    failures.push(
      `Home dashboard must not render Visit/Outreach standalone tiles: "${needle}" present in ${homeDashboard}`,
    );
  }
}
if (homeContent && !homeContent.includes('data-testid="tile-plexus-iq"')) {
  failures.push(
    `Home dashboard must keep the Plexus IQ launcher tile (data-testid="tile-plexus-iq") in ${homeDashboard}`,
  );
}

// 5. Facility-card / worklist group test IDs must exist on the workspace.
requireText(workspace, [
  "plexus-iq-worklist-group-",
  "button-plexus-iq-worklist-toggle-",
  "button-plexus-iq-worklist-action-",
  "facility",
]);

// 6. Visit/Outreach must stay canonical inside the add-patient modal,
// and the modal must sync patientType when the parent re-opens it with
// a different defaultPatientType.
requireText(addModal, [
  "VisitOutreachKindToggle",
  "@/features/command-center/tiles",
  'surface="plexusIq"',
  "defaultPatientType",
  "useEffect",
]);

// 7. No Plexus-only Visit/Outreach tile/card files anywhere in the repo.
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

const allFiles = walk(root);
for (const file of allFiles) {
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(file)) {
      failures.push(
        `Forbidden Plexus-only tile/card file: ${path.relative(root, file)}`,
      );
    }
  }
}

// 8. Page must not be the calendar-first stats/day-panel/right-calendar
// dashboard layout we previously replaced — AND it must not re-render the
// global dashboard / jobs / recent / recently-deleted panels on the first
// overview surface (facility-first rule).
const pageContent = read(page) ?? "";
if (pageContent.includes("PlexusIQStatsRow")) {
  failures.push(
    `Page still references PlexusIQStatsRow — the canonical replacement is PlexusIQDashboardRow`,
  );
}
if (pageContent.includes("PlexusIQDayPanel")) {
  failures.push(
    `Page still references PlexusIQDayPanel — the canonical replacement is PlexusIQDayModal`,
  );
}
// Global dashboard / recent / recently-deleted panels stay off the
// facility-first overview. The qualification-jobs status banner is
// allowed BUT only behind an explicit activeQualificationJobs.length > 0
// gate, so it never becomes a permanent dashboard panel.
for (const panel of [
  "<PlexusIQDashboardRow",
  "<PlexusIQRecentQualificationCards",
  "<PlexusIQRecentlyDeleted",
]) {
  if (pageContent.includes(panel)) {
    failures.push(
      `Plexus IQ overview must be facility-first: ${page} still renders ${panel}`,
    );
  }
}

// BatchFlow qualification status: the component must be mounted
// AND the mount must be gated on activeQualificationJobs.length > 0
// so it disappears when no jobs are active.
requireText(page, [
  "<PlexusIQQualificationJobsStatus",
  "activeQualificationJobs.length > 0",
  "plexus-iq-qualification-status-strip",
]);

// The status component itself must surface the user-facing labels
// (Qualifying patients / Qualified / Needs Review) and the new
// per-state testIds + dismiss testId. Keeps the existing aggregate
// + per-job structure intact.
requireText(
  "client/src/components/plexus-iq/PlexusIQQualificationJobsStatus.tsx",
  [
    "Qualifying patients",
    "Qualified",
    "Needs Review",
    "Failed",
    "plexus-iq-qualification-status-qualifying",
    "plexus-iq-qualification-status-qualified",
    "plexus-iq-qualification-status-needs-review",
    "plexus-iq-qualification-status-failed",
    "plexus-iq-qualification-status-dismiss",
  ],
);

// 9. Patient Card frontend recovery (Batch 3 — frontend-only).
const pdfActions = "client/src/components/qualification/PatientPdfActions.tsx";
const completeness = "client/src/lib/patientCompleteness.ts";
const patientCard = "client/src/components/PatientCard.tsx";
const patientEditDialog = "client/src/components/PatientEditDialog.tsx";

requireFile(pdfActions);
requireFile(completeness);
requireText(pdfActions, [
  "PatientPdfActions",
  "button-patient-plexus-pdf",
  "button-patient-clinician-pdf",
  "generatePlexusPDF",
  "generateClinicianPDF",
  "isPatientPdfEligible",
]);
requireText(completeness, [
  "getPatientCompleteness",
  "BASE_FIELDS",
  "VISIT_EXTRA",
]);

requireText(patientCard, [
  // PDF actions wiring.
  'import { PatientPdfActions }',
  "<PatientPdfActions",
  "iconOnly",
  // Engagement badge is allowed (already on main).
  "EngagementAssignmentBadge",
  // Completeness gating.
  "getPatientCompleteness",
  "infoComplete",
  "missing",
  // More dropdown + Edit/Generate menu.
  "DropdownMenu",
  "menu-edit-patient",
  "menu-generate",
  "button-patient-more",
  // Status pill states.
  '"Pending"',
  '"Ready"',
  '"Final"',
  // Pencil + MoreHorizontal lucide imports.
  "MoreHorizontal",
  "Pencil",
]);

// Admin / Clinician Review is intentionally restored in this batch.
requireText(patientCard, [
  "AdminReviewDialog",
  "computeAdminReview",
  "adminApprovalStatus",
  "ShieldCheck",
  "readyForAdminReview",
  "button-admin-review",
  "Ready for Admin Review",
]);

// Edit dialog gets completeness + missing pill plus Admin Review entry.
requireText(patientEditDialog, [
  "getPatientCompleteness",
  "dialog-missing-",
  "Required before generation",
  "isVisit",
  "generateDisabled",
]);
requireText(patientEditDialog, [
  "onOpenAdminReview",
  "Admin Review",
]);


// Admin / Clinician Review files and schema/migration guardrails.
const adminReviewDialog = "client/src/components/qualification/AdminReviewDialog.tsx";
const adminApprovalControl = "client/src/components/qualification/AdminApprovalControl.tsx";
const adminReviewStatus = "client/src/lib/adminReviewStatus.ts";
const screeningSchema = "shared/schema/screening.ts";
const adminReviewMigration = "migrations/0025_add_patient_screening_admin_approval.sql";

requireFile(adminReviewDialog);
requireFile(adminApprovalControl);
requireFile(adminReviewStatus);
requireFile(adminReviewMigration);

requireText(adminReviewDialog, [
  "AdminReviewDialog",
  "computeAdminReview",
  "/admin-approval",
  "Approved",
  "Reject",
]);

requireText(adminApprovalControl, [
  "AdminApprovalControl",
  "approved",
  "rejected",
  "needs_info",
]);

requireText(adminReviewStatus, [
  "computeAdminReview",
  "readyForAdminReview",
  "adminApprovalStatus",
]);

requireText(screeningSchema, [
  "adminApprovalStatus",
]);

requireText(adminReviewMigration, [
  "admin_approval_status",
  "patient_screenings",
]);

// Backend handler for the admin-approval POST that the dialog calls.
const patientsRoute = "server/routes/patients.ts";
requireText(patientsRoute, [
  "/api/patient-screenings/:id/admin-approval",
  "adminApprovalStatus",
  "admin_approval_updated",
]);

// Admin Review evidence assignment + under-16 rule guardrails.
requireText("shared/plexus-iq/adminReviewEvidence.ts", [
  "buildAdminReviewEvidence",
  "requiresIcd",
  "suggestedIcds",
  "under16",
  "adminApprovalRequired",
  "COMMON_ICD_SUGGESTIONS",
]);

requireText("server/services/plexusIq/adminReviewRuleEngine.ts", [
  "runAdminReviewRuleEngine",
  "buildAdminReviewEvidence",
]);

requireText("server/routes/patients.ts", [
  "/api/patient-screenings/:id/admin-review/evidence",
  "/api/patient-screenings/:id/admin-review/regenerate",
]);

requireText("client/src/components/qualification/AdminReviewDialog.tsx", [
  // Three-column board markers.
  "admin-review-three-column-layout",
  "admin-review-left-column",
  "admin-review-middle-column",
  "admin-review-right-column",
  // Category meta from canonical source.
  "categoryStyles",
  "categoryIcons",
  "categoryLabels",
  "getAncillaryCategory",
  // Raw Clinical Source on the left.
  "admin-review-clinical-source",
  "admin-review-source-hx",
  "admin-review-source-dx",
  "admin-review-source-rx",
  // Right panel: Available Buttons are now behind 3 popover triggers
  // (Diagnosis / Medications / Symptoms). The header copy ("Available
  // Buttons" + helper text) was intentionally removed.
  "admin-review-right-panel-buttons",
  "admin-review-right-button-diagnosis",
  "admin-review-right-button-medications",
  "admin-review-right-button-symptoms",
  "admin-review-right-popover-diagnosis",
  "admin-review-right-popover-medications",
  "admin-review-right-popover-symptoms",
  // The popovers still render the per-category AvailableButtonsRow
  // (Dx / Rx / Hx).
  "admin-review-available-buttons-dx",
  "admin-review-available-buttons-rx",
  "admin-review-available-buttons-hx",
  // ICD search lives in the left column under raw Hx/Dx/Rx source cards.
  "admin-review-icd-search-left",
  // ICD-needed diagnoses must still be assignable to ancillaries.
  "admin-review-icd-needed-diagnosis-assignable",
  // Duplicate-prevention helper + UX state.
  "isAssignedToTarget",
  "admin-review-assignment-already-selected",
  "Already on BrainWave",
  "Already on VitalWave",
  "Already on Ultrasound Studies",
  // Parsing helpers.
  "parseDiagnosisButtonsFromDx",
  "parseMedicationButtonsFromRx",
  "parseSymptomButtonsFromHx",
  // Derived button testIds + button kinds.
  "admin-review-dx-derived-diagnosis",
  "admin-review-rx-derived-med",
  "admin-review-hx-derived-symptom",
  "admin-review-icd-disease-button",
  "admin-review-icd-disease-assigned",
  "admin-review-med-button",
  "admin-review-hx-button",
  // OpenAI ICD search controls + universal copy.
  "admin-review-icd-ai-search",
  "admin-review-icd-ai-search-button",
  "admin-review-icd-ai-search-result",
  "admin-review-icd-ai-search-loading",
  "admin-review-icd-ai-search-empty",
  "admin-review-icd-ai-search-error",
  "Search any ICD-10 diagnosis",
  "Search ICD-10 codes beyond the current chart",
  // Assignment controls.
  "admin-review-assign-evidence",
  "admin-review-assign-brainwave",
  "admin-review-assign-vitalwave",
  "admin-review-assign-ultrasound-parent",
  "admin-review-assign-ultrasound-test",
  "admin-review-assign-all",
  "admin-review-unassign-supporting-item",
  // Simplified ancillary panels (BrainWave + VitalWave).
  "admin-review-ancillary-colored-panel",
  "admin-review-ancillary-factor-chip",
  "admin-review-ancillary-expanded",
  "admin-review-regenerate-ancillary",
  "admin-review-regenerate-brainwave",
  "admin-review-regenerate-vitalwave",
  // Icon-only Regenerate / Delete buttons on every ancillary bar.
  "admin-review-regenerate-icon-button",
  "admin-review-delete-icon-button",
  // Ultrasound parent + child bars (simplified to chip + icon row).
  "admin-review-ultrasound-parent-panel",
  "admin-review-ultrasound-child-panel",
  "admin-review-ultrasound-child-factor-chip",
  "admin-review-ultrasound-regenerate-icon-button",
  "admin-review-ultrasound-delete-icon-button",
  "admin-review-regenerate-ultrasound-test",
  "admin-review-regenerate-ultrasound",
  // Canonical reasoning binding (preserved).
  "admin-review-canonical-reasoning-card",
  "buildCanonicalReasoningByAncillary",
  "clinician_understanding",
  "patient_talking_points",
  "qualifying_factors",
  "icd10_codes",
  "pearls",
  // Under-16 + PDF essentials.
  "admin-review-under-16-rule",
  "badge-admin-review-under-16",
  "PatientPdfActions",
  "buildLocalEvidenceFallback",
  "BrainWave",
  "VitalWave",
  "Ultrasound Studies",
  // Layout: Team Portal blue panels, white middle, smoke header,
  // collapsible side panels, scrollable left/right.
  "admin-review-smoke-header",
  "admin-review-blue-left-panel",
  "admin-review-blue-right-panel",
  "admin-review-ancillary-playground",
  "admin-review-ancillary-playground-pill",
  "admin-review-ancillary-playground-white-panel",
  "admin-review-left-panel-scroll",
  "admin-review-right-panel-scroll",
  "admin-review-left-panel-toggle",
  "admin-review-right-panel-toggle",
  "admin-review-left-panel-open",
  "admin-review-right-panel-open",
  "admin-review-left-panel-collapsed",
  "admin-review-right-panel-collapsed",
  // Left tabs: Source default + Patient Directory + cooldown +
  // insurance + history.
  "admin-review-left-tabs",
  "admin-review-left-tab-source",
  "admin-review-left-tab-patient-directory",
  "admin-review-left-tab-cooldown",
  "admin-review-left-tab-insurance",
  "admin-review-left-tab-history",
  "admin-review-source-tab-content",
  "admin-review-patient-directory-tab-content",
  "admin-review-patient-cooldown-summary",
  // Diagnosis suggestions (inactive until accepted) live inside the
  // Diagnosis popover + a dedicated Suggestions popover button.
  "admin-review-diagnosis-suggestions",
  "admin-review-med-derived-diagnosis-suggestion",
  "admin-review-accept-diagnosis-suggestion",
  "admin-review-right-button-suggestions",
  "admin-review-right-popover-suggestions",
  // Rule-engine seeded chips appear inside closed bars + ultrasound
  // child rows.
  "admin-review-rule-engine-seeded-chip",
  // Right-panel reorganized actions. Top PDF buttons match the PDF
  // generator naming ("Plexus PDF" + "Clinician PDF") and surface both
  // -pdf-preview-button-* and -pdf-action-* markers for QA.
  "admin-review-right-actions-panel",
  "admin-review-pdf-preview-button-plexus",
  "admin-review-pdf-preview-button-clinician",
  "admin-review-pdf-action-plexus",
  "admin-review-pdf-action-clinician",
  "Plexus PDF",
  "Clinician PDF",
  "admin-review-admin-note-icon-button",
  "admin-review-approve-button",
  "admin-review-pend-button",
  "admin-review-scheduler-routing-chip",
  // Bottom audit box + record helper.
  "admin-review-updates-made-box",
  "admin-review-updates-made-item",
  "admin-review-record-update",
  "recordAdminReviewUpdate",
  // Default-open state for layout panels.
  "useState(true)",
  // Venous helper imported in the dialog for ultrasound child seeding.
  "evidenceForUltrasoundTest",
  // Approved muted blue used by the side panels — the literal hex
  // appears as both a className arbitrary value and a data marker.
  "#7283B0",
]);

// Admin Review side panels must use the approved #7283B0 muted blue,
// not the previous navy. Forbid the navy class tokens.
requireNotText(
  "client/src/components/qualification/AdminReviewDialog.tsx",
  ["bg-blue-900", "border-blue-950"],
  "Admin Review side panels must use the approved #7283B0 muted blue, not navy",
);

// Admin Review forbidden visible copy. The simplified bars and the
// new 3-button right panel must NOT carry helper labels, status copy,
// or the legacy "ICD needed" tag.
requireNotText(
  "client/src/components/qualification/AdminReviewDialog.tsx",
  [
    "Available Buttons",
    "Select items to add to BrainWave, VitalWave, or Ultrasound.",
    "ICD needed",
    "Services:",
    "Selected:",
    "Supporting:",
    "Needs Info",
    "click to expand",
    "No supporting items selected",
    "supporting · click to expand",
  ],
  "Admin Review must drop legacy helper / status copy from bars and right panel",
);

// "Needs Info" must still exist on the right-panel approval button
// (admin-review-button-needs-info-*), but must not appear as a status
// label inside the ancillary panel headers anymore.
const adminReviewSource =
  read("client/src/components/qualification/AdminReviewDialog.tsx") ?? "";
if (/text-slate-700\/80[^}]*Needs Info/.test(adminReviewSource)) {
  failures.push(
    'AdminReviewDialog must not render "Needs Info" status label on ancillary bars',
  );
}

// Forbidden: legacy regenerate buttons, manual ICD form, count copy, etc.
requireNotText(
  "client/src/components/qualification/AdminReviewDialog.tsx",
  [
    "admin-review-regenerate-clinician",
    "admin-review-regenerate-patient",
    "admin-review-regenerate-all",
    "admin-review-global-regenerate",
    "admin-review-icd-manual-code",
    "admin-review-icd-manual-label",
    "admin-review-icd-add",
    "tests ·",
    "qualifying tests",
    "2 tests",
    "3 evidence",
    "if (!q) return all.slice(0, 6)",
    // ICD search must not live inside the middle Available Buttons section.
    "admin-review-available-buttons-icd-search",
  ],
  "AdminReviewDialog must use the canonical source-buttons architecture",
);

requireText("client/src/components/PatientCard.tsx", [
  "badge-patient-under-16",
]);

requireNotText(
  "client/src/components/qualification/AdminReviewDialog.tsx",
  [
    "Added ICDs become evidence chips too",
    "Click a chip to add",
    "This UI edits evidence assignment",
    "How this fits the spine",
    "Rule engine is not shown here",
    "deterministic eligibility",
    "auto-qualify",
  ],
  "AdminReviewDialog must not contain tutorial/rule-engine UI copy",
);

// Admin Review true OpenAI regeneration guardrails.
requireText("server/services/plexusIq/adminReviewAiRegeneration.ts", [
  "regenerateAdminReviewReasoning",
  "OPENAI_API_KEY",
  "client.responses.create",
  "json_schema",
  "clinicianReasoning",
  "patientExplanation",
]);

requireText("server/routes/patients.ts", [
  "regenerateAdminReviewReasoning",
  "../services/plexusIq/adminReviewAiRegeneration",
]);

requireNotText(
  "server/routes/patients.ts",
  [
    "Clinician rationale generated from selected evidence",
    "Patient explanation generated in plain language using selected evidence",
  ],
  "Admin Review regenerate route must call OpenAI helper instead of canned server text",
);

requireNotText(
  "client/src/components/qualification/AdminReviewDialog.tsx",
  ["OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY"],
  "OpenAI API key must never appear in client code",
);

// ─── Card / List view toggle + collapsible date groups ───────────────
// Shared renderer for every Plexus IQ bucket — toggle + grouping lives in
// QualificationPatientCardsPane so all status buckets get the same UX.
const cardsPane = "client/src/components/qualification/QualificationPatientCardsPane.tsx";
const listRow = "client/src/components/qualification/PatientListRow.tsx";

requireFile(listRow);

requireText(cardsPane, [
  // View toggle.
  "plexus-iq-view-toggle",
  "plexus-iq-view-cards",
  "plexus-iq-view-list",
  // Default display mode must be list.
  'useState<PatientDisplayMode>("list")',
  // Date groups.
  "plexus-iq-date-group",
  "plexus-iq-date-group-header",
  // Default-collapsed date-group helper.
  "isDateGroupCollapsed",
  "isDropdownClosed",
  "?? true",
  // Updater-based toggle (no closure-state read).
  "prev[key] ?? true",
  // Dropdown bodies must overlay instead of pushing content down.
  "plexus-iq-dropdown-overlay",
  "plexus-iq-dropdown-trigger",
  "plexus-iq-dropdown-panel",
  // Delete per date is available to Plexus IQ users.
  "plexus-iq-delete-date-group",
  "plexus-iq-delete-date-group-confirm",
  "Delete is available to Plexus IQ users",
  // groupByDate prop must be supported so nested-date contexts opt out.
  "groupByDate",
  // Card vs list view containers.
  "plexus-iq-card-view",
  "plexus-iq-list-view",
  "plexus-iq-patient-card-grid",
  "plexus-iq-patient-list",
  // Both renderers wired.
  "PatientListRow",
  "PatientCard",
]);

// PlexusIQWorkspace must opt out of the pane's date grouping where it
// already shows a date/facility header above the pane. It must also
// render the facility-first overview with the required testIds.
requireText("client/src/components/plexus-iq/PlexusIQWorkspace.tsx", [
  "groupByDate={false}",
  "plexus-iq-facility-overview",
  "plexus-iq-facility-tile-grid",
  "plexus-iq-facility-tile",
  // The facility interior (ClinicDetailPackets) is the actual surface
  // the user sees after clicking a clinic tile. It MUST render every
  // date/group as a compact overlay-popover trigger (not a big tile)
  // and MUST carry the visible delete-all-per-date control because
  // groupByDate={false} prevents QualificationPatientCardsPane from
  // emitting its own delete-all-per-date trash.
  "plexus-iq-dropdown-trigger",
  "plexus-iq-dropdown-overlay",
  "plexus-iq-dropdown-panel",
  "plexus-iq-delete-date-group",
  "plexus-iq-delete-date-group-confirm",
  // Default-closed helpers in the facility interior.
  "defaultClosedDropdowns",
  "isDropdownClosed",
  "?? true",
  // Source markers documenting the permission model + default-closed
  // architecture in the facility interior.
  "Delete all per date is available to Plexus IQ users",
  // Approved Plexus IQ visuals (from the preview): muted blue
  // #7283B0 panel CONTAINED inside the facility-interior grid (not
  // a viewport-edge Popover that can fly off-screen). Date rows live
  // in a left rail like vertical tabs; selected date opens to the
  // right indented panel with white patient rows inside.
  "plexus-iq-dropdown-contained-panel",
  "plexus-iq-dropdown-indented-panel",
  "plexus-iq-dropdown-white-row",
  "#7283B0",
  "Plexus IQ dropdown panel color #7283B0",
  // Date rail container that holds the tab-style date rows.
  "plexus-iq-date-rail",
]);

// Forbidden in the facility interior: the patient pane must never be
// wrapped in a "big tile" (the old rounded-xl bg-slate-50/40 p-3
// container), and the panel must NOT be dark navy or use a
// viewport-edge popover that can fly off-screen.
requireNotText(
  "client/src/components/plexus-iq/PlexusIQWorkspace.tsx",
  [
    "rounded-xl border border-slate-100 bg-slate-50/40 p-3",
    "bg-blue-900",
    "border-blue-950",
    'side="right"',
  ],
  "PlexusIQWorkspace facility interior must use the approved contained #7283B0 panel, not navy or off-screen popovers",
);

requireText(listRow, [
  "plexus-iq-patient-list-row",
  "plexus-iq-patient-list-row-clickable",
  "button-admin-review-list-row",
  "stopPropagation",
  "AdminReviewDialog",
  "PatientPdfActions",
  // Admin Review is admin-only — list row gates the button on the
  // current user's role and tags the wrapper for QA visibility.
  "Admin Review is admin-only",
  'currentUser?.role === "admin"',
  // Delete remains available to Plexus IQ users (NOT admin-only).
  "Delete is available to Plexus IQ users",
  "plexus-iq-delete-patient",
  // Visible inline trash button (not just the More-menu item) so
  // users can delete a patient without digging through a menu.
  "button-delete-patient-list-row-",
]);

// PatientCard mirrors the same permission rule for its in-card Admin
// Review button and trash control.
requireText(patientCard, [
  "Admin Review is admin-only",
  'currentUser?.role === "admin"',
  "Delete is available to Plexus IQ users",
  "plexus-iq-delete-patient",
]);

// Facility / dashboard bucket labels: visible strings + centralized const.
const bucketLabelsHost = "client/src/components/plexus-iq/PlexusIQWorkspace.tsx";
requireText(bucketLabelsHost, [
  "PLEXUS_IQ_BUCKET_LABELS",
  "Parsed",
  "Missing Info",
  "Admin Review Pending",
  "Completed",
  "Sent to Engagement",
  // Bucket order + Completed-as-default source markers.
  "Completed is the default Plexus IQ facility bucket",
  "Plexus IQ facility bucket order",
  'useState<ClinicStatusFilter>("completed")',
]);
// Old label phrasing must be gone.
requireNotText(
  bucketLabelsHost,
  ["Submitted / Sent to Engagement"],
  "Old 'Submitted / Sent to Engagement' label must be replaced with 'Sent to Engagement'",
);

// Bucket-order check: tiles array must list Completed before Missing
// Info before Parsed (needs) before Admin Review Pending before Sent
// to Engagement. We assert by checking the source-substring order of
// the `id: "..."` lines in the tiles array.
{
  const wsSource = read(bucketLabelsHost) ?? "";
  const order = ['id: "completed"', 'id: "missingInfo"', 'id: "needs"', 'id: "readyForEngagement"', 'id: "sentToEngagement"'];
  let cursor = 0;
  for (const token of order) {
    const idx = wsSource.indexOf(token, cursor);
    if (idx < 0) {
      failures.push(`Plexus IQ facility bucket order: missing ${token} after position ${cursor} in ${bucketLabelsHost}`);
      break;
    }
    cursor = idx + token.length;
  }
}

// Admin Review regenerate error must be surfaced inline on each bar +
// the payload must include priorQualifyingFactorsByTest + removedFactors.
requireText("client/src/components/qualification/AdminReviewDialog.tsx", [
  "admin-review-regenerate-error",
  "admin-review-regenerate-icon-button",
  "admin-review-ultrasound-regenerate-icon-button",
  "Admin Review regenerate error is surfaced",
  "Admin Review regenerate payload includes priorQualifyingFactorsByTest",
  "Admin Review regenerate payload includes removedFactors",
  "extractRegenErrorMessage",
  "regenErrors",
]);

// Top-right PDF buttons must not regress to "Patient Understanding" /
// "Clinician Understanding" as PDF/action button labels. Those words
// appear inside the canonical reasoning content area ("Clinician
// Understanding" / "Patient Talking Points") and must NOT be on a
// data-pdf-action button.
{
  const adminDialog =
    read("client/src/components/qualification/AdminReviewDialog.tsx") ?? "";
  const buttonHasUnderstandingLabel =
    /<button[^>]*data-pdf-action[^>]*>[\s\S]*?(Clinician Understanding|Patient Understanding)[\s\S]*?<\/button>/.test(
      adminDialog,
    );
  if (buttonHasUnderstandingLabel) {
    failures.push(
      'Admin Review top-right PDF/action button must not be labeled "Clinician Understanding" or "Patient Understanding"',
    );
  }
  // Legacy testId should be gone so QA tools cannot click it by mistake.
  if (adminDialog.includes('data-testid="admin-review-pdf-preview-button-patient"')) {
    failures.push(
      'Admin Review top-right PDF button must use -plexus testId, not the legacy -patient testId',
    );
  }
}

// Canonical qualifying factors must render as removable chips inside the
// canonical reasoning card so the admin can selectively delete any factor.
const adminReviewDialogChips = "client/src/components/qualification/AdminReviewDialog.tsx";
requireText(adminReviewDialogChips, [
  "admin-review-qualifying-factors-list",
  "admin-review-qualifying-factor-chip",
  "admin-review-remove-qualifying-factor-chip",
  "onRemoveFactor",
  "removeCanonicalQualifyingFactor",
  // Authoritative floor sent on every regenerate request.
  "priorQualifyingFactorsByTest",
]);

// Admin Review removal controls.
const adminReviewDialogRemovals = "client/src/components/qualification/AdminReviewDialog.tsx";
requireText(adminReviewDialogRemovals, [
  // Generic remove + per-bar variants.
  "admin-review-remove-qualifying-factor",
  "admin-review-remove-brainwave-factor",
  "admin-review-remove-vitalwave-factor",
  "admin-review-remove-ultrasound-parent-factor",
  "admin-review-remove-ultrasound-child-factor",
  // Whole-ancillary remove + per-ancillary variants.
  "admin-review-remove-ancillary",
  "admin-review-remove-brainwave",
  "admin-review-remove-vitalwave",
  "admin-review-remove-ultrasound-parent",
  // Ultrasound child dropdown + remove.
  "admin-review-ultrasound-child-dropdown",
  "admin-review-ultrasound-child-toggle",
  "admin-review-ultrasound-child-body",
  "admin-review-remove-ultrasound-test",
  "admin-review-remove-ultrasound-child",
]);

// Merged qualifying chips — closed-bar source of truth + premium
// per-kind/per-origin testIds + canonical removal markers + unified
// merge helpers + regenerate source markers.
requireText("client/src/components/qualification/AdminReviewDialog.tsx", [
  // Merge helpers + source markers.
  "getMergedQualifyingChipsForAncillary",
  "getMergedQualifyingChipsForUltrasoundParent",
  "getMergedQualifyingChipsForTest",
  "handleRemoveMergedChip",
  "Merged qualifying chips are the Admin Review bar source of truth",
  "Canonical qualifying_factors are converted to bar chips",
  "Closed bars render merged qualifying chips",
  // Origin-aware chip testIds.
  "admin-review-canonical-factor-chip",
  "admin-review-closed-bar-factor-chip",
  "admin-review-premium-factor-chip",
  "admin-review-rule-engine-seeded-chip",
  // Kind-aware chip testIds.
  "admin-review-diagnosis-factor-chip",
  "admin-review-medication-factor-chip",
  "admin-review-symptom-factor-chip",
  // Bar chip rows still present.
  "admin-review-ancillary-factor-chip",
  "admin-review-ultrasound-child-factor-chip",
  // Canonical chip removal markers.
  "admin-review-remove-canonical-factor-chip",
  "Remove canonical qualifying factor",
  "Removed factors are excluded from regenerate",
  "Deleting a chip persists to patient.reasoning",
  // Regenerate uses visible merged chips + additive merge contract.
  "Regenerate uses visible qualifying chips",
  "priorQualifyingFactorsByTest",
]);

// Final failure check — must be at the very end so every requireText /
// requireNotText above contributes to the failure list.
if (failures.length) {
  console.error("Plexus IQ interior QA failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Plexus IQ interior QA passed.");
