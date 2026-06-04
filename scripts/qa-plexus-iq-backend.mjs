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
  "baseURL",
  "new OpenAI({",
  "...(baseURL ? { baseURL } : {})",
]);

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
requireText("server/routes/patients.ts", [
  // New remove routes.
  "/api/patient-screenings/:id/admin-review/remove-test",
  "/api/patient-screenings/:id/admin-review/remove-ancillary",
  // Filters by canonical ancillary category + uses qualifyingTests filter.
  "getAncillaryCategory",
  ".filter((t) => !toRemove.has(t))",
  // Per-test metadata cleanup.
  "adminReview:test:",
]);

// Regeneration helper must enforce the additive merge contract.
requireText("server/services/plexusIq/adminReviewAiRegeneration.ts", [
  "Preserve existing qualifying_factors",
  "Do not drop previous qualifying factors",
  "mergedQualifyingFactors",
  "selected support buttons",
  "existingReasoning",
  "qualifying_factors",
  "Do not reintroduce explicitly removed qualifying factors",
  "Selected support buttons are the active qualifying support layer",
]);

if (failures.length) {
  console.error("Plexus IQ backend QA failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Plexus IQ backend QA passed.");
