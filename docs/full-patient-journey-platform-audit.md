# Full Patient Journey Platform Audit — v2

**Repository:** noorhanmedical/tertiary-command-center
**Starting main SHA:** `2aaa23bc75b0940c3c24f20d7abaf149403a322d`
**Audit branch:** `audit/full-patient-journey-platform`
**Scope:** Complete patient lifecycle — ingestion → identity → qualification → admin review → engagement → scheduling → order note → procedure → report → procedure note → billing readiness → billing document → claim → payment → invoice → journey completion
**Status:** Phase 1 documentation. Zero application/UI/schema/migration changes.
**Revision v2:** Corrections applied per owner review. Five canonical decisions have been re-scoped; auth finding on `/api/generated-notes` corrected; unsupported percentage metric removed; phase order revised.

---

## 1. Executive Summary

The platform has canonical writers for several core objects and structural gaps that block a real end-to-end patient journey. Written correctly today: `patient_screenings` (screening/qualification history), `patient_execution_cases` (engagement/outreach container), `procedure_notes` (both order and post-procedure notes), `documents` (files), `invoices` + `invoice_payments` + `invoice_adjustments` + `invoice_denials` + `remittance_events` (financial events).

**Structural gaps identified:**

1. **No canonical patient identity.** `patient_screenings` operates at the screening event level. Rename, DOB correction, or re-import creates multiple rows for the same real patient with no durable link. Identity resolution is deterministic (name+dob grouping) but unwired — `server/modules/patient-directory/repo.ts:3-232` ships as a read-only module never called from any registered route.

2. **No canonical per-service ancillary case.** `patient_execution_cases` is a per-screening engagement container carrying `selectedServices[]` as an array (`shared/schema/executionCase.ts:43`). It cannot cleanly anchor service-specific Admin Review, appointment, order note, procedure, report, procedure note, billing readiness, billing document, or completion status when a patient has multiple ancillary services (BrainWave + VitalWave + Ultrasound). All service-specific state (`procedure_notes`, `procedure_events`, `case_document_readiness`, `billing_readiness_checks`, `billing_document_requests`) is currently keyed on `(patient_screening_id, service_type)` without an anchoring case row.

3. **Appointment fragmentation.** Four independent stores maintain appointment-adjacent state: `global_schedule_events`, `ancillary_appointments`, `patient_screenings.appointmentStatus`, `patient_execution_cases.engagementStatus`. There is no cross-store sync; `server/routes/outreach.ts:352` fires `ensureCanonicalSpineForScreening` as a fire-and-forget promise.

4. **Note-generation lifecycle collapsed into one operation.** `createPendingProcedureNotes` at `server/repositories/generatedNotes.repo.ts:82-132` unconditionally writes BOTH `order_note` AND `post_procedure_note` on procedure completion. Order Note should exist before the procedure workflow whenever its own preconditions are satisfied (Admin Review approved + scheduled appointment), independently of procedure completion. Business-rule gates for both notes are not enforced at write.

5. **Billing-document → claim chasm.** `billing_document_requests.generatedDocumentId` at `shared/schema/billingDocuments.ts:33` has no FK target, no writer, no reader. No claims table exists. No external clearinghouse submission exists. No revenue-allocation compute exists.

6. **Screening-level Admin Review incompatible with multi-service reality.** `patient_screenings.adminApprovalStatus` (`shared/schema/screening.ts:90-93`) is patient-level. Approval for two ancillaries and denial of a third cannot be captured. History is a single `admin_approval_updated` journey event, not an append-only approval log.

**Retirement verified:** Twilio / patient SMS / patient messaging is absent from executable code. Only comments documenting the intentional removal remain. The pre-existing `/sms/twilio/inbound` auth-exemption at `server/routes.ts:210-214` is unreachable dead code — no route is registered under that path (introduced by `e23face` before Phase 1).

## 2. Current Canonical Entity Findings

| Concept | Canonical entity today | Canonical ID today | Evidence | Sufficient for the multi-service journey? |
|---------|:-----------------------|:-------------------|:---------|:------------------------------------------|
| Patient identity | `patient_screenings` row (screening event) | `patient_screenings.id` (int, serial) | `shared/schema/screening.ts:46-106`; unwired grouping at `server/modules/patient-directory/repo.ts:3-232` | **No** — one real patient can occupy many rows on re-import / rename. |
| Ancillary case | `patient_execution_cases` row (per screening; carries `selectedServices[]` array) | `patient_execution_cases.id` (int, serial) | `shared/schema/executionCase.ts:30-62`; one-per-screening upsert at `server/repositories/executionCase.repo.ts:168-172` | **No** — per-screening/engagement scope; cannot anchor service-specific Admin Review, appointment, order note, procedure, report, procedure note, billing readiness, billing document, or completion status. |
| Appointment | Fragmented — no single canonical | N/A | Four stores: `global_schedule_events` (`shared/schema/globalSchedule.ts:47-77`), `ancillary_appointments` (`shared/schema/appointments.ts:5-30`), `patient_screenings.appointmentStatus`, `patient_execution_cases.engagementStatus` | **No** — cross-store sync missing. |
| Admin Review | `patient_screenings.adminApprovalStatus` + `adminApprovedAt` + `adminApprovedByUserId` + `adminApprovalNote` + reasoning jsonb per test | `patient_screenings.id` | `shared/schema/screening.ts:88-93`; enum `shared/schema/screening.ts:108-114`; route `server/routes/patients.ts:662-865` | **No** — patient-level; cannot express per-service approval or denial; single row overwrite prevents history. |
| Order Note | `procedure_notes` row with `noteType='order_note'` | `procedure_notes.id` + unique `(patientScreeningId, serviceType, noteType)` | `shared/schema/generatedNotes.ts:35-65`; unique index line 64 | Table shape sufficient; **eligibility gate missing** at write. |
| Procedure Note | `procedure_notes` row with `noteType='post_procedure_note'` | Same as Order Note | Same file | Same conclusion — gate missing. |
| Report | `documents` (kind='report') with legacy `uploaded_documents` first-read migration | `documents.id` (int) | `shared/schema/documents.ts:97-120`; legacy migration `server/routes/documentLibrary.ts:89-145` (name-based fallback risk) | **Adequate** for canonical file store; name-based legacy match is a data-quality risk. |
| Billing Document Request | `billing_document_requests` row | `billing_document_requests.id` + FK to `billing_readiness_checks.id` | `shared/schema/billingDocuments.ts:20-46` | **Partial** — `generatedDocumentId` orphan; no generator. |
| Billing Document (generated file) | Intended: `documents` row (kind='billing_document'). Actual: **not implemented.** | N/A | `shared/schema/billingDocuments.ts:33` (bare int, no FK, no writer) | **No.** |
| Claim | **Not implemented** | N/A | No claims table in `shared/schema/`. No `/api/claims/*` route. No external submission. | **No.** |
| Payment | `invoice_payments` row | `invoice_payments.id` | `shared/schema/invoices.ts:108-121`; `server/services/billing/invoiceFinancialService.ts:55-82` | **Yes** — canonical + wired. |
| Invoice | `invoices` row | `invoices.id` + `invoices.invoiceNumber` | `shared/schema/invoices.ts`; enums lines 9, 58-64, 67-76 | **Adequate**; no `closed` state; `sent_to_billing` declared elsewhere but not on invoices.status. |

## 3. Owner-Approved Canonical Decisions (v2)

### 3.1 Canonical patient identity

**Approved with these revisions:**

- Use the repository's normal **serial integer ID** convention (not uuid) unless evidence forces otherwise. `users.id` uses `varchar` because it's populated by `gen_random_uuid()` — but every other domain PK (`patient_screenings`, `patient_execution_cases`, `procedure_notes`, `documents`, `invoices`, etc.) is a `serial` int (`shared/schema/screening.ts:47`, `shared/schema/executionCase.ts:31`, etc.). The canonical patient PK should follow that convention.
- **Explicit clinic/tenant ownership required.** Do not create a tenantless global patient table.
- Two model choices to evaluate:
  - **Model A — one patient per clinic:** `canonical_patients(id serial PK, clinic_id NOT NULL FK, name_normalized, dob, first_screening_id, ...)`, with `(clinic_id, name_normalized, dob)` uniquely identifying a patient inside a clinic. Patients seen by two clinics are two distinct canonical rows. Simple to reason about, simple to scope, no cross-tenant leakage possible.
  - **Model B — global identity + explicit membership:** `canonical_patients(id serial PK, name_normalized, dob, ...)` + `patient_clinic_memberships(patient_id, clinic_id, active, joined_at, left_at)`. Enables cross-clinic identity when a patient moves clinics. Requires stricter identity checks (DOB + phone + insurance likely) to avoid cross-tenant contamination.
- **Recommended MVP: Model A** for the current multi-tenant platform. Reasons:
  1. The current schema is already tenant-partitioned at every table with a `clinic_id` column (`shared/schema/screening.ts:52`, `shared/schema/executionCase.ts:33`, etc.). Model A aligns with the existing partition without introducing new cross-tenant invariants.
  2. The unwired canonical grouping at `server/modules/patient-directory/repo.ts` groups on `(lower(trim(name)), dob)` in memory without a clinic scope — grafting a `clinic_id` column onto the algorithm is straightforward. Grafting a cross-tenant identity model on top requires reconciling every existing tenant-scoped query.
  3. The `clinicContext` middleware (`server/middleware/clinicContext.ts`, mounted at `server/index.ts:85`) already enforces per-request clinic scoping. Model A preserves that guarantee without exceptions.
  4. Model B can be introduced later as an additive `patient_clinic_memberships` table linking Model A rows if cross-clinic patient portability becomes required. Model B first is harder to add-later.
- `patient_screenings` becomes screening/qualification **history** linked to the canonical patient via `patient_screenings.canonical_patient_id` FK. Screenings continue to be one row per screening event; the canonical patient row aggregates the identity.
- Patient Directory / Patient EHR remains the authoritative longitudinal visualization; it queries by `canonical_patient_id` and joins in every screening, case, appointment, note, and document.

### 3.2 Canonical per-service ancillary case

**Not approved as `patient_execution_cases` sole.** Introduce a per-service canonical:

**`patient_ancillary_cases`** — one row per (canonical patient, clinic, ancillary service, episode of care).

Conceptual columns (do not implement in this audit):

- `id` (int, serial)
- `canonical_patient_id` (FK → canonical_patients.id, NOT NULL)
- `patient_screening_id` (FK → patient_screenings.id, NULLABLE — the screening that qualified this service; may be null for services added by admin after the screening event)
- `execution_case_id` (FK → patient_execution_cases.id, NULLABLE — the engagement container that this ancillary case is worked under)
- `clinic_id` (FK → clinics.id, NOT NULL)
- `service_type` (text, NOT NULL — e.g., BrainWave, VitalWave, Ultrasound subtypes)
- `lifecycle_status` (text — new, active, on_hold, closed, cancelled, archived)
- `qualification_status` (text — inherits enum from execution_cases: unscreened / qualified / not_qualified / pending_review)
- `admin_review_status` (text — pending / approved / needs_info / rejected; NOT the screening-level projection)
- `canonical_appointment_id` (FK → global_schedule_events.id, NULLABLE — set when a canonical appointment exists)
- `created_at` (timestamptz, default now)
- `updated_at` (timestamptz, default now)
- `clinically_completed_at` (timestamptz, NULLABLE — set when procedure event + report + procedure note signed)
- `financially_completed_at` (timestamptz, NULLABLE — set when invoice closed and any allocation posted)

Required uniqueness: `(canonical_patient_id, clinic_id, service_type, execution_case_id)` where `execution_case_id IS NOT NULL`. Multiple episodes of care are distinguished by execution_case_id.

**Relationship to `patient_execution_cases`:**

- `patient_execution_cases` **remains** the engagement/outreach container per patient screening. Its `selectedServices[]` array becomes a projection of the ancillary_case rows for that execution case.
- `patient_execution_cases.engagementStatus` continues to represent outreach progress at the case level. Service-specific status lives on `patient_ancillary_cases`.
- The engagement case may reference multiple ancillary cases (1:N).

**Everything downstream keys on `patient_ancillary_cases.id`:**

- Admin Review append-only history — see §3.3.
- Canonical appointment — see §3.4.
- Order Note / Procedure Note — `procedure_notes.ancillary_case_id` becomes canonical anchor (replacing today's `(patient_screening_id, service_type)` composite as the authoritative anchor; the composite can remain a compatibility projection).
- Procedure event — `procedure_events.ancillary_case_id`.
- Report — `documents.ancillary_case_id` for reports (kind='report'); other kinds stay linked via `patient_screening_id`.
- Billing readiness — `billing_readiness_checks.ancillary_case_id`.
- Billing document request — `billing_document_requests.ancillary_case_id`.

**Not implemented in this audit.** Schema addition is a Phase 2B decision.

### 3.3 Service-specific Admin Review with append-only history

**Approved.** The current `patient_screenings.adminApprovalStatus` is screening-level and destructive on state change. Replace with per-case history:

**`ancillary_case_admin_review_events`** — append-only.

Conceptual columns:

- `id` (int, serial)
- `ancillary_case_id` (FK → patient_ancillary_cases.id, NOT NULL)
- `service_type` (text, NOT NULL — denormalized from case for auditability)
- `previous_status` (text — pending / approved / needs_info / rejected)
- `new_status` (text — same enum)
- `reviewer_user_id` (FK → users.id, NOT NULL)
- `reviewer_role` (text — captured at write time from session role)
- `actual_reviewed_at` (timestamptz, DEFAULT NOW() — **never backdated**; always the real action time)
- `effective_clinical_date` (text YYYY-MM-DD, NULLABLE — separate clinical effective date, used when the reviewer is recording a decision that clinically applied at a different date)
- `rationale` (text)
- `evidence_snapshot` (jsonb — captures the reasoning + evidence at review time, immutable)
- `created_at` (timestamptz, default now)

**Rules:**

- `actual_reviewed_at` is always `now()` at insert. Never modifiable.
- `effective_clinical_date` is optional; when supplied, it's stored alongside without mutating `actual_reviewed_at`. UI shows the effective clinical date; audit uses `actual_reviewed_at`.
- `admin_review_status` on `patient_ancillary_cases` is a projection of the latest `new_status` per case.
- The existing screening-level `patient_screenings.adminApprovalStatus` remains temporarily as a **compatibility projection** — computed as "approved iff every ancillary_case for the screening is approved; needs_info iff any is needs_info; rejected iff every one is rejected; pending otherwise." This projection is derived, not written directly, once the per-case history is authoritative.
- Reviewer role is captured but not currently constrained to a specific "Plexus internal clinical" enum value. `USER_ROLES = ['admin','clinician','scheduler','biller','technician','liaison']` (`shared/schema/users.ts:4`) has no `internal_reviewer` variant — introducing one is a **product decision** (see §12.1). Meanwhile the role is captured at write time so the audit is honest about who actually reviewed.

### 3.4 Canonical appointment — conditional approval

`global_schedule_events` is the canonical appointment store **only when all of these conditions are enforced**:

1. `event_type` must identify a real appointment: `ancillary_appointment`, `same_day_add`, or `doctor_visit`. Rows with `event_type` in `(procedure_complete, no_show, cancellation, reschedule, pto_block, room_block, equipment_block, team_member_availability, unavailable_block)` are **not** appointments — they are audit / capacity events attached to appointments.
2. Every appointment row **must link to `patient_ancillary_cases.id`** (new column `global_schedule_events.ancillary_case_id`).
3. Every appointment row **must link to the canonical patient** via the ancillary_case → canonical_patient chain.
4. `service_type` is **required** for ancillary appointments (currently nullable at `shared/schema/globalSchedule.ts` — enforce at write via a check constraint after backfill).
5. **One active canonical appointment per ancillary case** unless explicitly rescheduled — enforced by partial unique index: `UNIQUE (ancillary_case_id) WHERE event_type IN ('ancillary_appointment','same_day_add') AND status IN ('scheduled')`.
6. Reschedule lineage preserved — new appointment row's `parent_event_id` FK points at the prior appointment row; prior row's status transitions to `cancelled` or `rescheduled` (extend enum additively).
7. Cancellation / no-show reasons preserved: `cancellation_reason text` and `no_show_reason text` columns (nullable).

**`ancillary_appointments`** becomes a compatibility projection (read-only) or retires after safe backfill. The backfill script (not in this audit) creates one `global_schedule_events` row per `ancillary_appointments` row and sets an `ancillary_appointments.global_schedule_event_id` back-pointer for legacy reads.

**`patient_screenings.appointmentStatus`** and **`patient_execution_cases.engagementStatus`** must not remain competing appointment truth. They become computed/derived projections:

- `patient_screenings.appointmentStatus` = "scheduled" iff any linked ancillary_case has an active canonical appointment.
- `patient_execution_cases.engagementStatus` = derived from outreach state + ancillary_case appointment state.

**Transition rules (recommended):**

- `scheduled → cancelled`: allowed. Record cancellation_reason. If reschedule required, insert new appointment row with `parent_event_id`.
- `scheduled → rescheduled`: create new row (`event_type='ancillary_appointment'`, `parent_event_id=<old>`), mark old row `status='rescheduled'`.
- `scheduled → no_show`: mark row `status='no_show'`, record `no_show_reason`.
- `scheduled → completed`: transition to `status='completed'`. Fires procedure-complete side-effect if the corresponding procedure event exists.
- No direct `scheduled → scheduled` update; changing time/date requires an explicit reschedule.

### 3.5 Note-generation lifecycle — split into two idempotent reconciliations

**`createPendingProcedureNotes` at `server/repositories/generatedNotes.repo.ts:82-132` unconditionally writing both note types is not correct.** Replace with two separate idempotent reconciliation operations:

**`reconcileOrderNoteEligibility(ancillary_case_id)`:**

- Triggered after:
  - Service-specific Admin Review status changes to `approved` (or later `approved → pending/needs_info/rejected` — see void semantics below).
  - Canonical appointment created/rescheduled for the ancillary case.
- Precondition:
  - `patient_ancillary_cases.admin_review_status = 'approved'`
  - There is exactly one active canonical appointment (or a completed appointment) linked to the ancillary_case.
- Outcome:
  - If both preconditions true and no order note lineage exists for the ancillary_case: create one `procedure_notes` row with `noteType='order_note'`, `generationStatus='pending'`, `notes_lineage_id=<new>`. Trigger generator service (Phase 2E).
  - If order note lineage exists but is stale (Admin Review changed since generation): create an amendment row within the existing lineage (`correction_of_note_id=<prior>`).
  - If preconditions become false (Admin Review revoked): transition the current head of the order note lineage to `signatureStatus='voided'` (extend enum additively) and mark the ancillary_case as needing re-eligibility.
- Idempotent: safe to call any number of times; only writes when there is a real state change.

**`reconcileProcedureNoteEligibility(ancillary_case_id)`:**

- Triggered after:
  - Procedure completion for the ancillary case (`procedure_events.procedureStatus='complete'`).
  - Report upload / replacement associated with the ancillary case (`documents.kind='report'` + link).
- Precondition:
  - `procedure_events` row exists for the ancillary_case with `procedureStatus='complete'`.
  - A canonical report `documents` row exists for the ancillary_case (via `documents.ancillary_case_id` — new column, additive) with a non-null blob (or an authoritative external link only if that's declared canonical, which today's evidence does not).
- Outcome:
  - If both true and no procedure_note lineage exists: create one `procedure_notes` row with `noteType='post_procedure_note'`, `generationStatus='pending'`, `notes_lineage_id=<new>`. Trigger generator (Phase 2F).
  - If report is later replaced: create an amendment row in the existing lineage.
  - If procedure is later reverted (cancelled / unable_to_complete): void the current head of the lineage.
- Idempotent.

**Critical ordering:** The Order Note must exist **before** the procedure workflow whenever its own two preconditions are satisfied. It must **not** first be created at procedure completion. This restores the correct clinical sequence:

1. Screening + qualification.
2. Admin Review approves an ancillary service (patient_ancillary_cases.admin_review_status='approved').
3. Scheduling assigns a canonical appointment.
4. `reconcileOrderNoteEligibility` fires → Order Note lineage created.
5. Physician reviews / signs the Order Note (if signature is required for order_note — product decision, see §12.5).
6. Patient arrives, procedure event starts, procedure completes.
7. Report uploaded and linked.
8. `reconcileProcedureNoteEligibility` fires → Procedure Note lineage created.
9. Physician signs the Procedure Note (KINDS_REQUIRING_SIGNATURE includes post_procedure_note).
10. Billing readiness re-evaluates.

### 3.6 Document architecture — approved as stated

Owner-approved principle (unchanged from v1 audit, restated for clarity):

- `procedure_notes` = canonical **Order Note** and **Procedure Note** records (both types on the same table).
- `documents` = canonical file / blob / version records, including reports and generated billing files. Version chain: `documents.supersededByDocumentId`.
- `billing_document_requests` = canonical Billing Document **workflow request**. `generatedDocumentId` becomes a real FK → `documents.id` and MUST be populated by the generator.
- `Ancillary Documents` (`/ancillary-documents`) = global operational **projection** — reads from canonical sources only.
- `Patient EHR → Ancillary Documents` = authoritative patient-level visualization.
- Clinician Portal, PCS Portal, ACS Portal, Finance, Imaging Central, Document Library all pull the same canonical source IDs.
- **No portal creates an independent copy for display.** Every projection references canonical source rows.

### 3.7 Corrected auth finding on `/api/generated-notes`

**Prior audit v1 statement:** "GET /api/generated-notes has no auth middleware, no `clinicId` scoping. Returns all notes to any caller."

**Correction:** The route IS authenticated. Verified at commit `2aaa23b`:

- `server/routes.ts:239` — `app.use("/api", requireAuth);`
- `server/routes.ts:270` — `registerGeneratedNotesRoutes(app);`

Route registration order matters — global `requireAuth` is mounted BEFORE `registerGeneratedNotesRoutes`, so all `/api/generated-notes` calls pass through the auth gate.

**Accurate defect:** The endpoint is authenticated but:

1. **Not clinic-scoped.** `storage.getAllGeneratedNotes()` returns notes across every clinic; the handler at `server/routes/generatedNotes.ts:11-18` does not filter by `req.clinicId`.
2. **Legacy read path.** The `generated_notes` table is the pre-`procedure_notes` note surface. `/ancillary-documents` reads it (`client/src/pages/documents.tsx:135-137`) while all note writes go to `procedure_notes`.
3. **Architecturally unsafe.** Retiring the display of this endpoint on `/ancillary-documents` in favor of a canonical read from `procedure_notes` is the correct fix — see Phase 2E.

**No change to the fix; the label is corrected.** The route is authenticated but must still be either scoped by clinic or retired in favor of the canonical `procedure_notes` read.

### 3.8 Removed unsupported metric

The prior audit v1 claimed "**96% coherent by count of touched tables**." That figure was not derived from a defined, reproducible measurement. It has been **removed**. No percentage of "coherence" is used anywhere in this document. Instead, the audit lists explicit findings + explicit gaps.

## 4. Full Lifecycle Diagram (revised for per-service ancillary case)

```
                                          INGESTION
                                             ↓
                             patient_screenings (screening event)
                                             ↓
                              [resolves/creates canonical_patients]
                                             ↓
                             canonical_patients row (per clinic)
                                             ↓
                                [batch AI analysis runs]
                                             ↓
                        qualifyingTests + reasoning per test
                                             ↓
                       [for each qualifying service — new ancillary_case]
                                             ↓
                        patient_ancillary_cases (per service)
                                             ↓
                                 SERVICE-SPECIFIC ADMIN REVIEW
                                             ↓
                        ancillary_case_admin_review_events (append-only)
                        + patient_ancillary_cases.admin_review_status='approved'
                                             ↓
                               [engagement + outreach]
                                             ↓
                                     SCHEDULING
                             global_schedule_events (ancillary_appointment)
                                             ↓
                             patient_ancillary_cases.canonical_appointment_id
                                             ↓
                           reconcileOrderNoteEligibility(ancillary_case_id)
                                             ↓
                           [preconditions met → Order Note lineage]
                                             ↓
                                    PHYSICIAN SIGN ORDER NOTE
                                             ↓
                                    PROCEDURE EXECUTION
                        procedure_events.procedureStatus='complete'
                                             ↓
                                    REPORT UPLOAD
                        documents (kind='report', ancillary_case_id linked)
                                             ↓
                           reconcileProcedureNoteEligibility(ancillary_case_id)
                                             ↓
                        [preconditions met → Procedure Note lineage]
                                             ↓
                                    PHYSICIAN SIGN PROCEDURE NOTE
                                             ↓
                                    BILLING READINESS
                        billing_readiness_checks (ancillary_case_id linked)
                                             ↓
                                   BILLING DOCUMENT REQUEST
                        billing_document_requests (ancillary_case_id linked)
                        + generatedDocumentId → documents(kind='billing_document')
                                             ↓
                                    INVOICE / PAYMENT
                                             ↓
                                    (Claim stage — TBD per §12.2)
                                             ↓
                        patient_ancillary_cases.clinically_completed_at
                        patient_ancillary_cases.financially_completed_at
```

## 5. Master Lifecycle Table

_All file:line citations at commit `2aaa23b`. This table describes today's state; §3 above describes the revised canonical decisions._

### 5.1 Patient Ingestion

| Field | Value |
|---|---|
| **Stage** | Patient Ingestion (multi-path) |
| **Route** | POST `/api/batches`, `.../patients`, `.../import-file`, `.../import-text` · POST `/api/plexus-iq/clinical-import` · POST `/api/patient-directory/import-confirm` (flag) · POST `/api/appointments` (stub) |
| **Server handler** | `server/routes/batches.ts:49-718` · `server/routes/plexusIqClinicalImport.ts:263-543` · `server/routes/patientDirectory.ts:191-433` · `server/routes/appointments.ts:25-89` |
| **Domain service** | `server/services/screening.ts` · `server/services/ingest.ts` · `server/services/patientCommitService.ts` · `server/services/batchAnalysisRunner.ts` |
| **Table** | `patient_screenings` |
| **Canonical entity (today)** | patient_screenings row |
| **Canonical ID (today)** | `patient_screenings.id` (int) |
| **Canonical entity (v2 target)** | `canonical_patients` row (clinic-scoped Model A) with `patient_screenings.canonical_patient_id` FK |
| **Status after** | `status='draft'` (or `'completed'` if pre-computed), `commitStatus='Draft'`, `adminApprovalStatus='pending'` |
| **Current defect** | (1) No uniqueness on (name,dob) at write. (2) PATCH `/api/patients/:id` allows `data.name` mutation with no collision check (`server/routes/patients.ts:81`). (3) `patient_test_history` writes name+dob only, no FK (`shared/schema/patientHistory.ts:4-25`). |
| **Verification** | `server/routes/batches.ts:49-718`, `shared/schema/screening.ts:46-106`, `server/services/patientCommitService.ts:71-233` |

### 5.2 Qualification (Plexus IQ)

| Field | Value |
|---|---|
| **Stage** | Qualification |
| **Route** | POST `/api/batches/:id/analyze` · GET `/api/batches/:id/analysis-status` |
| **Server handler** | `server/routes/batches.ts:400-545` |
| **Domain service** | `server/services/batchAnalysisRunner.ts` |
| **Table** | `patient_screenings` (fields: qualifyingTests, reasoning, status) |
| **Canonical entity (today)** | patient_screenings row |
| **Canonical entity (v2 target)** | Same, but per-service state moves onto `patient_ancillary_cases` |
| **Current defect** | `batchAnalysisRunner.ts:714-728` overwrites `reasoning` on re-run without calling `preserveAdminReviewReasoning` — admin `adminReview:*` keys are silently lost (function exists at `shared/plexus-iq/adminReviewEvidence.ts:969-985`). |
| **Verification** | `server/services/batchAnalysisRunner.ts:714-728`, `shared/schema/screening.ts:70` |

### 5.3 Admin Review (v2 — service-specific with history)

| Field | Value |
|---|---|
| **Stage** | Admin Review |
| **Route (today)** | POST `/api/patient-screenings/:id/admin-approval` — screening-level |
| **Route (v2 target)** | New endpoint that accepts `ancillary_case_id` + `new_status` + optional `effective_clinical_date` + `rationale` |
| **Server handler (today)** | `server/routes/patients.ts:662-865` |
| **Domain service** | `server/services/plexusIq/adminReviewAddService.ts:153-475` |
| **Table (today)** | `patient_screenings` (approval fields at lines 88-93) |
| **Table (v2 target)** | New append-only `ancillary_case_admin_review_events` + projection column `patient_ancillary_cases.admin_review_status` |
| **Canonical entity (v2 target)** | `patient_ancillary_cases` row (service-level) + history log |
| **Status after (today)** | `patient_screenings.adminApprovalStatus='approved'`, `adminApprovedAt=NOW()`, `adminApprovedByUserId=session.userId` |
| **Timestamps** | `actualReviewedAt=NOW()` — **never backdated**; optional `effective_clinical_date` documents clinical intent separately. |
| **Current defect** | (1) Screening-level approval cannot express per-service decisions. (2) Single row overwrite prevents auditable history — only a single journey event is appended (`server/routes/patients.ts:798-823`). (3) No role gate on approver identity (any authenticated user can call the endpoint). |
| **Verification** | `server/routes/patients.ts:662-865`, `shared/schema/screening.ts:88-93,108-114` |

### 5.4 Engagement & Outreach

| Field | Value |
|---|---|
| **Stage** | Engagement + Outreach |
| **Route** | POST `/api/outreach/calls` · POST `/api/engagement-center/call-result` · GET `/api/outreach/dashboard` |
| **Server handler** | `server/routes/outreach.ts` · `server/routes/executionCases.ts` · `server/routes/engagementBaskets.ts` |
| **Domain service** | `server/services/callResult/recordCallResult.ts:38-61` · `server/services/callResult/callAttemptRuntime.ts` |
| **Table** | `outreach_calls` (`shared/schema/outreach.ts:43-60`), `patient_execution_cases` (engagement container), `scheduling_triage_cases` |
| **Canonical entity (today)** | `patient_execution_cases` (per-screening engagement container) |
| **Canonical entity (v2 target)** | Same — execution case remains the engagement/outreach container per screening; references multiple `patient_ancillary_cases` |
| **Current defect** | Two write paths with divergent logic: `/api/outreach/calls` inserts outreach_calls + updates screening.appointmentStatus + fires spine sync (fire-and-forget); `/api/engagement-center/call-result` appends journey event + updates engagementStatus but does NOT insert into outreach_calls. |
| **Verification** | `server/routes/outreach.ts:200-352`, `server/routes/executionCases.ts:158-189` |

### 5.5 Scheduling

| Field | Value |
|---|---|
| **Stage** | Scheduling |
| **Route** | POST `/api/global-schedule-events` · POST `/api/global-schedule-events/schedule-ancillary` · PATCH `.../transition` · POST `/api/appointments` (legacy) |
| **Server handler** | `server/routes/globalSchedule.ts` · `server/routes/appointments.ts` |
| **Table (today)** | `global_schedule_events` + `ancillary_appointments` + `patient_screenings.appointmentStatus` + `patient_execution_cases.engagementStatus` (all independent) |
| **Canonical entity (today)** | **Fragmented — no single canonical** |
| **Canonical entity (v2 target)** | `global_schedule_events` (subject to the seven conditions in §3.4) |
| **Current defect** | Four independent stores; no cross-sync; same-day quick-schedule uses name+DOB+facility matching (name-based collision risk, `server/routes/globalSchedule.ts:325-354`). |
| **Verification** | `shared/schema/globalSchedule.ts:47-77`, `shared/schema/appointments.ts:5-30`, `server/routes/globalSchedule.ts:281-378` |

### 5.6 Order Note (v2 — reconcileOrderNoteEligibility)

| Field | Value |
|---|---|
| **Stage** | Order Note |
| **Trigger (today)** | Procedure completion — unconditional |
| **Trigger (v2 target)** | `reconcileOrderNoteEligibility(ancillary_case_id)` after Admin Review approve OR canonical appointment scheduled |
| **Preconditions (v2)** | Admin Review approved AND canonical appointment scheduled |
| **Route (read)** | GET `/api/procedure-notes?noteType=order_note&...` |
| **Route (sign)** | POST `/api/physician-portal/signature-items` (batch); note that current code excludes `order_note` from KINDS_REQUIRING_SIGNATURE — product decision, §12.5 |
| **Table** | `procedure_notes` with `noteType='order_note'`, unique `(patientScreeningId, serviceType, noteType)` today; new anchor `procedure_notes.ancillary_case_id` (v2) |
| **Current defect** | Written unconditionally on procedure complete. Business rule not enforced at write. Note generator missing — status stays `pending` forever. `/ancillary-documents` reads legacy `/api/generated-notes` while writes go to `procedure_notes`. Clinician `LinkedDocumentsPanel` reads empty mock (`client/src/components/physician/mockData.ts:203-214`). |
| **Verification** | `server/repositories/generatedNotes.repo.ts:82-132`, `shared/schema/generatedNotes.ts:11-65`, `client/src/pages/documents.tsx:135-137` |

### 5.7 Procedure Event

| Field | Value |
|---|---|
| **Stage** | Procedure execution |
| **Route (today)** | POST `/api/procedure-events/complete` — ONLY endpoint |
| **Table** | `procedure_events` (`shared/schema/procedureEvents.ts:21-46`) |
| **Status enum (today)** | `not_started`, `in_progress`, `complete`, `cancelled`, `no_show`, `reschedule_needed` — but only `complete` is reachable via route |
| **Current defect** | Five of six status values are unreachable. No `start`, `pause`, `cancel`, `no_show`, `unable_to_complete` endpoints. No prerequisite check before `complete`. |
| **Verification** | `shared/schema/procedureEvents.ts:11-46`, `server/routes/procedureEvents.ts:56-82` |

### 5.8 Report

| Field | Value |
|---|---|
| **Stage** | Report upload + associate |
| **Route** | POST `/api/documents-library` · POST `/api/portal/uploads` · POST `/api/google/drive/upload-report` (legacy) |
| **Table** | `documents` (canonical) + `uploaded_documents` (legacy migrated on first read) + `document_surface_assignments` + `document_blobs` |
| **Canonical entity** | `documents` row with kind='report'; version via `supersededByDocumentId` |
| **Current defect** | Legacy migration uses exact-name matching (`server/routes/documentLibrary.ts:104` — `findLatestPatientScreeningByExactName`). No `documents.ancillary_case_id` today (v2 target). Drive link treated as fallback when local blob absent — acceptable but not canonical. |
| **Verification** | `server/routes/documentLibrary.ts:89-438`, `shared/schema/documents.ts:97-149` |

### 5.9 Procedure Note (v2 — reconcileProcedureNoteEligibility)

| Field | Value |
|---|---|
| **Stage** | Procedure Note (post_procedure_note) |
| **Trigger (today)** | Procedure completion — unconditional (same op as Order Note) |
| **Trigger (v2 target)** | `reconcileProcedureNoteEligibility(ancillary_case_id)` after procedure complete OR report upload/replacement |
| **Preconditions (v2)** | Procedure completed AND canonical report available |
| **Sign** | POST `/api/physician-portal/signature-items`; report presence enforced at signature time (`server/services/physicianPortal/signatureRules.ts:114-116`) |
| **Table** | `procedure_notes` with `noteType='post_procedure_note'` |
| **Current defect** | Same as Order Note (unconditional write; no lineage; no generator; no amendment chain). |
| **Verification** | `server/services/physicianPortal/signatureRules.ts:76-144`, `server/services/physicianPortal/signatureWorkflow.ts:93-117` |

### 5.10 Billing Readiness

| Field | Value |
|---|---|
| **Stage** | Billing Readiness evaluation |
| **Trigger** | Procedure complete OR note signature OR document upload |
| **Route** | GET `/api/billing-readiness-checks` · GET `.../:id` (read-only) |
| **Domain service** | `server/repositories/billingReadiness.repo.ts:94-179` (`evaluateBillingReadinessForProcedure`) |
| **Table** | `billing_readiness_checks` (`shared/schema/billingReadiness.ts:19-42`); status enum lines 10-16 |
| **Anchor (v2 target)** | `billing_readiness_checks.ancillary_case_id` |
| **Current defect** | Fire-and-forget downstream to `createPendingBillingDocumentRequestFromReadiness` (`server/repositories/billingReadiness.repo.ts:173`) with `.catch(() => {})` silently swallowing errors. Race: `ready_to_generate` can be set before request row exists. |
| **Verification** | `shared/schema/billingReadiness.ts:10-42`, `server/repositories/billingReadiness.repo.ts:94-179` |

### 5.11 Billing Document Request

| Field | Value |
|---|---|
| **Stage** | Billing Document lifecycle |
| **Route (read)** | GET `/api/billing-document-requests` · GET `.../:id` (read-only) |
| **Table** | `billing_document_requests` (`shared/schema/billingDocuments.ts:20-46`) |
| **Anchor (v2 target)** | `billing_document_requests.ancillary_case_id` |
| **Current defect** | (1) `generatedDocumentId` orphan (no FK, no writer, no reader) at `shared/schema/billingDocuments.ts:33`. (2) Generator missing — `requestStatus` never leaves `pending`. (3) `sent_to_billing` declared but no code moves rows into it. (4) `reconcileCanonicalDuplicates` referenced at `billingDocuments.repo.ts:76` but the script does not exist. |
| **Verification** | `shared/schema/billingDocuments.ts:11-46`, `server/routes/billingDocuments.ts:11-54` |

### 5.12 Claim

**Not implemented.** No table in `shared/schema/`. No `/api/claims/*` route. No external clearinghouse submission. No EDI 837 formatter. See §12.2 for the product decision (in-house vs external RCM).

### 5.13 Payment

| Field | Value |
|---|---|
| **Stage** | Payment posting |
| **Route** | POST `/api/invoices/:id/payments` |
| **Domain service** | `server/services/billing/invoiceFinancialService.ts:55-82` (`postPayment`) |
| **Table** | `invoice_payments` + concurrently a `remittance_events` row (eventType='payment_posted') |
| **Current defect** | No journey event fired from `postPayment` — see §9. `payment_date` stored as text; write is fenced by ISO_DATE_RE at route level. |
| **Verification** | `shared/schema/invoices.ts:108-121`, `server/services/billing/invoiceFinancialService.ts:55-82` |

### 5.14 Invoice

| Field | Value |
|---|---|
| **Stage** | Invoice lifecycle |
| **Route** | Many under `/api/invoices*`, `/api/invoice-batches*`, `/api/invoice-approval*`, `/api/invoice-delivery*` |
| **Table** | `invoices`; enums for status, approvalStatus, deliveryStatus at `shared/schema/invoices.ts:9,58-64,67-76` |
| **Current defect** | No `closed` state. `sent_to_billing` declared in `billingReadiness`/`billingDocuments` enums but not on `invoices.status`. `projectedInvoices.projectedOurPortionPercentage` defaults to `"50"` with no compute — see §12.3. |
| **Verification** | `shared/schema/invoices.ts:9-121`, `server/services/billing/invoiceFinancialService.ts:14-93` |

### 5.15 Journey Completion

**Not implemented.** No `journey_completion` table. Discrete stages are fragmented across `patient_execution_cases.lifecycleStatus`, `patient_screenings.commitStatus`, `procedure_events.procedureStatus`, `invoices.status`. `patient_ancillary_cases.clinically_completed_at` and `.financially_completed_at` (v2 target) provide the two well-defined completion timestamps per service; the aggregate journey view (Phase 2K) reads them.

## 6. Mock / Live Audit (unchanged findings from v1 with corrected auth statement)

### 6.1 Client-side mock arrays and imports

- `client/src/components/physician/mockData.ts:203-214` — empty `DOCUMENTS`, `AUDIT_EVENTS` arrays consumed by Clinician `LinkedDocumentsPanel` (`client/src/components/physician/orders/OrdersNotesPage.tsx:401-420`). Panel renders "No linked documents" permanently.
- `client/src/pages/plexus-bank/mockData.ts` (~722 lines) — full Plexus Bank UI runs off client-side mock with localStorage persistence. Disclosed as prototype at `client/src/pages/plexus-bank.tsx:230`.
- `client/src/components/portal/messaging/mockPortalMessages.ts` — in-memory only, intentional per Phase 3 v7.
- `client/src/pages/plexus-iq-prototype.tsx`, `client/src/pages/home-preview.tsx` — publicly routable prototypes.

### 6.2 localStorage / sessionStorage as persistence

- Plexus Bank state: `localStorage["plexusBank.v1"]` — full state persists in browser only.
- Batch session, clinical intelligence, portal tab prefs — all intentional UX/session state.

### 6.3 Client → server endpoint mismatches

None found for main flows. Plexus Bank does not call server (module is client-only).

### 6.4 Server routes without live client consumer

None found for the 274+ registered routes.

### 6.5 Feature-flag-gated live paths (OFF today)

`server/lib/featureFlags.ts:17-26`:

- `internalDirectMessages` OFF
- `portalAssistant` OFF
- `clinicalIntelligenceLive` OFF
- `clinicianPortalBackend` OFF

### 6.6 Twilio / patient-SMS residuals

Zero live code. Only comments documenting the intentional retirement. Pre-existing dead auth exemption at `server/routes.ts:210-214` for `/sms/twilio/inbound` — unreachable (no route registered).

### 6.7 UI controls without persistence

- `client/src/pages/team-ops.tsx:602` — `notImplemented(label)` toast "coming soon."
- `client/src/pages/mission-control.tsx:735` — chat input disabled with "coming soon" label (honest UX).
- Plexus Bank buttons persist to localStorage only.

### 6.8 Tenant-scoping status (v2 correction)

**Global auth middleware.** `server/routes.ts:239` mounts `app.use("/api", requireAuth)` before every `registerXxxRoutes(app)` call. Every `/api/*` route (including `/api/generated-notes` at line 270) is authenticated through this global middleware.

**Verified holes remain — they are scoping/legacy issues, not authentication issues:**

- `GET /api/generated-notes` (`server/routes/generatedNotes.ts:11-18`) — authenticated but **not clinic-scoped**; returns notes from every clinic. Legacy read path used by `/ancillary-documents`.
- Execution-case lookup by name+DOB at `server/routes/executionCases.ts:412` does not add clinicId filter.
- Patient test history reads at `server/routes/testHistory.ts` use `clinic` param defaulting to `'NWPG'` (`testHistory.ts:42,74`) — no session-based clinic scoping.

Clean paths (verified from Phase 3 corrections):

- Home Stats + Mission Control repositories all take `ClinicScope` and honor it (`server/repositories/homeStats.repo.ts`, `server/repositories/missionControl.repo.ts`).
- Direct messages, workspace prefs, physician portal summary — all clinic-scoped.

## 7. Identity-Resolution Audit (unchanged; §3.1 defines the fix)

Deterministic (name+dob) grouping exists but is unwired. Same file:line evidence as v1:

| Risk | Location |
|------|----------|
| PATCH `/api/patients/:id` allows name mutation with no duplicate check | `server/routes/patients.ts:81` |
| Legacy document migration exact-name match | `server/routes/documentLibrary.ts:104` |
| Global schedule quick-schedule reuses stub by name+DOB+facility | `server/routes/globalSchedule.ts:325-354` |
| Execution-case lookup by name+DOB no clinic scope | `server/routes/executionCases.ts:412` |
| Patient test history keyed on name+DOB only, no FK | `shared/schema/patientHistory.ts:4-25` |
| Batch AI parse pre-merge on name+DOB | `server/parsers/plainText.ts::mergePatients` |

No merge/link function exists today. Soft-delete only.

## 8. Tenant-Scoping Audit (corrected v2)

See §6.8 above. Auth is global; scoping gaps are the real defect. `/api/generated-notes` is authenticated but not clinic-scoped.

## 9. Audit / History Findings (unchanged)

Journey events written for `execution_case_created`, `execution_case_updated`, `screening_committed`, `admin_approval_updated`, `document_sent`, `procedure_completed`. NOT written for payment posting, invoice approval/delivery, report upload, note signing. No false backdating in code today. Admin-review reasoning overwritten on batch re-run.

## 10. Critical Blockers

Blockers preventing a real end-to-end journey today:

1. **No canonical patient identity.**
2. **No canonical per-service ancillary case** — cannot anchor per-service Admin Review, appointment, notes, procedure, report, billing.
3. **Screening-level Admin Review** cannot express per-service decisions and has no append-only history.
4. **Appointment fragmentation** — four independent stores, no cross-sync.
5. **Note generation is one unconditional operation.** Should be two idempotent reconciliations.
6. **No note generator service** — `procedure_notes.generationStatus` stays `pending` forever.
7. **`generatedDocumentId` orphan** — billing document workflow can never link to the generated file.
8. **No claim submission.**
9. **No revenue allocation compute.**
10. **`/api/generated-notes` legacy read path is not clinic-scoped.** Corrected auth statement (§3.7): the route IS authenticated but reads across clinics.
11. **Admin-review reasoning loss on batch re-run** — `preserveAdminReviewReasoning` exists but not called.
12. **Fire-and-forget spine sync + fire-and-forget billing-readiness → document request** produce race windows.

## 11. Minimal Wiring Recommendations (see companion `docs/minimal-patient-journey-wiring-plan.md` for phase details)

See §3 above and the wiring plan document for exact phase specifications. Summary:

- Introduce `canonical_patients` (clinic-scoped, Model A).
- Introduce `patient_ancillary_cases` per (canonical patient, clinic, service, episode).
- Introduce `ancillary_case_admin_review_events` (append-only) + `patient_ancillary_cases.admin_review_status`.
- Constrain `global_schedule_events` to be the canonical appointment when it links `ancillary_case_id + service_type + one active per case`.
- Split note creation into `reconcileOrderNoteEligibility(ancillary_case_id)` + `reconcileProcedureNoteEligibility(ancillary_case_id)`.
- Add `documents.ancillary_case_id` (nullable, additive) for reports and billing documents.
- Add `billing_document_requests.ancillary_case_id`; fix `generatedDocumentId` FK.
- Add note generator + billing document generator services.
- Retire legacy `/ancillary-documents` reader; wire portal projections to canonical IDs.
- Claims strategy: in-house EDI or external RCM (product decision).

## 12. Items Requiring Product Decision

1. **Admin Review reviewer identity.** Should there be a distinct "Plexus internal clinical" role? Today: any authenticated user can approve. USER_ROLES has no `internal_reviewer` variant.
2. **Claims strategy.** Build in-house (schema + EDI 837 + clearinghouse + 835 remittance parser) OR delegate to external RCM (post charges via partner API, receive statuses via webhook)?
3. **Revenue allocation.** `projectedInvoices.projectedOurPortionPercentage` defaults to `"50"` (`shared/schema/projectedInvoices.ts:34`). Is this the canonical split? Where should the persisted ledger live?
4. **Effective clinical date.** `ancillary_case_admin_review_events.effective_clinical_date` is an optional decoupling of clinical intent from action timestamp. Should the UI expose this widely, or restrict to retroactive-review workflows?
5. **Order-note signature requirement.** `KINDS_REQUIRING_SIGNATURE = ['post_procedure_note','report']` at `server/services/ancillary/signingService.ts:51-54` excludes `order_note`. Is signing required for Order Notes?
6. **Plexus Bank future.** Retiring, moving to a real backend, or staying as a demo shell?
7. **Ancillary Documents legacy `/api/generated-notes`.** Retire completely or route through canonical `procedure_notes`?
8. **Patient-clinic membership.** If Model A ever needs upgrading to Model B (patient moves clinics), the additive `patient_clinic_memberships` linking table is the intended path.

## 13. Items Requiring Migration (future phases only)

All additive, non-destructive:

- `canonical_patients` (Model A: clinic-scoped).
- `patient_screenings.canonical_patient_id` FK.
- `patient_ancillary_cases` + composite unique constraint.
- `ancillary_case_admin_review_events` (append-only).
- `patient_ancillary_cases.admin_review_status` projection.
- `global_schedule_events.ancillary_case_id`, `parent_event_id`, `cancellation_reason`, `no_show_reason`.
- Partial unique index enforcing one active canonical appointment per ancillary_case.
- `procedure_notes.ancillary_case_id`, `notes_lineage_id`, `correction_of_note_id`, `effective_date`.
- `documents.ancillary_case_id`.
- `billing_readiness_checks.ancillary_case_id`.
- `billing_document_requests.ancillary_case_id`; convert `generatedDocumentId` to FK.
- `procedure_events` start/pause/cancel/no_show/unable_to_complete timestamps.
- `invoices.status` extend with `closed` (additive enum extension).
- `patient_journey_status(patient_screening_id)` view.

## 14. Items Not Implemented

- Canonical patient identity table (approved v2; not implemented).
- Canonical per-service ancillary case (approved v2; not implemented).
- Service-specific Admin Review history (approved v2; not implemented).
- Canonical appointment enforcement (partially — table exists; constraints not enforced).
- Split note reconciliation (approved v2; not implemented).
- Note generator service.
- Billing document generator service.
- Claims submission (product decision required).
- Revenue allocation computation.
- Journey completion aggregate view.
- Clinician Portal LinkedDocumentsPanel live data.
- Amendment chain on notes / reports.
- Reschedule lineage on appointments.
- Effective-clinical-date UI field.

## 15. Verification Appendix

Every conclusion is anchored to a file:line citation. Every commit hash is `2aaa23b`.

### Ingestion
- `server/routes/batches.ts:49-718`
- `server/routes/plexusIqClinicalImport.ts:263-543`
- `server/routes/patientDirectory.ts:191-433`
- `server/routes/testHistory.ts:24-83`
- `server/routes/appointments.ts:25-89`
- `server/services/patientCommitService.ts:71-233`

### Identity
- `shared/schema/screening.ts:46-106`
- `server/modules/patient-directory/repo.ts:3-232`
- `server/routes/patients.ts:71-174,662-865`

### Qualification / Admin Review
- `shared/schema/executionCase.ts:21,30-62,80-97`
- `shared/schema/screening.ts:70,88-93,108-114`
- `shared/schema/insuranceEligibility.ts:19-64`
- `shared/schema/cooldown.ts:26-54`
- `server/services/batchAnalysisRunner.ts:714-728`
- `shared/plexus-iq/adminReviewEvidence.ts:969-985`
- `server/services/plexusIq/adminReviewAddService.ts:153-475`
- `server/routes/patients.ts:662-865`

### Engagement / Scheduling
- `shared/schema/outreach.ts:35-60,82-122`
- `shared/schema/executionCase.ts:24-52`
- `shared/schema/globalSchedule.ts:10-77`
- `shared/schema/appointments.ts:5-30`
- `shared/schema/schedulingTriage.ts:11-79`
- `server/routes/outreach.ts:200-352`
- `server/routes/executionCases.ts:158-189,412`
- `server/routes/globalSchedule.ts:281-378`

### Notes / Procedure / Report
- `shared/schema/generatedNotes.ts:11-65`
- `shared/schema/procedureEvents.ts:11-46`
- `shared/schema/documents.ts:31-149`
- `shared/schema/documentReadiness.ts:10-100`
- `server/routes/generatedNotes.ts:11-130`
- `server/routes/procedureEvents.ts:11-82`
- `server/routes/documentLibrary.ts:89-438`
- `server/repositories/generatedNotes.repo.ts:75-132`
- `server/repositories/procedureEvents.repo.ts:162-240`
- `server/services/ancillary/signingService.ts:13-54`
- `server/services/physicianPortal/signatureRules.ts:14-144`

### Billing / Payments / Invoice
- `shared/schema/billingReadiness.ts:10-42`
- `shared/schema/billingDocuments.ts:11-46`
- `shared/schema/invoices.ts:9-121`
- `shared/schema/invoiceFinancialEvents.ts:15-79`
- `shared/schema/projectedInvoices.ts:34`
- `server/routes/billingReadiness.ts:11-50`
- `server/routes/billingDocuments.ts:11-54`
- `server/services/billing/invoiceFinancialService.ts:14-93`
- `server/repositories/billingReadiness.repo.ts:94-179`

### Auth / Tenant scoping
- `server/routes.ts:239` — `app.use("/api", requireAuth)`
- `server/routes.ts:270` — `registerGeneratedNotesRoutes(app)` (order matters: auth mounted first)
- `server/middleware/clinicContext.ts`
- `server/index.ts:85`
- `server/routes/generatedNotes.ts:11-18` (authenticated but not clinic-scoped)

### Mocks / prototypes / feature flags
- `client/src/components/physician/mockData.ts:203-214`
- `client/src/pages/plexus-bank/mockData.ts:355-590`
- `client/src/components/portal/messaging/mockPortalMessages.ts`
- `client/src/pages/plexus-iq-prototype.tsx`
- `client/src/pages/home-preview.tsx`
- `server/lib/featureFlags.ts:17-26`
- `server/routes.ts:210-214` (dead Twilio auth exemption)
