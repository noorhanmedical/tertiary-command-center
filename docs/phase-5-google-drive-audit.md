# Phase 5 — Google Drive audit & keep/remove recommendation

**Scope.** Every file that references Google Drive on `main` was
grepped, classified, and cross-checked against the production storage
policy (`STORAGE_PROVIDER=s3` enforced in `server/lib/validateEnv.ts`
for `NODE_ENV=production`).

## Files that reference Google Drive

| File | Role | Recommendation |
|------|------|----------------|
| `server/integrations/googleDriveFileStorage.ts` | Storage adapter implementing the FileStorage interface for the Google Drive backend | **Keep** — used when `STORAGE_PROVIDER=google_drive` (dev/Replit default) |
| `server/integrations/googleDrive.ts` | Drive API client (folder scoping, oauth token refresh, list/upload/download) | **Keep** — required by googleDriveFileStorage.ts and the sync services |
| `server/integrations/fileStorage.ts` | Runtime provider resolver (`google_drive` or `s3`) | **Keep** — the switch point that lets production run on S3 while dev keeps Drive |
| `server/integrations/googleSheets.ts` | Sheets export used for staff-facing exports | **Keep** — independent of file storage; sheet-driven workflows are still active |
| `server/services/outbox.ts` | Outbox queue for asynchronous Drive file writes | **Keep** — decouples request path from Drive latency; also queues S3 writes |
| `server/services/syncService.ts` | Drive sync scheduler | **Keep** — pushes local blob writes to Drive when Drive is the active provider |
| `server/routes/google.ts` | `/api/google/*` diagnostic endpoints for Drive/Sheets health | **Keep** — used by the admin diagnostics screen (`admin/health` page) |
| `server/routes/documentLibrary.ts` | `driveWebViewLink` fallback for legacy uploaded_documents rows | **Keep** — preserves access to already-uploaded legacy files. Removing would break historical document reads. |
| `server/routes/patientDatabase.ts` | Similar legacy Drive fallback | **Keep** — same reason as documentLibrary |
| `server/routes/testFixture.ts` | Test fixture uploader that writes to Drive when Drive is active | **Keep** — deterministic test fixtures require the same code path they'll take in prod |
| `server/lib/validateEnv.ts` | Rejects `STORAGE_PROVIDER=google_drive` when `NODE_ENV=production` (production must be S3) | **Keep** — the safety net |
| `server/storage.ts` | Facade methods that shell out to Drive for legacy uploaded_documents access | **Keep** — behavioral shim so legacy code paths keep working during migration |
| `server/repositories/notes.repo.ts` | Note attachments Drive path | **Keep** — Drive is the current attachment backend for notes |
| `shared/schema/notes.ts`, `shared/schema/documents.ts` | Columns `driveWebViewLink`, `driveFileId` on the two tables | **Keep** — historical rows already populate these; column drop would require a destructive migration |

## Overall recommendation

**Keep Google Drive integration on `main`.**

Rationale:

1. **Production is already S3.** `validateEnv.ts` fails startup at
   line 74 if `NODE_ENV=production` and `STORAGE_PROVIDER!==s3`.
   The Drive code paths are dormant in prod today.
2. **Development and Replit still run on Drive.** Removing Drive would
   break the local dev experience and the Replit sync workflow
   without a corresponding S3 credential rollout.
3. **Legacy rows carry `driveWebViewLink`.** Removing the fallback
   would break access to already-uploaded files that were written
   before the S3 migration. Both `documentLibrary.ts` and
   `patientDatabase.ts` intentionally fall back to the Drive link
   when the blob store lacks bytes.
4. **The abstraction is clean.** `server/integrations/fileStorage.ts`
   is a single provider-resolver. When it is safe to drop Drive, the
   change is: `resolveStorageProvider()` always returns `"s3"`, then
   the Drive-specific files can be deleted in one pass. Doing that
   now, before all legacy rows are migrated, would break reads.

## Removal plan (for a future PR — NOT this PR)

1. Backfill script that S3-imports every legacy `driveWebViewLink`
   row so the fallback becomes dead code.
2. Instrumentation: log any read path that still resolves to a Drive
   link; keep for one release cycle.
3. When the Drive fallback log stays silent for a full release cycle,
   delete the Drive integration files, the fallback branches in
   documentLibrary/patientDatabase, and the `drive*` columns.
4. Drop the `googleDrive` provider case from
   `server/integrations/fileStorage.ts` and simplify `validateEnv.ts`
   to unconditionally require the S3 env vars.

Doing this before the backfill is complete would silently regress
legacy file access.
