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

const routesEntry = "server/routes.ts";
const patientsRoute = "server/routes/patients.ts";
const clinicalImportRoute = "server/routes/plexusIqClinicalImport.ts";
const screeningRepo = "server/repositories/screening.repo.ts";
const screeningSchema = "shared/schema/screening.ts";
const storageFacade = "server/storage.ts";
const batchRunner = "server/services/batchAnalysisRunner.ts";
const clinicalImportApi = "client/src/lib/plexusIqClinicalImportApi.ts";

// 1. New server route file exists.
requireFile(clinicalImportRoute);
requireFile(batchRunner);

// 2. Route registration must mount:
//    - the clinical-import + qualification-job endpoints (via the new
//      registerPlexusIqClinicalImportRoutes hub)
//    - the recently-deleted + restore endpoints (added directly to
//      registerPatientRoutes)
requireText(routesEntry, [
  "registerPlexusIqClinicalImportRoutes",
  'from "./routes/plexusIqClinicalImport"',
  "registerPlexusIqClinicalImportRoutes(app)",
]);

requireText(clinicalImportRoute, [
  '"/api/plexus-iq/clinical-import"',
  '"/api/plexus-iq/qualification-jobs"',
  '"/api/plexus-iq/qualification-jobs/:jobId/status"',
  '"/api/plexus-iq/qualification-jobs/:jobId/retry-failed"',
  "registerPlexusIqClinicalImportRoutes",
]);

requireText(patientsRoute, [
  '"/api/patient-screenings/recently-deleted"',
  '"/api/patient-screenings/:id/restore"',
  "listRecentlyDeletedPatientScreenings",
  "getPatientScreeningIncludingDeleted",
  "restorePatientScreening",
  // Canonical Admin Review regeneration must write patient.reasoning[testName]
  // and use storage.updatePatientScreening; supplemental adminReview metadata
  // may also be set, but is not the sole output.
  "/api/patient-screenings/:id/admin-review/regenerate-all",
  "regenerateCanonicalReasoning",
  "reasoning",
  "updatePatientScreening",
  "adminReview:",
  // Per-ancillary regenerate + AI ICD search wiring.
  "/api/patient-screenings/:id/admin-review/regenerate-ancillary",
  "/api/patient-screenings/:id/admin-review/icd-search",
  "searchAdminReviewIcdCodes",
  "@shared/ancillaryCategory",
  // Per-test regenerate route.
  "/api/patient-screenings/:id/admin-review/regenerate-test",
  "qualifyingTests: [testName]",
  "adminReview:test:",
  // ICD search structured error envelope (no leaking keys/PHI).
  "OpenAI universal ICD search failed",
  "hasAIIntegrationsKey",
  "hasOpenAIKey",
  "hasBaseUrl",
]);

// AI ICD search service: universal search, Responses API + strict json_schema,
// baseURL support, explicit error messages, prefers AI_INTEGRATIONS_OPENAI_API_KEY.
requireText("server/services/plexusIq/adminReviewIcdSearch.ts", [
  "searchAdminReviewIcdCodes",
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "OPENAI_API_KEY",
  "AI_INTEGRATIONS_OPENAI_BASE_URL",
  "client.responses.create",
  "json_schema",
  // Universal-search prompt language.
  "universal ICD-10-CM search",
  "full ICD-10-CM code universe",
  "Do not limit results to the patient chart",
  "patient context is optional",
  // Structured errors.
  "ICD search requires AI_INTEGRATIONS_OPENAI_API_KEY or OPENAI_API_KEY",
  "OpenAI universal ICD search failed",
  "OpenAI universal ICD search returned invalid JSON",
]);

// Admin Review regeneration service must also honour the Replit base URL.
// Both regenerate functions construct their OpenAI client the same way.
requireText("server/services/plexusIq/adminReviewAiRegeneration.ts", [
  "AI_INTEGRATIONS_OPENAI_BASE_URL",
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "OPENAI_API_KEY",
  "baseURL",
  "new OpenAI({",
  "...(baseURL ? { baseURL } : {})",
  // The canonical regenerate fan-out + additive merge contract.
  "regenerateCanonicalReasoning",
  "priorQualifyingFactorsByTest",
  "removedFactorsByTest",
  "selectedSupportButtonsByTest",
  "mergedQualifyingFactors",
]);

// Regenerate routes must accept the merged-chip payload shape that
// the dialog sends today: priorQualifyingFactorsByTest, removedFactors
// (per-ancillary), and assignedEvidence.
requireText("server/routes/patients.ts", [
  "/api/patient-screenings/:id/admin-review/regenerate-ancillary",
  "/api/patient-screenings/:id/admin-review/regenerate-test",
  "priorQualifyingFactorsByTest",
  "removedFactorsByTest",
  "selectedSupportButtonsByTest",
  "regenerateCanonicalReasoning",
]);

// Admin Review approval must trigger the canonical scheduler routing
// runtime (commitPatient → execution-case spine →
// autoAssignSchedulerForExecutionCase). Source markers + the
// commitPatient call site live on the admin-approval route. The
// route also reads Scheduler Settings (canonical source =
// outreach_schedulers table managed by the Settings page) via
// the lookupSchedulerFromSettings helper.
requireText("server/routes/patients.ts", [
  "/api/patient-screenings/:id/admin-approval",
  "Admin Review approval triggers scheduler routing",
  "Admin Review approval reads Scheduler Settings",
  "Scheduler Settings drive Engagement assignment",
  "Scheduler settings lookup",
  "Scheduler settings fallback is Unassigned Engagement Queue",
  "Engagement assignment creation/update",
  "Engagement Center source of truth",
  "Scheduler assignment runtime",
  "commitPatient(id, userId, { auto: true })",
  "lookupSchedulerFromSettings",
  "routedToEngagement",
  "routedSchedulerName",
  "routedSchedulerSettingsSource",
  "routedByScheduledSettings",
]);

// Scheduler Settings helper — the lookup that surfaces the
// canonical outreach_schedulers row matching the patient's
// facility. Used by the admin-approval route so the chain
// admin-approval → settings lookup → commit → auto-assign is
// explicit.
requireText("server/services/schedulerSettings.ts", [
  "lookupSchedulerFromSettings",
  "getOutreachSchedulers",
  "outreach-schedulers-table",
  "Scheduler Settings drive Engagement assignment",
  "Engagement Center uses assigned scheduler from scheduler settings",
  "Scheduler settings fallback is Unassigned Engagement Queue",
  "Scheduler settings source missing; using current scheduler runtime fallback",
]);

// Scheduler routing runtime contract — execution case spine + auto-
// assign helper called from commitPatient.
requireText("server/services/patientCommitService.ts", [
  "createOrUpdateExecutionCaseFromScreening",
  "autoAssignSchedulerForExecutionCase",
]);
requireText("server/services/schedulerAutoAssign.ts", [
  "autoAssignSchedulerForExecutionCase",
  "patientExecutionCases",
  "outreach_schedulers",
]);

// BatchFlow Phone / Email persistence: parser extracts both,
// backend schema accepts both, insert writes both into
// patient_screenings.phoneNumber + patient_screenings.email.
requireText("client/src/lib/plexusIqClinicalImportParser.ts", [
  "BatchFlow parses Phone column",
  "BatchFlow parses Email column",
  '"PHONE"',
  '"EMAIL"',
  '["phone", "phone number", "mobile", "cell", "contact number"]',
  '["email", "email address"]',
]);
requireText("server/routes/plexusIqClinicalImport.ts", [
  "BatchFlow imports phone and email into patient records",
  "phone: z.string().optional()",
  "email: z.string().optional()",
  "phoneNumber: r.phone?.trim() || null",
  "email: r.email?.trim() || null",
]);
// patient_screenings columns must exist for phone + email.
requireText("shared/schema/screening.ts", [
  "phoneNumber",
  "email",
  "phone_number",
]);

// PDFs render full patient demographics under the patient name
// (DOB / age / sex / phone / email / insurance / facility) in BOTH
// Plexus and Clinician packets. Schedule date is intentionally NOT
// rendered in the demographics block — it lives in the page header
// only — so the contract here both asserts the present fields and
// forbids the dropped "Schedule Date:" line in the demo block.
// Clinical text (Hx / Dx / Rx) wraps and paginates instead of
// clipping. PDF generation uses html2pdf so the browser print-dialog
// "about:blank" URL footer never appears in the saved file.
requireText("client/src/lib/pdfGeneration.ts", [
  "buildPatientDemoBlock",
  "Phone:",
  "Email:",
  "DOB:",
  "Age:",
  "Sex:",
  "Insurance:",
  "Facility:",
  "phoneNumber",
  "email",
  "page-break-inside",
  "html2pdf",
  "Plexus PDF renders demographics under patient name",
  "Clinician PDF renders demographics under patient name",
  "PDF demographics include phone and email",
  "PDF demographics omit schedule date",
  "Plexus PDF does not cut off Hx Dx Rx",
  "Clinician PDF does not cut off Hx Dx Rx",
  "PDF clinical text wraps and paginates",
  "PDF footer does not render about blank",
  // Layout + speed pass markers.
  "Clinician PDF header uses stable two-column alignment",
  "Clinician PDF demographics do not overlap chart review",
  "Clinician PDF chart review has safe spacing",
  "Clinician PDF ancillary columns align cleanly",
  "Clinician PDF test rows have stable checkbox title alignment",
  "PDF export uses optimized html2canvas scale",
  "PDF template avoids expensive visual effects",
  "PDF generation optimized for large packets",
  // Print-preview path for Plexus IQ multi-patient packets. The
  // canonical html2pdf path is kept (asserted above) — this is a
  // parallel popup-based surface used only by Plexus IQ packet
  // buttons today.
  "openPatientPacketPrintPreview",
  "openSchedulerPacketPrintPreview",
  "buildClinicianPdfBody",
  "buildPlexusPdfBody",
  "Plexus IQ packet print preview avoids html2canvas",
  "Plexus IQ packet print preview opens printable popup",
  "Plexus IQ packet print preview hides toolbar when printing",
  "html2pdf retained as fallback outside Plexus IQ packet preview",
  // Global print-preview architecture markers — every multi-patient
  // packet flow uses these helpers now (Plexus IQ, Admin Review,
  // Engagement Center Date/Facility/Scheduler). The html2pdf
  // helpers stay for simple non-packet exports.
  "Packet print preview replaces html2pdf for multi-patient packets",
  "Packet print preview avoids html2canvas for patient packets",
  "Packet print preview opens one printable window",
  "Packet print preview hides toolbar when printing",
  "html2pdf retained only for simple non-packet exports",
  // Scheduler call-list one-popup grouped surface lives in the same
  // file; the helper assembles ONE preview body with sections per
  // facility/date instead of N download streams.
  "Scheduler call-list packets use print preview",
  "Scheduler call-list print preview groups by facility date",
  "Scheduler call-list print preview avoids forced multi-downloads",
  "Scheduler call-list print preview avoids html2canvas",
  // Popup HTML testIds — asserted as raw strings so the popup
  // surface stays detectable.
  "packet-print-preview-window",
  "packet-print-preview-print-button",
  "packet-print-preview-close-button",
]);

// "Schedule Date:" must not appear anywhere in the demographics
// block (it lives only in the page header). Locate the function and
// scan its body specifically so a future template change can't
// silently reintroduce the line.
{
  const pdfSource = read("client/src/lib/pdfGeneration.ts") ?? "";
  const demoBlockMatch = pdfSource.match(
    /export function buildPatientDemoBlock[\s\S]*?\n\}/,
  );
  if (!demoBlockMatch) {
    failures.push(
      "Could not locate buildPatientDemoBlock in pdfGeneration.ts to verify demographics contract",
    );
  } else if (demoBlockMatch[0].includes("Schedule Date:")) {
    failures.push(
      'buildPatientDemoBlock must NOT render "Schedule Date:" — that lives in the page header now',
    );
  }
}
// Forbid the broken footer copy in any PDF template.
{
  const pdfSource = read("client/src/lib/pdfGeneration.ts") ?? "";
  for (const banned of [
    "about undefined",
    "about null",
    "about [blank]",
    "about ${",
  ]) {
    if (pdfSource.includes(banned)) {
      failures.push(
        `pdfGeneration.ts must not render "${banned}" anywhere in the template`,
      );
    }
  }
  // Drop the legacy overflow:hidden on the Clinician .page container.
  if (pdfSource.includes('overflow:hidden;">')) {
    failures.push(
      'pdfGeneration.ts must not use overflow:hidden on the Clinician .page container — it clips Hx/Dx/Rx',
    );
  }
}

// PDFs must NOT render ICD codes anywhere in their HTML output.
// The data type may still include icd10_codes (kept for Admin Review +
// canonical patient.reasoning[testName] consumers) — only the render
// must be absent from PDF output.
requireText("client/src/lib/pdfGeneration.ts", ["icd10_codes"]);
{
  const pdfContent = fs.readFileSync(
    path.join(root, "client/src/lib/pdfGeneration.ts"),
    "utf8",
  );
  for (const banned of [
    "icd10Pills",
    "renderIcd10Pills",
    "ICD-10 Codes",
    "ICD Codes</",
  ]) {
    if (pdfContent.includes(banned)) {
      failures.push(
        `pdfGeneration.ts must not render ICD codes; found "${banned}"`,
      );
    }
  }
}

// 3. Schema must declare the soft-delete fields. Drizzle column names
//    on the JS side are camelCase; the SQL/migration uses snake_case.
requireText(screeningSchema, [
  "deletedAt",
  "deletedByUserId",
  "deleteExpiresAt",
  "deleteReason",
  "deleted_at",
  "delete_expires_at",
  "delete_reason",
]);

// 4. Repository must expose the soft-delete contract used by the
//    routes, and existing reads must filter ACTIVE so soft-deleted
//    rows are hidden from normal workspace queries.
requireText(screeningRepo, [
  "const ACTIVE = isNull(patientScreenings.deletedAt)",
  "getScreeningIncludingDeleted",
  "restoreScreening",
  "listRecentlyDeletedScreenings",
  "softDeleteExpiresAt",
]);

// 5. Storage facade must expose the same surface.
requireText(storageFacade, [
  "getPatientScreeningIncludingDeleted",
  "restorePatientScreening",
  "listRecentlyDeletedPatientScreenings",
]);

// 6. Frontend API helper (already on main) must point at the same
//    endpoint strings the backend now serves, so the wire contract
//    matches end-to-end.
requireText(clinicalImportApi, [
  "/api/plexus-iq/clinical-import",
  "/api/plexus-iq/qualification-jobs",
  "/api/plexus-iq/qualification-jobs/${jobId}/status",
  "/api/plexus-iq/qualification-jobs/${jobId}/retry-failed",
]);

// 7. Soft-delete migration must exist.
const migrationsDir = path.join(root, "migrations");
let foundSoftDeleteMigration = false;
if (fs.existsSync(migrationsDir)) {
  for (const file of fs.readdirSync(migrationsDir)) {
    if (!file.endsWith(".sql")) continue;
    const content = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    if (
      content.includes("delete_expires_at") &&
      content.includes("delete_reason") &&
      content.includes("ADD COLUMN")
    ) {
      foundSoftDeleteMigration = true;
      break;
    }
  }
}
if (!foundSoftDeleteMigration) {
  failures.push(
    "Missing soft-delete migration in migrations/ — expected an ALTER TABLE patient_screenings that adds delete_expires_at, delete_reason, deleted_at, deleted_by_user_id",
  );
}

// 8. Global shell/sidebar/banner/home presentation must not have been
//    edited in this backend pass. (The QA only verifies that the
//    expected client-side files were not replaced wholesale; full
//    diff-guarding belongs in the architecture QA.)
const forbiddenClientPaths = [
  "client/src/components/GlobalNav.tsx",
  "client/src/components/TopBanner.tsx",
  "client/src/pages/home.tsx",
  "client/src/components/HomeDashboard.tsx",
];
for (const rel of forbiddenClientPaths) {
  // The files must still exist (we didn't delete them).
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures.push(`Untouched-by-design file is missing: ${rel}`);
  }
}

// ─── Admin Review removal routes + additive merge prompt ─────────────
//
// After Batch 3b.6, the remove handlers are wrapped by
// adminReviewRemoveService.ts; the route only registers the paths and
// delegates. The structural contract (filter on qualifyingTests +
// getAncillaryCategory, plus selective metadata deletion that preserves
// canonical reasoning[testName]) now lives in the service.
requireText("server/routes/patients.ts", [
  // New remove routes — still registered in the route file.
  "/api/patient-screenings/:id/admin-review/remove-test",
  "/api/patient-screenings/:id/admin-review/remove-ancillary",
  // Route delegates to the remove service.
  "adminReviewRemoveService",
  // Per-test metadata literal still present in the route file via the
  // still-inline regenerate-test handler.
  "adminReview:test:",
]);

requireText(
  "server/services/plexusIq/adminReviewRemoveService.ts",
  [
    // Filters by canonical ancillary category + uses qualifyingTests filter.
    "getAncillaryCategory",
    ".filter((t) => !toRemove.has(t))",
    // Selective metadata deletion (the canonical-reasoning preservation
    // invariant: only adminReview:* keys are deleted; reasoning[testName]
    // is never deleted).
    "adminReview:test:",
    "adminReview:${ancillaryId}",
    "removedTestName",
    "removedTests",
  ],
);

// Regeneration helper must enforce the additive merge contract AND
// honour the client-supplied authoritative floor.
requireText("server/services/plexusIq/adminReviewAiRegeneration.ts", [
  "Preserve existing qualifying_factors",
  "Do not drop previous qualifying factors",
  "mergedQualifyingFactors",
  "selected support buttons",
  "existingReasoning",
  "qualifying_factors",
  "Do not reintroduce explicitly removed qualifying factors",
  "Selected support buttons are the active qualifying support layer",
  "priorQualifyingFactorsByTest",
  "priorByTest",
]);

// Routes must forward priorQualifyingFactorsByTest from request body to the
// AI service for all three regenerate endpoints.
requireText("server/routes/patients.ts", [
  "priorQualifyingFactorsByTest",
]);

// Rule engine: meds do NOT auto-create diagnoses; venous /
// arterial / carotid / echo per-test ultrasound support helpers;
// suggestions are inactive until accepted; missing ICD does not
// block chip placement.
requireText("shared/plexus-iq/adminReviewEvidence.ts", [
  "isVenousUltrasoundTest",
  "isArterialUltrasoundTest",
  "isCarotidUltrasoundTest",
  "isEchoUltrasoundTest",
  "evidenceForUltrasoundTest",
  "AdminDiagnosisSuggestion",
  "COMMON_MEDICATION_SUGGESTIONS",
  "venous",
  "edema",
  "hypertension",
  "hyperlipidemia",
  "diabetes",
  "metformin",
  "amlodipine",
  "rosuvastatin",
  "Medications do not auto-create diagnoses",
  "Medication-derived diagnosis suggestions are inactive until accepted",
  "requiresIcd does not block chip placement",
]);

// Rule-engine runner entrypoint must keep using the shared builder so
// route handlers receive the new suggestions payload alongside
// evidence + candidates.
requireText("server/services/plexusIq/adminReviewRuleEngine.ts", [
  "buildAdminReviewEvidence",
  "AdminReviewRuleResult",
]);

if (failures.length) {
  console.error("Plexus IQ backend QA failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Plexus IQ backend QA passed.");
