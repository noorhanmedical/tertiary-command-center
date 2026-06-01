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
]);

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

if (failures.length) {
  console.error("Plexus IQ backend QA failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Plexus IQ backend QA passed.");
