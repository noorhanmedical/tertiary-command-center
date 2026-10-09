# Ancillary Documents patient identity review

Base: `deploy/plexus-staging-current`, commit `85c04b66dcc201ab6e115c46d394d7494253fc6c`.

## Existing behavior and inspected paths

- `client/src/pages/documents.tsx`: Clinic → Patient → Document groups generated notes by screening ID and intentionally omits DOB, MRN, and Plexus ID.
- `shared/schema/notes.ts`, `server/repositories/notes.repo.ts`, `server/routes/generatedNotes.ts`: generated-note `patientId` references `patient_screenings.id`; the global GET previously returned an unrestricted legacy list.
- `shared/schema/screening.ts`, `shared/schema/plexusIdentity.ts`, `server/services/plexusIdentity/screeningIntegration.ts`: screening rows carry explicit global patient and clinic membership foreign keys. Clinic MRN belongs to the membership; Plexus ID and canonical DOB belong to the global patient. Resolution/ingestion creates these links, so a document read must not run resolution again.
- `server/lib/tenantContext.ts`, `server/middleware/accessControl.ts`, `server/services/plexusIdentity/authorization.ts`: tenant scope comes from the authenticated session; platform scope is explicit. The Plexus identity review boundary remains unchanged; no global identity search or match-review API is added.
- `server/routes/ancillaryDocuments.ts`, `server/services/ancillaryDocuments/documentProjection.ts`, `shared/schema/ancillaryDocuments.ts`, `shared/schema/ancillaryCases.ts`: canonical reference reads already enforce clinic ownership and preserve signed/historical reference metadata.

## Result

The legacy list now enforces `document.view` through the existing permission middleware and fails closed without a valid tenant. It checks note → screening batch and clinic ownership before returning demographics. Missing or contradictory screening associations are omitted, without reassignment or repair writes.

Both UI branches display a read-only patient identity summary. Existing screening MRN/DOB can be displayed when no canonical link exists; Plexus ID is never derived from a screening key or generated client-side. With a canonical link, membership clinic, global patient, and active statuses must agree. Contradictory, inactive, merged, or possible-duplicate links yield no identifiers. Merged identities require a verified updated clinic link rather than an inferred cross-clinic replacement.

Canonical references additionally require agreement with their owning ancillary case's global patient and clinic membership. A stale reference retains its document metadata/status but displays identity unavailable. The feature-off canonical contract still performs zero document/identity reads.

The Clinic → Patient → Document layout, screening keys used for selections/actions, document bodies, download authorization, generation, signing, and mutation handlers are preserved. No patient creation, merges, document rewriting, migrations, feature activation, or deployment occurs in this change.

## Validation

- `tests/unit/ancillaryDocumentPatientIdentity.test.ts`: explicit-key identity projection; same-name patients remain separate through route and workspace model; missing identifiers; unlinked screening demographics; cross-clinic reads; mismatched note batch/clinic; inconsistent canonical reference global identity; inactive/merged membership handling; unchanged signed status/content; read-only DB calls.
- Existing suites: `ancillaryDocumentsRoutes.test.ts`, `ancillaryDocumentsPaginationAndSourceSafety.test.ts`, `clinicalDocumentImmutability.test.ts`.
- TypeScript check with an 8 GB Node heap (the default 2 GB heap ran out of memory).
- Production client/server build.
- Live database and browser session checks were not run: no authenticated database/application environment was supplied. In particular, migration availability and existing data quality still need environment verification before merge/deployment.

## Review and rollback

This is an additive response field and a read-only identity join using existing identity tables. A database lacking the existing identity schema produces a controlled load failure; it does not fall back to unrestricted records or fabricated IDs. Legacy reads with stale note associations now exclude those notes, which is an intentional safety change reviewers should assess against real data.

Permission enforcement retains the middleware's existing feature-off legacy behavior; enabling enforcement requires `document.view`. Tenant validation always applies to the enriched legacy list. No unrelated legacy read/mutation endpoints are migrated by this slice.

Revert this commit to restore the prior display/read contract. No data rollback is needed because the implementation contains no data writes.
