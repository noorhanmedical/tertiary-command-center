# Minimal Patient Journey Wiring Plan — v2

**Purpose:** Proposed implementation sequence to bring the patient journey to end-to-end continuity, based strictly on the findings in `docs/full-patient-journey-platform-audit.md` (v2) and `docs/ancillary-document-visualization-map.md` (v2).

**Status:** Proposal only. Not implemented. Awaits owner approval of the phase order below.

**Revision v2:** Incorporates owner corrections — serial-int canonical patient PK, Model A (clinic-scoped) recommended, `patient_ancillary_cases` introduced as per-service canonical, split note-generation into `reconcileOrderNoteEligibility` + `reconcileProcedureNoteEligibility`, phase order reflows to 2A → 2K.

**Repository baseline:** `main` at `2aaa23b`.

## Guiding Principles

1. **Preserve the existing UI.** No layout, color, spacing, typography, or navigation changes. Data-contract additions are optional fields the current UI ignores.
2. **Reuse canonical tables.** Do not create competing sources of truth.
3. **Additive schema only.** New columns nullable with defaults; new tables reference existing canonical IDs. No destructive migrations. No `TRUNCATE`. No column removal.
4. **Feature-flag every write path** that isn't a pure read swap. Default OFF. Flip only after E2E green.
5. **Incremental PRs.** Each phase is a small stack; each stack has a rollback plan.
6. **Test gates at every step.** Static contract test + unit + Playwright targeted, then full 39-test suite + operator-confirmed at every stage boundary.
7. **Do NOT restore Twilio / patient SMS / patient messaging.** The retirement is verified and must stay.
8. **Separate schema work from wiring work.** Schema PR lands first (approved and applied); wiring PR uses the new column.
9. **Separate document wiring from claim/payment work.** Documents/notes can be rewired without touching finance.
10. **Prioritize minimum viable end-to-end continuity.** The shortest path from ingested patient → clinically closed + financially closed.
11. **Follow the repo's ID convention.** Every new canonical table uses `serial` int primary keys (matches `patient_screenings`, `patient_execution_cases`, `procedure_notes`, `documents`, `invoices`, etc.). `users.id` is the exception (uuid via `gen_random_uuid()`); do not generalize that exception to other domains.
12. **Never backdate action timestamps.** Introduce `effective_clinical_date` as a separate optional field when clinical intent differs from action time.

## Dependency Graph

```
2A: Canonical patient identity + tenant-scoped resolution
      ↓  (canonical patient rows stable per clinic)
2B: Canonical per-service ancillary case (patient_ancillary_cases)
      ↓  (per-service anchors exist for every downstream artifact)
2C: Service-specific Admin Review + qualification linkage
      ↓  (per-service approval history is authoritative)
2D: One canonical appointment across all surfaces
      ↓  (appointments link to ancillary_case + service_type; single active per case)
2E: Unified Ancillary Documents read model + Order Note lifecycle
      ↓  (reconcileOrderNoteEligibility runs after Admin Review AND scheduling)
2F: Procedure event, report, and Procedure Note lifecycle
      ↓  (reconcileProcedureNoteEligibility runs after procedure + report)
2G: Billing readiness + Billing Document lifecycle
      ↓  (billing document has a real FK to a canonical documents row)
2H: Clinician Portal live-data replacement
      ↓  (physician surface reads canonical state)
2I: PCS and ACS canonical visualization
      ↓  (portals show canonical documents)
2J: Claims, remittance, payment, invoice, allocation, journey completion
      ↓
2K: Full beginning-to-end E2E
```

Order is deliberate: **do not swap 2D before 2B** (appointments anchor on `ancillary_case_id`, which must exist first). **Do not swap 2G before 2F** (billing readiness needs the procedure/report/note lifecycle stable). **Do not swap 2H before 2E** (Clinician Portal reads the same canonical `procedure_notes`, which becomes the display source in 2E).

## Phase 2A — Canonical patient identity + tenant-scoped resolution

**Goal:** One durable identifier per real-world patient inside a clinic. Immune to name / DOB corrections. No cross-tenant leakage.

**Model recommendation: Model A (one canonical patient per clinic).**

Reasons:

- The current schema is tenant-partitioned at every domain table with `clinic_id` (`shared/schema/screening.ts:52`, `shared/schema/executionCase.ts:33`, etc.). Model A aligns with the existing partition.
- The unwired canonical grouping (`server/modules/patient-directory/repo.ts:3-232`) groups on `(lower(trim(name)), dob)`. Grafting `clinic_id` onto the algorithm is straightforward.
- `clinicContext` middleware (`server/middleware/clinicContext.ts`, mounted `server/index.ts:85`) already enforces per-request clinic scoping. Model A preserves that.
- Model B (global identity + `patient_clinic_memberships`) can be added later as an additive linking table if cross-clinic portability becomes required. Model B first is harder to add-later.

**Schema (additive; no destructive changes):**

- New table `canonical_patients`:
  - `id` serial PK
  - `clinic_id` int NOT NULL FK → clinics.id
  - `name_normalized` text NOT NULL (lower(trim(name)))
  - `dob` text NOT NULL
  - `display_name` text (the current-best-known display casing)
  - `first_screening_id` int NULL FK → patient_screenings.id
  - `merged_into_canonical_patient_id` int NULL FK → canonical_patients.id (self, for merge lineage)
  - `created_at` timestamptz DEFAULT now()
  - `updated_at` timestamptz DEFAULT now()
  - unique `(clinic_id, name_normalized, dob) WHERE merged_into_canonical_patient_id IS NULL`
- New nullable column `patient_screenings.canonical_patient_id` int NULL FK → canonical_patients.id.

**Backfill (one-shot script; not a `drizzle-kit push`):**

- For each distinct `(patient_screenings.clinic_id, lower(trim(name)), dob)` group, insert a canonical_patients row; set `first_screening_id` to the lowest patient_screenings.id in the group; set `patient_screenings.canonical_patient_id` on every member.
- Idempotent (upsert).
- Runs outside `drizzle-kit push` — dedicated migration file under `migrations/` with numeric ordinal; execution gated on operator command in Replit.

**Wiring (feature-flagged `FEATURE_CANONICAL_PATIENT_WRITE`, default OFF):**

- Every ingest path (batches, plexus-iq clinical import, patient directory, appointments stub) sets `canonical_patient_id` on the new screening row at write time.
- `PATCH /api/patients/:id` on name change: recompute `name_normalized`, check for `(clinic_id, name_normalized, dob)` collision in `canonical_patients`. If collision, refuse OR open an admin merge task (product decision — flag `FEATURE_PATIENT_MERGE_STRICT`).
- New endpoint `POST /api/patients/merge` (admin, flag `FEATURE_PATIENT_MERGE`): sets `merged_into_canonical_patient_id`. Reads always follow the merge chain.
- Repository helpers: `getCanonicalPatientForScreening(screeningId)`, `listScreeningsForCanonical(canonicalId)`.
- Retire the unwired `server/modules/patient-directory/repo.ts` in favor of the wired path.

**Test gates:**

- Static architecture test: `patient_screenings.canonical_patient_id` non-null after backfill runs.
- Unit tests: `tests/unit/canonicalPatientIdentity.test.ts` — backfill hash matches, merge chain resolves, PATCH name change refuses on collision.
- E2E: Playwright canonical-route smoke still passes; no UI behavior change.

**Rollback:** Drop the FK reference in code; `canonical_patients` stays as orphan. No data lost.

**Feature flags:** `FEATURE_CANONICAL_PATIENT_WRITE`, `FEATURE_PATIENT_MERGE`, `FEATURE_PATIENT_MERGE_STRICT` — all default OFF.

## Phase 2B — Canonical per-service ancillary case (`patient_ancillary_cases`)

**Goal:** Every downstream artifact anchors on a per-service canonical row instead of the (patient_screening_id, service_type) composite.

**Schema (additive):**

- New table `patient_ancillary_cases`:
  - `id` serial PK
  - `canonical_patient_id` int NOT NULL FK → canonical_patients.id
  - `patient_screening_id` int NULL FK → patient_screenings.id (the screening that qualified this service)
  - `execution_case_id` int NULL FK → patient_execution_cases.id (engagement container)
  - `clinic_id` int NOT NULL FK → clinics.id
  - `service_type` text NOT NULL
  - `lifecycle_status` text NOT NULL DEFAULT 'new' — enum: new, active, on_hold, closed, cancelled, archived
  - `qualification_status` text NULL — inherits enum: unscreened / qualified / not_qualified / pending_review
  - `admin_review_status` text NOT NULL DEFAULT 'pending' — enum: pending, approved, needs_info, rejected
  - `canonical_appointment_id` int NULL FK → global_schedule_events.id (v2)
  - `created_at` timestamptz DEFAULT now()
  - `updated_at` timestamptz DEFAULT now()
  - `clinically_completed_at` timestamptz NULL
  - `financially_completed_at` timestamptz NULL
  - unique `(canonical_patient_id, clinic_id, service_type, execution_case_id) WHERE execution_case_id IS NOT NULL`
  - index `(clinic_id)`, `(canonical_patient_id)`, `(execution_case_id)`

**Backfill (one-shot):**

- For each existing `patient_execution_cases` row, for each `selectedServices[]` entry, upsert one `patient_ancillary_cases` row with:
  - `canonical_patient_id` from the screening's canonical_patient_id (Phase 2A backfill must run first).
  - `patient_screening_id` from the execution case's patient_screening_id.
  - `execution_case_id` from the execution case.
  - `clinic_id` from the execution case.
  - `service_type` from the array element.
  - Derive `qualification_status` from the screening + execution_case fields.
  - Derive `admin_review_status` from `patient_screenings.adminApprovalStatus` (screening-level today; per-service later).
  - Leave `canonical_appointment_id` NULL until Phase 2D.

**Wiring (feature-flagged `FEATURE_ANCILLARY_CASE_WRITE`, default OFF):**

- Every path that adds an ancillary service to a screening (Admin Review add ancillary, qualifying tests update, admin manual add) upserts a matching `patient_ancillary_cases` row.
- `selectedServices[]` on `patient_execution_cases` becomes a projection of the ancillary_case rows for that execution case; reads project through the ancillary_cases table.
- `patient_execution_cases.engagementStatus` remains the engagement/outreach status; per-service status lives on `patient_ancillary_cases`.

**Test gates:**

- Static architecture test: `patient_ancillary_cases` FK integrity (canonical_patient_id NOT NULL, clinic_id NOT NULL).
- Unit tests: backfill idempotency; upsert on Admin Review add.
- Static tests: existing per-service tables (`procedure_notes`, `procedure_events`, `case_document_readiness`, `billing_readiness_checks`, `billing_document_requests`) are ready to add `ancillary_case_id` column in later phases without conflict.

**Rollback:** Table stays as orphan; upsert calls behind feature flag can be disabled.

**Feature flags:** `FEATURE_ANCILLARY_CASE_WRITE`, default OFF.

## Phase 2C — Service-specific Admin Review + qualification linkage

**Goal:** Approval / denial per ancillary case with append-only history. Screening-level status becomes a computed projection.

**Schema (additive):**

- New table `ancillary_case_admin_review_events`:
  - `id` serial PK
  - `ancillary_case_id` int NOT NULL FK → patient_ancillary_cases.id
  - `service_type` text NOT NULL (denormalized for audit)
  - `previous_status` text — enum: pending / approved / needs_info / rejected
  - `new_status` text NOT NULL — same enum
  - `reviewer_user_id` varchar NOT NULL FK → users.id
  - `reviewer_role` text NOT NULL (captured at write from session.role)
  - `actual_reviewed_at` timestamptz NOT NULL DEFAULT now() — never backdated
  - `effective_clinical_date` text NULL (YYYY-MM-DD)
  - `rationale` text NULL
  - `evidence_snapshot` jsonb NOT NULL DEFAULT '{}' — captures reasoning at review time
  - `created_at` timestamptz DEFAULT now()
  - index `(ancillary_case_id)`, `(reviewer_user_id)`, `(created_at)`

**Wiring (flag `FEATURE_SERVICE_SPECIFIC_ADMIN_REVIEW`, default OFF):**

- New endpoint `POST /api/ancillary-cases/:id/admin-review` accepting `{ new_status, effective_clinical_date?, rationale? }`. Inserts the event row and updates `patient_ancillary_cases.admin_review_status`.
- **Prohibit `POST /api/patient-screenings/:id/admin-approval` from being called directly** when the flag is ON. During transition, existing endpoint auto-fans out to every ancillary_case for the screening (approving them all with the same status).
- Screening-level `patient_screenings.adminApprovalStatus` is computed:
  - `approved` iff every ancillary_case is `approved`
  - `needs_info` iff any is `needs_info`
  - `rejected` iff every is `rejected`
  - `pending` otherwise
- Wire `preserveAdminReviewReasoning` at `server/services/batchAnalysisRunner.ts:714-728` so admin `adminReview:*` keys survive batch re-run (audit §5.2 defect).

**Reviewer role:** If a distinct "Plexus internal clinical" role is approved (§12.1 product decision), add `internal_reviewer` to `USER_ROLES` and gate the endpoint on that role. Meanwhile the endpoint captures `reviewer_role = session.role` for honest audit.

**Test gates:**

- Unit tests: `tests/unit/ancillaryAdminReviewHistory.test.ts` — history row inserted per call; timestamps never backdated; projection matches expected computation.
- E2E: no UI change.

**Rollback:** Feature flag OFF returns to screening-level approval.

**Feature flags:** `FEATURE_SERVICE_SPECIFIC_ADMIN_REVIEW`, default OFF.

## Phase 2D — One canonical appointment across all surfaces

**Goal:** `global_schedule_events` is sole canonical appointment store. Every UI surface reads from it.

**Schema (additive):**

- New columns on `global_schedule_events`:
  - `ancillary_case_id` int NULL FK → patient_ancillary_cases.id (nullable during backfill; enforced NOT NULL for `event_type IN ('ancillary_appointment', 'same_day_add')` via check constraint after backfill).
  - `parent_event_id` int NULL FK → global_schedule_events.id (self, for reschedule lineage).
  - `cancellation_reason` text NULL.
  - `no_show_reason` text NULL.
- New nullable column `ancillary_appointments.global_schedule_event_id` int (back-pointer for legacy reads).
- New partial unique index: `UNIQUE (ancillary_case_id) WHERE event_type IN ('ancillary_appointment','same_day_add') AND status = 'scheduled'` — enforces one active appointment per ancillary_case.
- Extend `global_schedule_events.status` enum with `'rescheduled'` (additive).

**Backfill (one-shot):**

- For each `ancillary_appointments` row, upsert a matching `global_schedule_events` row (`event_type='ancillary_appointment'`, `source='backfill'`), link back via `ancillary_appointments.global_schedule_event_id`.
- Populate `ancillary_case_id` from the ancillary_case table via `(canonical_patient, clinic, service_type)` lookup.
- Populate `service_type` from ancillary_appointments.
- Idempotent.

**Wiring (flag `FEATURE_CANONICAL_APPOINTMENT`, default OFF):**

- Every new appointment writes both `global_schedule_events` (canonical) AND `ancillary_appointments` (compat projection) atomically until the projection is retired.
- Reschedule: create new row with `parent_event_id`; mark old row `status='rescheduled'`.
- Cancellation: mark row `status='cancelled'`; record `cancellation_reason`.
- No-show: mark row `status='no_show'`; record `no_show_reason`.
- Completion: mark row `status='completed'`. Fires procedure-complete side-effect if `procedure_events` row exists.
- Consolidate outreach call-outcome writers into a single `recordCallOutcome(scope)` transaction (audit §5.4 defect).
- Retire writes to `patient_screenings.appointmentStatus`; compute derived state instead.
- Retire writes to `patient_execution_cases.engagementStatus` where they duplicate appointment truth (keep only outreach-derived engagement transitions).

**Test gates:**

- Unit: `tests/unit/canonicalAppointment.test.ts` — one active per ancillary_case; reschedule lineage; cancellation reason preserved.
- Integration (Playwright API): backfill produces stable IDs; every surface reads consistent status.
- E2E: canonical-route smoke passes.

**Rollback:** Feature flag OFF re-enables the legacy dual-write; new columns stay as nullable projections.

**Feature flags:** `FEATURE_CANONICAL_APPOINTMENT`, default OFF.

## Phase 2E — Unified Ancillary Documents read model + Order Note lifecycle

**Goal:** `/ancillary-documents` reads from canonical `procedure_notes` + `documents`, not legacy `/api/generated-notes`. Order Note lifecycle uses `reconcileOrderNoteEligibility(ancillary_case_id)`.

**Schema (additive):**

- New column `procedure_notes.ancillary_case_id` int NULL FK → patient_ancillary_cases.id.
- New column `procedure_notes.notes_lineage_id` uuid NULL — lineage grouping for corrections/amendments.
- New column `procedure_notes.correction_of_note_id` int NULL FK → procedure_notes.id (self, amendment link).
- New column `procedure_notes.effective_date` text NULL (YYYY-MM-DD, optional clinical effective date).
- Extend `procedure_notes.signatureStatus` enum with `'voided'` (additive).

**Backfill (one-shot):**

- For each existing `procedure_notes` row, populate `ancillary_case_id` by looking up via `(patient_screening_id, service_type)` → ancillary_case row.
- Populate `notes_lineage_id = gen_random_uuid()` per unique `(ancillary_case_id, noteType)` group.

**Wiring (flag `FEATURE_ORDER_NOTE_ELIGIBILITY_STRICT`, default OFF):**

- Implement `reconcileOrderNoteEligibility(ancillary_case_id)`:
  - Precondition: `patient_ancillary_cases.admin_review_status = 'approved'` AND active canonical appointment exists.
  - If both true and no order note lineage exists: insert `procedure_notes` row with `noteType='order_note'`, `notes_lineage_id=<new uuid>`, `generationStatus='pending'`. Trigger generator (below).
  - If lineage exists but Admin Review changed since generation: insert amendment row with `correction_of_note_id=<prior>`.
  - If preconditions become false: transition lineage head to `signatureStatus='voided'`.
- Trigger points:
  - Admin Review status change (Phase 2C event).
  - Canonical appointment created/rescheduled (Phase 2D event).
- **Order Note generator service** (`server/services/notes/generatorService.ts`, new): transitions `generationStatus: pending → generating → generated`. Template + AI call.
- Retire `createPendingProcedureNotes` unconditional call at `server/repositories/procedureEvents.repo.ts:233-240` for order_note (procedure_note branch stays until Phase 2F).
- **Retire legacy `/api/generated-notes` display on `/ancillary-documents`:**
  - New read path: `procedure_notes` for order+procedure notes; `documents` for reports and billing docs; `case_document_readiness` for readiness state.
  - Mapping layer at the client hook translates legacy `docKind` values (`preProcedureOrder`, `postProcedureNote`, `billing`, `screening`) → canonical `(noteType, kind)`. Zero UI change.
- Add clinic scoping to `/api/generated-notes` (or delete route once no client consumes it).

**Test gates:**

- Unit: `tests/unit/reconcileOrderNoteEligibility.test.ts` — preconditions enforced; idempotent; amendment lineage correct.
- Static architecture: no client file imports `/api/generated-notes` after this phase.
- Playwright: `/ancillary-documents` renders unchanged UI with data now sourced from `procedure_notes`.

**Rollback:** Feature-flag OFF the eligibility gate; legacy route + display re-enabled.

**Feature flags:** `FEATURE_ORDER_NOTE_ELIGIBILITY_STRICT`, `FEATURE_NOTE_GENERATOR`, `FEATURE_ANCILLARY_DOCS_CANONICAL_READ`.

## Phase 2F — Procedure event, report, and Procedure Note lifecycle

**Goal:** Real procedure state machine. `reconcileProcedureNoteEligibility(ancillary_case_id)` gates the Procedure Note. Report linkage is anchored to ancillary_case.

**Schema (additive):**

- New columns on `procedure_events`:
  - `ancillary_case_id` int NULL FK → patient_ancillary_cases.id.
  - `started_at`, `paused_at`, `cancelled_at`, `no_show_at`, `unable_to_complete_at` timestamptz NULL.
  - `unable_to_complete_reason` text NULL.
- New nullable column `documents.ancillary_case_id` int FK → patient_ancillary_cases.id (for reports and billing documents; other document kinds may remain unlinked).

**Wiring (flags `FEATURE_PROCEDURE_STATE_MACHINE`, `FEATURE_PROCEDURE_NOTE_ELIGIBILITY_STRICT`):**

- New endpoints: `POST /api/procedure-events/start`, `.../pause`, `.../resume`, `.../cancel`, `.../no-show`, `.../unable-to-complete`. Each transitions `procedureStatus` deterministically.
- Prerequisites classified in code:
  - **Hard procedure blocker** — canonical patient identity, valid appointment, active clinic tenancy.
  - **Soft operational warning** — missing consent (warn, allow), missing screening form (warn).
  - **Documentation follow-up** — missing marketing intake form.
  - **Billing blocker (not procedure blocker)** — missing insurance verification, missing authorization.
  - **Claim-submission blocker (not procedure)** — missing coding.
- Implement `reconcileProcedureNoteEligibility(ancillary_case_id)`:
  - Precondition: `procedure_events` row with `procedureStatus='complete'` for the ancillary_case AND `documents` row with `kind='report'` AND `ancillary_case_id` linked (and non-null blob or authoritative external link).
  - If both true and no procedure_note lineage exists for the ancillary_case: insert `procedure_notes` row with `noteType='post_procedure_note'`, `notes_lineage_id=<new>`, `generationStatus='pending'`. Trigger generator.
  - If report replaced: insert amendment row within existing lineage.
  - If procedure reverted (cancelled/unable_to_complete): void the lineage head.
- Trigger points:
  - `procedure_events.procedureStatus` transitions to `complete`.
  - `documents` row inserted or updated with `kind='report'` + linked ancillary_case_id.
- **Procedure Note generator service** (extends 2E generator or a companion): transitions `generationStatus: pending → generating → generated`. Template pulls procedure_event + report + patient context.
- Retire `createPendingProcedureNotes` for `post_procedure_note` (order_note branch retired in 2E).
- Report upload path: after write, invoke `reconcileProcedureNoteEligibility` for the ancillary_case.

**Test gates:**

- Unit: `tests/unit/reconcileProcedureNoteEligibility.test.ts`.
- Unit: `tests/unit/procedureLifecycle.test.ts` — every state transition endpoint exists.
- Playwright: ACS workspace exercises start/complete/cancel/no-show; procedure note appears after report upload.

**Rollback:** Additive endpoints can be unregistered.

**Feature flags:** `FEATURE_PROCEDURE_STATE_MACHINE`, `FEATURE_PROCEDURE_NOTE_ELIGIBILITY_STRICT` — default OFF.

## Phase 2G — Billing readiness + Billing Document lifecycle

**Goal:** Billing document request atomically produces a canonical `documents` row via a real generator. `generatedDocumentId` becomes a real FK.

**Schema (additive):**

- New column `billing_readiness_checks.ancillary_case_id` int NULL FK → patient_ancillary_cases.id.
- New column `billing_document_requests.ancillary_case_id` int NULL FK → patient_ancillary_cases.id.
- Convert `billing_document_requests.generatedDocumentId` from bare int to FK → documents.id (still nullable; enforce FK at DB level only after clean-data verification).
- New columns on billing_document_requests: `attempt_count` int DEFAULT 0, `last_error_at` timestamptz NULL.
- New column `invoices.billing_document_request_id` int NULL FK → billing_document_requests.id.

**Backfill:**

- For each existing `billing_readiness_checks` and `billing_document_requests` row, populate `ancillary_case_id` via `(patient_screening_id, service_type)` lookup.

**Wiring (flag `FEATURE_BILLING_DOCUMENT_GENERATOR`, default OFF):**

- Merge fire-and-forget flow (`server/repositories/billingReadiness.repo.ts:173`) into a single transaction: readiness evaluation + billing_document_requests upsert.
- **Billing document generator service** (`server/services/billing/documentGenerator.ts`, new):
  - Renders billing document (PDF or structured) from encounter + templates.
  - Writes to `documents` table with `kind='billing_document'` + `patientScreeningId` + `ancillary_case_id` + `sourceNotes` marker.
  - Sets `billing_document_requests.generatedDocumentId = new documents.id`.
  - Transitions `requestStatus: pending → generating → generated`.
- On successful generation, create/link a draft `invoices` row via `invoices.billing_document_request_id`.
- Reconciliation cron job: catch orphaned `billing_readiness_checks.readinessStatus='ready_to_generate'` rows without a request; retry with capped attempt_count.
- Retire `reconcileCanonicalDuplicates` referenced-but-missing script mention (`server/repositories/billingDocuments.repo.ts:76`).

**Test gates:**

- Unit: `tests/unit/billingDocumentGeneration.test.ts`.
- Integration: end-to-end from procedure-complete → report-uploaded → note-signed → billing-readiness → billing-document → invoice-draft.
- Playwright: Billing workspace shows generated document link.

**Rollback:** Feature flag OFF; generator becomes inert; nullable FK stays.

**Feature flags:** `FEATURE_BILLING_DOCUMENT_GENERATOR`, default OFF.

## Phase 2H — Clinician Portal live-data replacement

**Goal:** LinkedDocumentsPanel + Finance surfaces read live data instead of empty mock arrays.

**No schema change.**

**Wiring (flag `FEATURE_CLINICIAN_PORTAL_LIVE_DOCS`, default OFF):**

- Extend `server/routes/physicianPortal.ts` (already gated by `FEATURE_CLINICIAN_PORTAL_BACKEND=false` today — see `server/lib/featureFlags.ts:17-26`):
  - `GET /api/physician-portal/linked-documents?patientScreeningId=` — returns `procedure_notes` + `documents` for the physician's assigned patients, filtered by ancillary_case_id or patient_screening_id.
  - `GET /api/physician-portal/audit-events?patientScreeningId=` — returns `patient_journey_events` filtered for physician-relevant types.
- Client hooks: `useLinkedDocuments`, `useAuditEvents` — replace `mockData.DOCUMENTS`/`mockData.AUDIT_EVENTS` imports at `client/src/components/physician/orders/OrdersNotesPage.tsx:18-20`.
- Preserve the LinkedDocumentsPanel UI exactly.

**Test gates:**

- Unit: `tests/unit/physicianLinkedDocuments.test.ts` — service returns only physician-scoped patients.
- Playwright: LinkedDocumentsPanel renders live documents when patient has procedure notes.

**Rollback:** Revert client hooks to mockData imports.

**Feature flags:** `FEATURE_CLINICIAN_PORTAL_LIVE_DOCS`, default OFF. Coordinates with existing `FEATURE_CLINICIAN_PORTAL_BACKEND`.

## Phase 2I — PCS + ACS canonical visualization

**Goal:** PCS and ACS portals reference canonical document IDs; no independent projections.

**No schema change.**

**Wiring (no new flag; bundled with 2E `FEATURE_ANCILLARY_DOCS_CANONICAL_READ`):**

- Consolidate document-panel data hooks in the portal shell:
  - Reports: `documents` with `kind='report'` + `case_document_readiness.documentStatus`.
  - Order/Procedure notes: `procedure_notes` (canonical).
  - Consent / Screening Form: `documents` with `kind='informed_consent'`/`screening_form`.
- Remove any surface-side reference to legacy `generated_notes`.
- Small mapping layer folds legacy `docKind` values into canonical `(noteType, kind)`.
- UI identical.

**Test gates:**

- Static architecture: no PCS/ACS component imports `/api/generated-notes`.
- Playwright: portal document panels render live documents identical to Ancillary Documents.

**Rollback:** Revert client hooks.

## Phase 2J — Claims, remittance, payment, invoice, allocation, journey completion

**Goal:** Real claim → payment → invoice → allocation pipeline. Product decision required (audit §12.2).

**Two options — pick one before implementation:**

### Option A: In-house claims pipeline

- Schema (all additive): `claim_submissions`, `claim_submission_events`, `payer_remittance_files`, `revenue_allocations`.
- EDI 837 formatter + clearinghouse SFTP adapter (Change Healthcare or Availity).
- 835 remittance file parser.
- Feature flag: `FEATURE_CLAIMS_INHOUSE`, default OFF.

### Option B: Delegate to external RCM

- Adapter service posts encounters to partner API.
- Ingest partner statuses via webhook.
- Minimal schema: `claim_status_snapshots`, `revenue_allocations`.
- Feature flag: `FEATURE_CLAIMS_EXTERNAL`, default OFF.

**Common wiring:**

- Add `invoices.status = 'closed'` (additive enum extension). Transition from `Paid` when all balances = 0 for N days.
- Compute revenue allocation from `projectedInvoices.projectedOurPortionPercentage` + adjustments. Add `revenue_allocations(invoice_id, clinic_id, plexus_amount, clinic_amount)`.
- Journey completion timestamps on `patient_ancillary_cases`:
  - Set `clinically_completed_at` when procedure event complete + procedure note signed.
  - Set `financially_completed_at` when invoice closed and any allocation posted.
- Emit `patient_journey_events` for payment posting, invoice approval/delivery/close (audit §9 defect).

**Test gates:**

- Unit: claim submission flow (mocked clearinghouse or partner API).
- Integration: end-to-end from paid invoice → allocation posted → `financially_completed_at` set.
- Playwright: full journey scenario.

**Rollback:** All behind feature flags.

## Phase 2K — Full beginning-to-end E2E

**Goal:** A single Playwright test drives a patient from ingestion to fully closed. Mission Control finance activates.

**Deliverables:**

- Add view `patient_journey_status(patient_screening_id)` returning the discrete list of completed stages:
  - qualification_complete
  - admin_review_complete (per service — aggregated across ancillary_cases)
  - engagement_complete
  - scheduling_complete
  - order_note_signed (if required per §12.5)
  - procedure_complete
  - report_uploaded
  - procedure_note_signed
  - billing_ready
  - billing_document_generated
  - claim_submitted (if 2J option A) OR claim_snapshot_received (if 2J option B)
  - payment_received
  - invoice_closed
  - clinically_closed (patient_ancillary_cases.clinically_completed_at set)
  - financially_closed (patient_ancillary_cases.financially_completed_at set)
  - fully_closed (both set)
- Turn ON Mission Control finance section (Phase 3 correction currently keeps `sections.finance.sourceMissing=true` deliberately).
- New Playwright spec: `tests/e2e/interactions/full-journey.spec.ts`.

**Rollback:** Feature-flag Mission Control finance activation.

## Cross-cutting hygiene items (separate small PRs)

### Retire legacy `/sms/twilio/inbound` auth exemption

Pre-existing dead code at `server/routes.ts:210-214` (introduced by `e23face` before Phase 1). No route registered under that path. Remove the 3-line exemption in a hygiene commit.

### Retire legacy `uploaded_documents` name-based match

Under Phase 2A, rewrite `documentLibraryLegacy.repo.ts::findLatestPatientScreeningByExactName` to prefer `canonical_patient_id + dob` join. Deprecate exact-name matching.

### Retire unwired `server/modules/patient-directory/*`

Under Phase 2A, the wired canonical patient identity replaces this module. Delete after Phase 2A merges.

### Plexus Bank isolation

Gate `client/src/pages/plexus-bank*` behind `?sandbox=1` OR an admin-only preview flag. Do not delete — it's a design deliverable.

### Prototype routes

`/home-preview` and `/plexus-iq-prototype` — gate behind admin-only wrapper or move under `/sandbox/*`.

## Migration Dependencies (future phases only — none in Phase 1 or this v2 revision)

All additive, non-destructive.

| Phase | New table | New column | Notes |
|-------|-----------|------------|-------|
| 2A | `canonical_patients` (clinic-scoped) | `patient_screenings.canonical_patient_id` | Backfill via one-shot script; not `drizzle-kit push` |
| 2B | `patient_ancillary_cases` | (populated via backfill from execution_cases + selectedServices) | Composite unique key |
| 2C | `ancillary_case_admin_review_events` (append-only) | `patient_ancillary_cases.admin_review_status` | History immutable |
| 2D | (none) | `global_schedule_events.ancillary_case_id`, `parent_event_id`, `cancellation_reason`, `no_show_reason`; `ancillary_appointments.global_schedule_event_id`; extend status enum with `rescheduled`; partial unique index one-per-case | Backfill script |
| 2E | (none) | `procedure_notes.ancillary_case_id`, `notes_lineage_id`, `correction_of_note_id`, `effective_date`; extend signatureStatus with `voided` | |
| 2F | (none) | `procedure_events.ancillary_case_id`, `started_at`, `paused_at`, `cancelled_at`, `no_show_at`, `unable_to_complete_at`, `unable_to_complete_reason`; `documents.ancillary_case_id` | |
| 2G | (optional index) | `billing_readiness_checks.ancillary_case_id`; `billing_document_requests.ancillary_case_id` + convert `generatedDocumentId` to FK; `attempt_count`, `last_error_at`; `invoices.billing_document_request_id` | Enforce FK after clean data |
| 2J option A | `claim_submissions`, `claim_submission_events`, `payer_remittance_files`, `revenue_allocations` | Extend `invoices.status` with `closed` | |
| 2J option B | `claim_status_snapshots`, `revenue_allocations` | Same enum extend | |
| 2K | (none) | `patient_journey_status` VIEW | Compute-only |

## Test Gates and E2E Gates (universal)

Every phase gate:

- `npm run check` exit 0
- `npm run test:unit` all passing
- `npm run build` exit 0
- `git diff --check` exit 0
- Playwright canonical UI manifest test still passes for all protected files
- No new imports of `@/pages/plexus-bank/mockData` outside `client/src/pages/plexus-bank/*`
- No new imports of `mockPortalMessages` outside `client/src/components/portal/messaging/*`
- No new `.name === ` matches on patient/document/appointment tables
- No new writes to `patient_screenings.appointmentStatus` after Phase 2D
- No new writes to legacy `/api/generated-notes` write path (route is authenticated — audit §3.7 — but legacy read display is retired in 2E)
- No new client-side hardcoded medical or billing data
- Operator-confirmed Replit production Playwright: 39 / 39 (or expanded matching set) passes before merging any phase

## Do Not

- Do not begin ANY of Phase 2A–2K during this audit v2 revision.
- Do not enable any feature flag introduced by future phases without explicit approval.
- Do not merge future PRs into `main` without Playwright green from the Replit workspace.
- Do not restore Twilio / patient SMS / patient messaging at any point.
- Do not delete mock or legacy files during Phase 1 audit. Deletion is a future phase.
- Do not create competing patient / appointment / ancillary-case / billing tables.
- Do not modify UI styling, layout, colors, spacing, typography, or navigation.
- Do not run destructive migrations. Every migration is additive.
- Do not backdate an actual action timestamp; use `effective_clinical_date` when clinical intent differs from action time.
- Do not use unsupported percentages or metrics that aren't reproducible from evidence.

## Recommended Source-of-Truth Principle — approved

- Patient Directory / Patient EHR = authoritative longitudinal visualization anchored on `canonical_patients` + `patient_ancillary_cases`.
- Ancillary Documents = global operational projection of canonical patient-linked ancillary records.
- Clinician Portal = role-specific clinical review and signature projection.
- PCS Portal = role-specific outreach, scheduling, and readiness projection.
- ACS Portal = role-specific execution, report, and readiness projection.
- Document Library = administrative file and version repository.
- Finance / Billing = role-specific financial workflow projections.

Every projection references canonical source IDs. No independent copies for display.

## Awaiting owner approval

Per Phase 1 stop condition:

1. **Canonical patient identity** — approve or refuse `canonical_patients` (serial int PK, Model A clinic-scoped).
2. **Canonical per-service ancillary case** — approve `patient_ancillary_cases` as sole ancillary case; confirm `patient_execution_cases` remains engagement/outreach container.
3. **Service-specific Admin Review** — approve `ancillary_case_admin_review_events` (append-only) + `patient_ancillary_cases.admin_review_status`; screening-level status becomes computed projection.
4. **Canonical appointment** — approve conditional `global_schedule_events` sole canonical when it links `ancillary_case_id + service_type + one active per case + reschedule lineage + cancellation/no-show reasons`.
5. **Note lifecycle split** — approve `reconcileOrderNoteEligibility` + `reconcileProcedureNoteEligibility` as separate idempotent operations. Order Note may be created before procedure workflow when its preconditions are met.
6. **Document architecture** — approved (owner confirmed).
7. **Phase order** — approve/adjust the 2A → 2K ordering above.

No implementation until each of the above has an explicit go-ahead.
