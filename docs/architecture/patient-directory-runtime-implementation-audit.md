# Patient Directory runtime implementation audit

**Status:** Docs+QA (Batch B3 of duplicate-warning runtime feature branch).
**Companion:** `scripts/qa-patient-directory-runtime-implementation-audit.mjs`.

Patient Directory source-of-truth ownership is already established by
Phase 1 (see [[team-portal-patient-directory-wiring-contract]] and
[[phase-1-canonical-id-registry]]). This batch does NOT re-decide
ownership; it maps what's actually persisted today and where the
runtime gaps are so subsequent batches stay grounded.

## What today's schema persists per patient

| Patient Directory concern | Today's table.field | Coverage |
|---|---|---|
| Identity name / DOB / phone | `patient_screenings.name / dob / phoneNumber` | FULL |
| Identity email | `patient_screenings.email` | FULL |
| Facility | `patient_screenings.facility` | FULL |
| MRN | _not persisted as a dedicated column_ | **GAP** (see Batch B4 below — matching tier 1 falls back to tier 2 / 3 until added) |
| Insurance | `patient_screenings.insurance` | FULL |
| Patient type (visit / outreach) | `patient_screenings.patientType` | FULL |
| Admin Review state | `patient_screenings.adminApprovalStatus` + `adminApprovedAt` + `adminApprovedByUserId` + `adminApprovalNote` | FULL |
| Soft delete / restore | `patient_screenings.deletedAt / deletedByUserId / deleteExpiresAt / deleteReason` | FULL |
| Engagement assignment | `scheduler_assignments` | FULL |
| Execution case | `patient_execution_cases` | FULL |
| Call history | `outreach_calls` | FULL |
| Cooldown | `cooldown_records` | FULL |
| Journey events | `patient_journey_events` | FULL |
| Procedure events | `procedure_events` | FULL |
| Prior ancillary tests | `patient_test_history` | FULL |
| Patient reference data | `patient_reference_data` | FULL |
| Documents | `documents` + `document_blobs` | FULL |
| Audit log | `audit_log` | FULL |
| Batch / source upload | `screening_batches` (`name`, `createdAt`) | PARTIAL — no `sourceFileName` column |

## Implicit DNC + cooldown today

| Concern | Source today | Strength |
|---|---|---|
| DNC (explicit flag on patient) | _not persisted as a dedicated column_ | **GAP** — derivable from `outreach_calls.outcome IN ('refused_dnc')`, but no per-patient cleared/audit |
| Active cooldown | `cooldown_records` | FULL — has start/end + reason |
| Last contact restriction set by user | `audit_log` (free-form) | PARTIAL |

DNC enforcement at runtime today happens implicitly via the
`refused_dnc` call outcome rather than a per-patient flag. The Batch
B13 helper will treat both signals as authoritative inputs to the
warning engine.

## What Patient Directory routes / components exist today

| Surface | Path | State |
|---|---|---|
| Patient Directory view (legacy import + search) | `client/src/components/PatientDirectoryView.tsx` | EXISTS — used by `patient-database.tsx` |
| Patient Directory page | `client/src/pages/patient-database.tsx` | EXISTS |
| Patient Directory backend routes | `server/routes/patientDatabase.ts`, `server/routes/patientReferences.ts`, `server/routes/testHistory.ts` | EXIST |
| Patient Directory bulk import | inline in `PatientDirectoryView.tsx` | EXISTS — paste + file path |
| Patient Profile drawer | _not yet present_ | **GAP** — Batch B11 scaffold |
| Patient Audit Trail modal | _not yet present_ | **GAP** — Batch B10 scaffold |
| Run comparison selector | _not yet present_ | **GAP** — Batch B6 |
| Duplicate-warning badges | _not yet present_ | **GAP** — Batches B7–B9 |
| Packet patient selection dialog | _not yet present_ | **GAP** — Batch B15 |

## Runtime gaps that can be closed without migration

- Duplicate-warning engine (pure module — see Batch B5).
- Run comparison + selector UI (pure — Batches B2/B6).
- Audit Trail modal (consumes existing tables via existing routes;
  Batch B10 lets it accept caller-provided entries when an audit
  endpoint is not yet wired).
- PDF/packet patient selection dialog (pure UI — Batch B15).
- DNC / cooldown warning helper (uses the existing `cooldown_records`
  table + the implicit `refused_dnc` signal; Batch B13).
- Prior-ancillary-history warning (uses the existing
  `patient_test_history` table; Batch B14).
- Identity helper (Batch B1) — already landed.
- Qualification run ordering (Batch B2) — already landed.

## Gaps that require schema work (deferred — Batch B4 produces a
   plan; this branch does NOT add migrations)

1. **`patient_screenings.mrn`** — adding a dedicated `mrn text` column
   would let identity tier 1 (facility + MRN + DOB) cover the cases
   where the batch importer happens to carry an MRN field. Today
   tier 2 (MRN+DOB) can still match if a caller passes an `mrn`
   value, but no row stores one.
2. **`patient_screenings.doNotContact`** + **`doNotContactSetAt`** +
   **`doNotContactReason`** — explicit DNC flag avoids depending on
   the call outcome heuristic.
3. **`screening_batches.sourceFileName`** + **`sourceImporterUserId`**
   — currently the importer stores the file in the upload step but
   the per-batch row only remembers `name`.
4. **`patient_directory_events`** (NEW) — a dedicated event table
   would let the Audit Trail modal pull from one place instead of
   stitching together `audit_log` + `patient_journey_events` +
   `outreach_calls`. Not required for B10 because the modal accepts
   caller-provided entries.

All four gaps are addressed in this branch by source-level helpers,
client-side stitching, and a deferred migration plan
(`patient-directory-runtime-blockers.md`). The branch does NOT
commit any migration file.

## How subsequent batches consume this audit

- B4 emits a service scaffold that wraps the four primary tables
  (patient_screenings, screening_batches, patient_test_history,
  cooldown_records) and exposes the canonical Patient Directory shape.
- B5 / B7 / B8 / B9 consume the scaffold + identity helper to render
  warnings.
- B10 modal stitches caller-provided + table-backed entries.
- B11 scaffold page renders the stitched view.

## Related contracts

- [[team-portal-patient-directory-wiring-contract]]
- [[phase-1-canonical-id-registry]]
- [[phase-1-status-ownership-registry]]
- [[phase-1-batch-flow-handoff-contract]]
- [[phase-1-plexus-iq-boundary-contract]]
- [[phase-1-admin-review-boundary-contract]]

End of audit.
