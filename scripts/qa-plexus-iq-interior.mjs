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
  "PlexusIQDashboardRow",
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
// dashboard layout we just replaced.
requireText(page, [
  "PlexusIQDashboardRow",
]);
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
  // Supporting Item Library sections.
  "admin-review-evidence-library",
  "admin-review-evidence-library-dx",
  "admin-review-evidence-library-meds",
  "admin-review-evidence-library-hx",
  "admin-review-evidence-library-prior",
  // Buttons in the library.
  "admin-review-icd-disease-button",
  "admin-review-icd-disease-assigned",
  "admin-review-icd-disease-needed",
  "admin-review-med-button",
  "admin-review-hx-button",
  "admin-review-prior-button",
  // Assignment controls.
  "admin-review-assign-evidence",
  "admin-review-assign-brainwave",
  "admin-review-assign-vitalwave",
  "admin-review-assign-ultrasound",
  "admin-review-assign-all",
  "admin-review-unassign-supporting-item",
  // Colored ancillary panels.
  "admin-review-ancillary-colored-panel",
  "admin-review-ancillary-services-list",
  "admin-review-ancillary-supporting-list",
  "admin-review-ancillary-header-supporting-items",
  "admin-review-ancillary-header-chip",
  "admin-review-ancillary-expanded",
  // Per-ancillary regenerate.
  "admin-review-regenerate-ancillary",
  "admin-review-regenerate-brainwave",
  "admin-review-regenerate-vitalwave",
  "admin-review-regenerate-ultrasound",
  // AI ICD search section.
  "admin-review-add-icd-section",
  "admin-review-icd-ai-search",
  "admin-review-icd-ai-search-button",
  "admin-review-icd-ai-search-result",
  "admin-review-icd-ai-search-loading",
  "admin-review-icd-ai-search-empty",
  // Manual ICD entry kept as backup.
  "admin-review-icd-manual-code",
  "admin-review-icd-manual-label",
  "admin-review-icd-add",
  "admin-review-icd-remove",
  // Canonical reasoning binding (still required).
  "admin-review-canonical-reasoning-card",
  "buildCanonicalReasoningByAncillary",
  "clinician_understanding",
  "patient_talking_points",
  "qualifying_factors",
  "icd10_codes",
  "pearls",
  // Under-16 + library/PDF essentials.
  "admin-review-under-16-rule",
  "badge-admin-review-under-16",
  "PatientPdfActions",
  "buildLocalEvidenceFallback",
  "BrainWave",
  "VitalWave",
  "Ultrasound Studies",
]);

// Old per-mode / single global regenerate buttons must be gone — per-ancillary
// regenerate is now the only regenerate model. Also ban old "tests · " count
// phrasing and the prefilled-on-empty ICD search bug.
requireNotText(
  "client/src/components/qualification/AdminReviewDialog.tsx",
  [
    "admin-review-regenerate-clinician",
    "admin-review-regenerate-patient",
    "admin-review-regenerate-all",
    "admin-review-global-regenerate",
    "tests ·",
    "qualifying tests",
    "if (!q) return all.slice(0, 6)",
  ],
  "AdminReviewDialog must use per-ancillary regenerate and have no count copy",
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

if (failures.length) {
  console.error("Plexus IQ interior QA failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Plexus IQ interior QA passed.");
