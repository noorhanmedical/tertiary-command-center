# Plexus IQ route parity inventory

**Date:** 2026-06-09
**Scope:** READ-ONLY inventory. No source code changed by this doc.
**Purpose:** Lock down byte-identical parity expectations for every Plexus IQ route before any future wrapper or refactor batch touches them.

> Cross-reference: `docs/architecture/backend-route-parity-inventory.md` §3 (the original Plexus IQ section), `docs/architecture/protected-flows.md` §§1–3, `docs/architecture/do-not-touch.md`, `docs/architecture/canonical-workflow-wiring-map.md`.

---

## 0. How this document is used

1. **Every future runtime-touching PR in the Plexus IQ area MUST cite the relevant §-number** from this doc in its description.
2. **The "parity contract for future wrapper" subsection of each route is the contract.** A wrapper that changes any line of that subsection is not parity-preserving and belongs in a different batch.
3. **Wrapper sequence is prescribed.** Lowest-risk routes wrap first. Each subsequent wrap rebuilds on the same pattern that produced the merged Admin Review wrappers (Batches 3b.1–3b.7).

Conventions:

- Routes listed by **method + path**. Source file + line citation.
- Per the do-not-touch list: **`plexusIqClinicalImport.ts`** is one of the most sensitive identity-creation paths in the repo. The bulk insert reconciliation guard at lines ~349–356 must remain intact in every future PR.

---

## 1. `POST /api/plexus-iq/clinical-import` *(plexusIqClinicalImport.ts:177–412)*

- **Purpose:** Bulk-insert patients from a parsed clinical paste. Groups rows by `(facility, scheduleDate)`. One multi-row INSERT per group via Drizzle `.values(inserts).returning()`.
- **Method:** POST.
- **Request inputs (body, Zod-validated):** `rows: ClinicalImportRow[]`, `defaultFacility?: string`, `defaultScheduleDate?: string`, `defaultPatientType?: "visit"|"outreach"`.
- **Response shape:** `{ ok, importedCount, skippedCount, errors: SkipError[], batchIds, patientIds, batchPatientMap: [{ batchId, patientIds, facility, scheduleDate }] }`.
- **Status codes:** 200; 400 (Zod failure; all rows skipped); 500 (bulk insert error).
- **DB dependencies:** `screening_batches`, `patient_screenings`, `audit_log`.
- **Side effects:**
  1. `resolveBatchForGroup(facility, scheduleDate, userId)` per group — may create a batch.
  2. Multi-row `db.insert(patientScreenings).values(inserts).returning()` per group.
  3. **Reconciliation guard at ~349–356** — every row attempted must come back; mismatch surfaces as structured row error rather than silent loss.
  4. `storage.updateScreeningBatch(batchId, { patientCount })` per group.
  5. `logAudit(req, "create", "patient_screenings_bulk", batchId, { count, source: "plexus-iq-clinical-import" })` per group.
  6. `invalidatePatientDatabase()` at the end.
- **Protected flows at risk:** Plexus IQ bulk import; MRN stamping; batch resolution; downstream qualification job.
- **Current behavior contract:**
  - Skip-error envelope `{ rowIndex, patientName?, reason, raw? }` consumed by client UI.
  - `buildClinicalImportNotes(...)` stamps MRN + rowIndex + parser warnings + raw row trace into `notes`. **This is the only place MRN lives today.**
  - Single multi-row INSERT per group — switching to per-row INSERTs would slow imports 50–200× and likely time out.
  - `invalidatePatientDatabase()` fires once even on partial failure.
- **Parity contract for future wrapper:**
  - No change to skip-error envelope shape.
  - No change to `buildClinicalImportNotes` semantics.
  - Multi-row INSERT preserved; never split into per-row.
  - Reconciliation guard preserved verbatim — silent patient loss is a HIPAA-grade incident.
  - `invalidatePatientDatabase()` called once at end (not per group).
- **Future service boundary:** `server/services/plexusIq/clinicalImportService.ts` — pure function over the parsed rows. Route owns HTTP framing only.
- **Future repo boundary:** `server/repositories/plexusIqClinicalImport.repo.ts` — bulk insert + batch upsert helpers.
- **Risk level:** **high** (data ingestion correctness; PHI flow; bulk insert size).
- **Stop conditions:**
  - Any change to skip-error envelope shape.
  - Any change to multi-row INSERT pattern.
  - Any change to `buildClinicalImportNotes` semantics.
  - Any change to the reconciliation guard.
- **Recommended wrapper sub-batch sequence:**
  - **PIQ-3b.1 (review-only):** capture parity fixtures: 3 groups × 5 rows each + 2 forced skips. Document expected `importedCount: 15`, `skippedCount: 2`, `batchIds.length: 3`, `errors.length: 2`.
  - **PIQ-3b.2:** extract `resolveBatchForGroup` into the service.
  - **PIQ-3b.3:** extract the `buildClinicalImportNotes` call site into the service. **Do not change the notes builder itself.**
  - **PIQ-3b.4:** extract the multi-row INSERT + reconciliation guard into the service. **No splitting; the guard moves with the insert.**

---

## 2. `POST /api/plexus-iq/qualification-jobs` *(plexusIqClinicalImport.ts:419–end of block)*

- **Purpose:** Start one or more AI qualification jobs for the given batches (or batches inferred from `patientIds`).
- **Method:** POST.
- **Request inputs (body, Zod):** `batchIds?: number[]`, `patientIds?: number[]`, `retryFailed?: boolean`.
- **Response shape:** `{ startedJobs: [{ batchId, jobId, totalPatients }], startErrors: [{ batchId, reason }] }`.
- **Status codes:** 200; 400 (`Provide at least one batchId or patientId`); 500.
- **DB dependencies:** `screening_batches`, `patient_screenings`, `analysis_jobs`.
- **Side effects:**
  1. `startBatchAnalysis(batchId)` per resolved batch — kicks off the in-process `batchAnalysisRunner.ts`.
  2. `analysis_jobs` row created per batch.
- **Protected flows at risk:** Plexus IQ qualification jobs status panel; batch progress UI; AI batch runner lifecycle.
- **Current behavior contract:**
  - Resolves `patientIds` → batches before starting.
  - `startBatchAnalysis` is fire-and-forget (returns immediately with jobId).
  - Background runner consumes Anthropic API.
- **Parity contract for future wrapper:**
  - Resolution order preserved (batchIds first, then patientIds, then dedupe).
  - `startedJobs` and `startErrors` envelope shapes preserved.
  - No change to `startBatchAnalysis` signature.
- **Future service boundary:** `server/services/plexusIq/qualificationJobsService.ts`.
- **Risk level:** **medium-high** (background job lifecycle; AI batch runner is in the protected list).
- **Stop conditions:** Any change to the response envelope; any change to `startBatchAnalysis` semantics.
- **Recommended wrapper sequence:** Single wrapper PR after PIQ-3b.1–PIQ-3b.4 ship.

---

## 3. `GET /api/plexus-iq/qualification-jobs/:batchId` *(plexusIqClinicalImport.ts:~490)*

- **Purpose:** Read qualification-job status for a batch.
- **Method:** GET.
- **Request inputs:** Path `:batchId`.
- **Response shape:** Job snapshot — `{ jobId, batchId, status, totalPatients, processed, failed, startedAt, completedAt? }`.
- **Status codes:** 200; 400 invalid batchId; 404 no job; 500.
- **DB dependencies:** `analysis_jobs`.
- **Side effects:** none.
- **Risk level:** **low** (read-only).
- **Wrapper:** Low-priority; could be the first piece extracted.

---

## 4. `POST /api/plexus-iq/qualification-jobs/:jobId/cancel` *(plexusIqClinicalImport.ts:~577)*

- **Purpose:** Cancel a running qualification job.
- **Method:** POST.
- **Request inputs:** Path `:jobId`.
- **Response shape:** `{ ok: boolean, jobId, status }`.
- **Side effects:** Updates `analysis_jobs.status = "cancelled"`. In-process runner observes cancellation flag on next iteration.
- **Risk level:** **medium** (cancellation semantics are subtle; partial completion must be preserved).
- **Stop conditions:** Any change that causes already-completed patient results to be discarded.

---

## 5. Plexus IQ workspace read-adjacent endpoints (cross-referenced)

These endpoints are NOT in `plexusIqClinicalImport.ts` but are consumed by the Plexus IQ workspace and listed here for completeness. Full inventory in the prior `backend-route-parity-inventory.md`.

| Route | File | Risk |
| --- | --- | --- |
| `GET /api/screening-batches` | `batches.ts:473` | low |
| `GET /api/screening-batches/calendar-summary` | `batches.ts:487` | low-medium (cache layer; 30s TTL) |
| `GET /api/screening-batches/:id` | `batches.ts:537` | low |
| `PATCH /api/screening-batches/:id` | `batches.ts:555` | medium |
| `POST /api/batches/:id/analyze` | `batches.ts:306` | **high** (background runner trigger) |
| `POST /api/patients/:id/analyze` | `patients.ts:1203` (already wrapped Admin-review-adjacent in Batch 3b.x) | high |

---

## 6. Compact risk + sequence table

| Route | Risk | Sequence position |
| --- | --- | --- |
| `GET /qualification-jobs/:batchId` | low | first (warm-up) |
| `POST /qualification-jobs/:jobId/cancel` | medium | after the read endpoint |
| `POST /qualification-jobs` (start) | medium-high | after cancel |
| `POST /plexus-iq/clinical-import` | high | last (sub-batched into PIQ-3b.1 through PIQ-3b.4) |

---

## 7. Cross-batch mapping

| Batch | Owns |
| --- | --- |
| **Batch 14** (Plexus IQ read-model optimization) | Additive aggregate endpoints; the read endpoints above stay; new endpoints added beside. |
| **Batch 18** (Background jobs design) | The AI runner moves to outbox-driven queue in Phase 18f; the route handlers don't change shape. |
| **Batch 21** (QA hardening) | Adds the 3-group × 5-row × 2-skip fixture as a runnable parity test. |

---

## 8. Stop conditions (program-wide)

A future Plexus IQ wrapper PR MUST stop and ask if:

1. The bulk INSERT pattern is broken into per-row INSERTs for any reason.
2. The reconciliation guard at clinical-import:~349–356 is altered.
3. MRN stamping (`buildClinicalImportNotes`) is moved without preserving the `[plexus-iq-clinical-import]` header + rowIndex + raw row trace.
4. The skip-error envelope adds, removes, or renames a field.
5. The `startBatchAnalysis` signature changes.
6. The cancellation handler discards already-completed patient results.

End of inventory.
