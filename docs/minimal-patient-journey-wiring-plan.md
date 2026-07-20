# Minimal Patient Journey Wiring Plan — v3

**Purpose:** Proposed implementation sequence to bring the patient journey to end-to-end continuity, based strictly on the findings in `docs/full-patient-journey-platform-audit.md` (v3) and `docs/ancillary-document-visualization-map.md` (v3).

**Status:** Proposed v3 architecture — awaiting final owner approval. Nothing here is implemented. No decision is final until an owner explicitly approves it.

**Revision v3:**

- Global patient identity is a **Plexus-central** function. Clinics perform normal clinic operations only; the resolver, review queue, merge audit, and aliases are Plexus-only.
- Six new conceptual tables introduced in Phase 2A: `global_plexus_patients`, `patient_clinic_memberships`, `patient_external_identifiers`, `patient_identity_match_candidates`, `patient_identity_merge_events`, `plexus_id_aliases`.
- Phase 2B introduces `patient_ancillary_cases` linked to `global_plexus_patient_id` + `patient_clinic_membership_id` + `episode_sequence` with partial-unique active-episode constraint.
- Canonical appointment ownership is `global_schedule_events.ancillary_case_id`; ancillary_case row does not carry `canonical_appointment_id`.
- Ancillary designation is derived from `patient_ancillary_cases` + `procedure_events`; never manually typed.

**Repository baseline:** `main` at `2aaa23b`.

## Guiding Principles

1. **Preserve the existing UI.** No layout, color, spacing, typography, or navigation changes. Data-contract additions are optional fields the current UI ignores.
2. **Reuse canonical tables.** Do not create competing sources of truth.
3. **Additive schema only.** New columns nullable with defaults; new tables reference existing canonical IDs. No destructive migrations. No `TRUNCATE`. No column removal.
4. **Feature-flag every write path** that isn't a pure read swap. Default OFF. Flip only after E2E green.
5. **Incremental PRs.** Each phase is a small stack; each stack has a rollback plan.
6. **Test gates at every step.** Static contract test + unit + Playwright targeted, then full production Playwright suite + operator-confirmed at every stage boundary.
7. **Do NOT restore Twilio / patient SMS / patient messaging.**
8. **Separate schema work from wiring work.** Schema PR lands first; wiring PR uses the new column.
9. **Separate document wiring from claim/payment work.** Documents/notes can be rewired without touching finance.
10. **Prioritize minimum viable end-to-end continuity.**
11. **Follow the repo's ID convention.** Every new canonical table uses `serial` int primary keys (matches `patient_screenings`, `patient_execution_cases`, `procedure_notes`, `documents`, `invoices`, etc.). `users.id` is the uuid exception; do not generalize that exception. Plexus ID is an additional public opaque identifier on `global_plexus_patients` — separate from the DB primary key.
12. **Never backdate action timestamps.** Introduce `effective_clinical_date` as a separate optional field when clinical intent differs from action time.
13. **Tenant isolation is invariant across every phase.** Cross-clinic identity linkage never confers cross-clinic chart visibility. Clinic users see only their own clinic's data. Search by Plexus ID enforces tenant + role authorization.
14. **Clinics never perform identity resolution.** Identity resolution, match review, merge, and alias management are Plexus-central functions invisible to clinic surfaces.

## Dependency Graph

```
2A: Global Plexus patient identity + clinic membership + Plexus-central resolver
      ↓  (global identity is stable and Plexus-only; clinics unaffected in workflow)
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
2K: Full beginning-to-end E2E + Plexus Identity Console activation
```

Order is deliberate: **do not swap 2D before 2B** — appointments anchor on `ancillary_case_id` which must exist first. **Do not swap 2G before 2F** — billing readiness needs the procedure/report/note lifecycle stable. **Do not swap 2H before 2E** — Clinician Portal reads the same canonical `procedure_notes` that 2E establishes as the display source.

## Phase 2A — Global Plexus patient identity + clinic membership + Plexus-central resolver

**Goal:** Every patient across the Plexus platform receives or resolves to one durable global Plexus ID. Clinics continue normal operations; identity resolution runs centrally in the background.

**Schema (additive; no destructive changes):**

- **New table `global_plexus_patients`** (per §3.1 of the audit):
  - `id` serial PK
  - `plexus_id` text UNIQUE NOT NULL — opaque `PLX-` + ULID-derived or secure random. Non-PHI. Not derived from name/DOB/clinic/diagnosis. Immutable after assignment.
  - `display_name` text
  - `normalized_name` text
  - `dob` text
  - `phone` text
  - `email` text
  - `address` text
  - `identity_status` text NOT NULL DEFAULT 'active' — enum: `active`, `possible_duplicate`, `merged`, `inactive`
  - `merged_into_patient_id` int NULL FK → global_plexus_patients.id (self)
  - `has_plexus_ancillary_history` boolean NOT NULL DEFAULT false (derived)
  - `first_ancillary_completed_at` timestamptz NULL (derived)
  - `most_recent_ancillary_completed_at` timestamptz NULL (derived)
  - `created_at` timestamptz DEFAULT now()
  - `updated_at` timestamptz DEFAULT now()
  - **No `clinic_id` column** — global ownership.
- **New table `patient_clinic_memberships`** (per §3.2 of the audit):
  - `id` serial PK
  - `global_plexus_patient_id` int NOT NULL FK → global_plexus_patients.id
  - `clinic_id` int NOT NULL FK → clinics.id
  - `clinic_mrn` text NULL
  - `source_system` text
  - `source_patient_identifier` text NULL
  - `membership_status` text NOT NULL DEFAULT 'active' — enum: `active`, `inactive`, `withdrawn`, `merged_away`
  - `first_seen_at` timestamptz DEFAULT now()
  - `last_seen_at` timestamptz DEFAULT now()
  - `created_at`, `updated_at`
  - Partial unique: `UNIQUE (global_plexus_patient_id, clinic_id) WHERE membership_status = 'active'`
  - Partial unique: `UNIQUE (clinic_id, source_system, clinic_mrn) WHERE clinic_mrn IS NOT NULL AND membership_status = 'active'`
- **New table `patient_external_identifiers`** (per §3.3):
  - `id` serial PK
  - `global_plexus_patient_id` int NOT NULL FK → global_plexus_patients.id
  - `patient_clinic_membership_id` int NULL FK → patient_clinic_memberships.id
  - `clinic_id` int NULL FK → clinics.id
  - `source_system` text
  - `identifier_type` text — enum: `clinic_mrn`, `ehr_patient_id`, `payer_member_id`, `medicare_identifier`, `external_import_id`, `prior_plexus_id_alias`
  - `identifier_value_encrypted` bytea (or text encrypted via pgcrypto — encryption strategy is a product decision; §15.8)
  - `normalized_or_hashed_match_value` text NULL (for equality lookups without decryption)
  - `active` boolean NOT NULL DEFAULT true
  - `created_at` timestamptz DEFAULT now()
- **New table `patient_identity_match_candidates`** (per §3.4):
  - `id` serial PK
  - `incoming_membership_id` int NULL FK → patient_clinic_memberships.id
  - `staged_import_row_id` int NULL — reference to per-import staging row (staging schema TBD)
  - `candidate_global_patient_id` int NOT NULL FK → global_plexus_patients.id
  - `match_score` numeric
  - `match_tier` text — enum: `definitive`, `high`, `medium`, `low`
  - `matched_signals` jsonb DEFAULT '[]'
  - `conflicting_signals` jsonb DEFAULT '[]'
  - `review_status` text NOT NULL DEFAULT 'pending' — enum: `pending`, `confirmed`, `rejected`, `deferred`
  - `reviewed_by_user_id` varchar NULL FK → users.id
  - `reviewed_at` timestamptz NULL
  - `review_note` text NULL
  - `created_at` timestamptz DEFAULT now()
- **New table `patient_identity_merge_events`** (per §3.5, append-only):
  - `id` serial PK
  - `surviving_global_patient_id` int NOT NULL FK → global_plexus_patients.id
  - `merged_global_patient_id` int NOT NULL FK → global_plexus_patients.id
  - `surviving_plexus_id` text NOT NULL (denormalized snapshot)
  - `merged_plexus_id` text NOT NULL (denormalized snapshot)
  - `reviewed_by_user_id` varchar NOT NULL FK → users.id
  - `reason` text
  - `evidence_snapshot` jsonb DEFAULT '{}' — immutable at write
  - `merged_at` timestamptz NOT NULL DEFAULT now() — NEVER backdated
  - Rows are immutable. Reversal is a new row, not a mutation.
- **New table `plexus_id_aliases`** (per §3.6):
  - `alias_plexus_id` text PRIMARY KEY
  - `surviving_global_patient_id` int NOT NULL FK → global_plexus_patients.id
  - `reason` text
  - `created_at` timestamptz DEFAULT now()
  - Old Plexus IDs remain searchable; never reused; never mutate.
- **New transitional columns on existing tables:**
  - `patient_screenings.patient_clinic_membership_id` int NULL FK → patient_clinic_memberships.id
  - `patient_screenings.global_plexus_patient_id` int NULL FK → global_plexus_patients.id (optional transitional projection to reduce join depth on hot paths)

**Backfill (one-shot script; NOT `drizzle-kit push`):**

- For each distinct `(clinic_id, lower(trim(name)), dob)` group in `patient_screenings`, insert or reuse a `global_plexus_patients` row.
  - Within-clinic collapse only during backfill. **Cross-clinic identity resolution is deferred to the resolver service post-backfill.**
- For each group, insert a `patient_clinic_memberships` row.
- Populate `patient_screenings.patient_clinic_membership_id` + `.global_plexus_patient_id` on every screening.
- Populate `patient_external_identifiers` from `patient_test_history` (name+dob keyed), from clinic MRN where surfaced, and from any EHR identifiers present.
- Backfill idempotent (upsert).
- Runs outside `drizzle-kit push` — dedicated migration file with numeric ordinal; execution gated on operator command in the Replit workspace.

**Wiring (feature-flagged `FEATURE_PLEXUS_IDENTITY_WRITE`, default OFF):**

- **Plexus central identity resolver service** (`server/services/identity/resolver.ts`, new):
  - Input: staged import row (name, dob, phone, insurance, MRN, source_system).
  - Search:
    1. If a `patient_external_identifiers` row matches with type `prior_plexus_id_alias` OR `clinic_mrn` within the same clinic + source, treat as **definitive** — outcome A.
    2. If Medicare/payer identifier matches AND allowed by policy AND no conflicting signals — **high** match, outcome A.
    3. If DOB + phone + strong name match AND no conflicting signals — **high** match, outcome A.
    4. If any two of (dob, phone, normalized name, insurance identifier) match — **medium** match, outcome B.
    5. Otherwise — outcome C.
  - Outcome A: reuse existing global patient; create/reuse membership; append identity event; clinic continues normally.
  - Outcome B: create `patient_identity_match_candidates` row (Plexus-only queue); clinic continues normally with a provisional global patient row + Plexus ID until reviewed. Post-review, either merge (if confirmed) or keep the new (if rejected).
  - Outcome C: create new global patient; assign new Plexus ID (`PLX-` + secure random); create membership + external identifiers.
- **Every ingest path** (batches, plexus-iq clinical import, patient directory, appointments stub, direct patient add) invokes the resolver AFTER writing the clinic-scoped staged row. Resolver runs asynchronously; the clinic workflow does not block on it.
- **`PATCH /api/patients/:id`** on name change: recompute normalized name; update the membership row's contribution to `global_plexus_patients` demographics (via a canonical update service). Do NOT auto-collision-check against global identity — that runs through the resolver.
- **New endpoints (Plexus-only, gated on Plexus role + `FEATURE_PLEXUS_IDENTITY_REVIEW`):**
  - `GET /api/plexus-identity/match-candidates` — paginated queue.
  - `POST /api/plexus-identity/match-candidates/:id/confirm` — links membership to existing global; creates alias if needed.
  - `POST /api/plexus-identity/match-candidates/:id/reject` — creates new global patient.
  - `POST /api/plexus-identity/merge` — merges two global rows (only for reviewed candidates or admin corrections).
  - `GET /api/plexus-identity/patients/:plexus_id` — Plexus-only global patient view.
  - `GET /api/plexus-identity/aliases/:alias` — resolve alias to surviving global.
- **Clinic-facing endpoints continue to join through `patient_clinic_memberships.clinic_id = req.clinicId`.** Clinic surfaces never surface a `global_plexus_patients` row directly. When a clinic renders the Plexus ID, it is the Plexus ID of the patient THIS clinic has a membership with.
- **Search by Plexus ID (clinic-facing):** returns a result only if the caller's clinic has an active membership with that patient. Alias lookups follow the same rule via `plexus_id_aliases`.
- **Ancillary designation derivation** (materialized nightly + on write):
  - `has_plexus_ancillary_history = true` iff any `patient_ancillary_cases` row with `clinically_completed_at IS NOT NULL` exists for the global patient.
  - `first_ancillary_completed_at`, `most_recent_ancillary_completed_at` — MIN/MAX of `clinically_completed_at`.
  - `ancillary_case_count`, `completed_ancillary_case_count`, `ancillary_services_completed` — aggregated.
  - Derivation service runs on ancillary case status transitions.
- **Retire unwired module** `server/modules/patient-directory/repo.ts` — replaced by the wired resolver.

**Access rules:**

- **`global_plexus_patients` rows are never returned to a clinic-facing endpoint.** Clinic endpoints join through `patient_clinic_memberships` filtered by `clinic_id = req.clinicId`.
- **Identity-review permission is Plexus-internal only.** A new role (or role modifier) is required — see product decision §15.1. Not a general clinic admin.
- **Search by Plexus ID enforces tenant + role authorization.**
- **Cross-clinic chart visibility is never granted** just because identity was linked.

**Test gates:**

- Static architecture test: no clinic-facing endpoint references `global_plexus_patients` in the response body outside a projection through `patient_clinic_memberships`.
- Static architecture test: `patient_screenings.patient_clinic_membership_id` non-null after backfill.
- Unit tests:
  - `tests/unit/plexusIdentityResolver.test.ts` — outcome A/B/C paths; alias resolution; matching-rule scoring.
  - `tests/unit/plexusIdMinting.test.ts` — Plexus ID is opaque, non-PHI, never reused after merge, alias entries created correctly.
  - `tests/unit/tenantScopingIdentity.test.ts` — clinic user cannot fetch a global patient row that has no membership for their clinic.
- E2E: Playwright canonical-route smoke passes; no clinic-facing UI behavior change.

**Rollback:** Feature flag OFF returns to today's clinic-scoped identity. Tables stay as orphans. No data lost.

**Feature flags:** `FEATURE_PLEXUS_IDENTITY_WRITE`, `FEATURE_PLEXUS_IDENTITY_REVIEW` — default OFF.

## Phase 2B — Canonical per-service ancillary case (`patient_ancillary_cases`)

**Goal:** Every downstream artifact anchors on a per-service canonical row.

**Schema (additive):**

- **New table `patient_ancillary_cases`** (per §9 of the audit):
  - `id` serial PK
  - `global_plexus_patient_id` int NOT NULL FK → global_plexus_patients.id
  - `patient_clinic_membership_id` int NOT NULL FK → patient_clinic_memberships.id
  - `clinic_id` int NOT NULL FK → clinics.id (denormalized for tenant scoping)
  - `originating_screening_id` int NULL FK → patient_screenings.id
  - `execution_case_id` int NULL FK → patient_execution_cases.id
  - `service_type` text NOT NULL
  - `episode_sequence` int NOT NULL DEFAULT 1
  - `opened_at` timestamptz DEFAULT now()
  - `closed_at` timestamptz NULL
  - `lifecycle_status` text NOT NULL DEFAULT 'new' — enum: `new`, `active`, `on_hold`, `closed`, `cancelled`, `archived`
  - `qualification_status` text NULL — enum: `unscreened`, `qualified`, `not_qualified`, `pending_review`
  - `admin_review_status` text NOT NULL DEFAULT 'pending' — enum: `pending`, `approved`, `needs_info`, `rejected`
  - `clinically_completed_at` timestamptz NULL
  - `financially_completed_at` timestamptz NULL
  - `created_at`, `updated_at`
  - **Partial unique constraint on active episodes:** `UNIQUE (global_plexus_patient_id, clinic_id, service_type) WHERE lifecycle_status IN ('new','active','on_hold')`
  - Indexes: `(clinic_id)`, `(global_plexus_patient_id)`, `(patient_clinic_membership_id)`, `(execution_case_id)`, `(service_type)`
- **No `canonical_appointment_id` column on this table.** Appointment ownership is `global_schedule_events.ancillary_case_id`. Resolver query is per §9 of the audit.

**Backfill (one-shot):**

- For each existing `patient_execution_cases` row (must have `patient_clinic_membership_id` populated by Phase 2A), for each `selectedServices[]` entry, upsert one `patient_ancillary_cases` row with:
  - `global_plexus_patient_id` from the membership.
  - `patient_clinic_membership_id` from the execution case's screening → membership.
  - `clinic_id` from the execution case.
  - `originating_screening_id` from the execution case.
  - `execution_case_id` from the execution case.
  - `service_type` from the array element.
  - `episode_sequence = 1` (or incrementing per prior closed cases for the same (global_patient, clinic, service_type)).
  - Derive `qualification_status` from screening + execution_case fields.
  - Derive `admin_review_status` from `patient_screenings.adminApprovalStatus` (screening-level today; per-service later).

**Wiring (feature-flagged `FEATURE_ANCILLARY_CASE_WRITE`, default OFF):**

- Every path that adds an ancillary service to a screening (Admin Review add ancillary, qualifying tests update, admin manual add) upserts a matching `patient_ancillary_cases` row.
- `selectedServices[]` on `patient_execution_cases` becomes a projection.
- `patient_execution_cases.engagementStatus` remains the engagement/outreach status; per-service status lives on `patient_ancillary_cases`.
- Repeat-service logic: when a new episode of an existing service is requested for the same (global_patient, clinic) and the prior episode is `closed`, create a new row with `episode_sequence = max(prev) + 1`.

**Test gates:**

- Static architecture test: `patient_ancillary_cases` FK integrity.
- Unit: `tests/unit/ancillaryCaseUniqueness.test.ts` — only one active per (global_patient, clinic, service); repeated closed cases coexist.
- Unit: `tests/unit/ancillaryCaseBackfill.test.ts` — idempotent.

**Rollback:** Table stays as orphan; upsert calls behind feature flag can be disabled.

**Feature flag:** `FEATURE_ANCILLARY_CASE_WRITE`, default OFF.

## Phase 2C — Service-specific Admin Review + qualification linkage

**Goal:** Approval / denial per ancillary case with append-only history. Screening-level status becomes a computed projection.

**Schema (additive):**

- **New table `ancillary_case_admin_review_events`** (per §5 of the audit):
  - `id` serial PK
  - `ancillary_case_id` int NOT NULL FK → patient_ancillary_cases.id
  - `service_type` text NOT NULL (denormalized)
  - `previous_status` text — enum: `pending`, `approved`, `needs_info`, `rejected`
  - `new_status` text NOT NULL — same enum
  - `reviewer_user_id` varchar NOT NULL FK → users.id
  - `reviewer_role` text NOT NULL
  - `actual_reviewed_at` timestamptz NOT NULL DEFAULT now() — **never backdated**
  - `effective_clinical_date` text NULL (YYYY-MM-DD)
  - `rationale` text NULL
  - `evidence_snapshot` jsonb NOT NULL DEFAULT '{}'
  - `created_at` timestamptz DEFAULT now()
  - Indexes: `(ancillary_case_id)`, `(reviewer_user_id)`, `(created_at)`

**Wiring (flag `FEATURE_SERVICE_SPECIFIC_ADMIN_REVIEW`, default OFF):**

- New endpoint `POST /api/ancillary-cases/:id/admin-review` accepting `{ new_status, effective_clinical_date?, rationale? }`. Inserts event + updates `patient_ancillary_cases.admin_review_status`.
- Existing `POST /api/patient-screenings/:id/admin-approval` fans out (during transition) to every ancillary_case for the screening.
- Screening-level `patient_screenings.adminApprovalStatus` is derived: `approved` iff every ancillary_case is `approved`; `needs_info` iff any is `needs_info`; `rejected` iff every is `rejected`; `pending` otherwise.
- Wire `preserveAdminReviewReasoning` at `server/services/batchAnalysisRunner.ts:714-728` so admin `adminReview:*` keys survive batch re-run (audit §5.2 defect).

**Reviewer role:** Product decision on whether a distinct Plexus-internal reviewer role should exist. Meanwhile, `reviewer_role = session.role` is captured at write.

**Test gates:**

- Unit: `tests/unit/ancillaryAdminReviewHistory.test.ts` — history row inserted per call; `actual_reviewed_at` never backdated; projection matches expected.

**Rollback:** Feature flag OFF returns to screening-level approval.

**Feature flag:** `FEATURE_SERVICE_SPECIFIC_ADMIN_REVIEW`, default OFF.

## Phase 2D — One canonical appointment across all surfaces

**Goal:** `global_schedule_events` is sole canonical appointment. Every UI surface reads from it. Appointment resolution is via query on `global_schedule_events.ancillary_case_id`.

**Schema (additive):**

- **New columns on `global_schedule_events`:**
  - `ancillary_case_id` int NULL FK → patient_ancillary_cases.id (nullable during backfill; enforce NOT NULL for `event_type IN ('ancillary_appointment','same_day_add')` via check constraint after clean data).
  - `parent_event_id` int NULL FK → global_schedule_events.id (self, reschedule lineage).
  - `cancellation_reason` text NULL
  - `no_show_reason` text NULL
- **New nullable column `ancillary_appointments.global_schedule_event_id`** int (back-pointer for legacy reads).
- **New partial unique index:** `UNIQUE (ancillary_case_id) WHERE event_type IN ('ancillary_appointment','same_day_add') AND status = 'scheduled'` — one active canonical appointment per ancillary_case.
- **Extend `global_schedule_events.status` enum** with `'rescheduled'` (additive).

**Backfill (one-shot):**

- For each `ancillary_appointments` row, upsert a matching `global_schedule_events` row (`event_type='ancillary_appointment'`, `source='backfill'`); populate the back-pointer.
- Populate `ancillary_case_id` from ancillary_case table via (global_plexus_patient_id, clinic_id, service_type) lookup.
- Idempotent.

**Wiring (flag `FEATURE_CANONICAL_APPOINTMENT`, default OFF):**

- Every new appointment writes both `global_schedule_events` (canonical) AND `ancillary_appointments` (compat projection) atomically until the projection is retired.
- Reschedule: new row + `parent_event_id`; mark old row `status='rescheduled'`.
- Cancellation: mark row `status='cancelled'`; record `cancellation_reason`.
- No-show: mark row `status='no_show'`; record `no_show_reason`.
- Completion: mark row `status='completed'`. Fires procedure-complete side-effect if `procedure_events` row exists.
- Consolidate outreach call-outcome writers into single `recordCallOutcome(scope)` transaction (audit §5.4 defect).
- Retire writes to `patient_screenings.appointmentStatus`; compute derived state.
- Retire duplicate writes to `patient_execution_cases.engagementStatus`.

**Test gates:**

- Unit: `tests/unit/canonicalAppointment.test.ts` — one active per ancillary_case; reschedule lineage; cancellation/no-show reasons preserved.
- Integration: backfill produces stable IDs; every surface reads consistent status.

**Rollback:** Feature flag OFF re-enables legacy dual-write; new columns stay nullable.

**Feature flag:** `FEATURE_CANONICAL_APPOINTMENT`, default OFF.

## Phase 2E — Unified Ancillary Documents read model + Order Note lifecycle

**Goal:** `/ancillary-documents` reads from canonical `procedure_notes` + `documents`. Order Note lifecycle uses `reconcileOrderNoteEligibility(ancillary_case_id)` — idempotent.

**Schema (additive):**

- **New columns on `procedure_notes`:**
  - `ancillary_case_id` int NULL FK → patient_ancillary_cases.id
  - `notes_lineage_id` uuid NULL — grouping for corrections/amendments
  - `correction_of_note_id` int NULL FK → procedure_notes.id (self)
  - `effective_date` text NULL (YYYY-MM-DD)
- **Extend `procedure_notes.signatureStatus` enum with `'voided'`** (additive).

**Backfill (one-shot):**

- For each existing `procedure_notes` row, populate `ancillary_case_id` via `(patient_screening_id, service_type)` → ancillary_case lookup.
- Populate `notes_lineage_id = gen_random_uuid()` per unique `(ancillary_case_id, noteType)` group.

**Wiring (flag `FEATURE_ORDER_NOTE_ELIGIBILITY_STRICT`, default OFF):**

- Implement `reconcileOrderNoteEligibility(ancillary_case_id)`:
  - Precondition: `patient_ancillary_cases.admin_review_status = 'approved'` AND active canonical appointment exists for the ancillary_case.
  - If both true and no order note lineage exists: insert `procedure_notes` row with `noteType='order_note'`, `notes_lineage_id=<new uuid>`, `generationStatus='pending'`. Trigger generator.
  - If lineage exists but Admin Review changed since generation: insert amendment row with `correction_of_note_id=<prior>`.
  - If preconditions become false: transition lineage head to `signatureStatus='voided'`.
- Trigger points:
  - Admin Review status change (Phase 2C).
  - Canonical appointment created/rescheduled (Phase 2D).
- **Order Note generator service** (`server/services/notes/generatorService.ts`, new): transitions `generationStatus: pending → generating → generated`.
- Retire `createPendingProcedureNotes` unconditional call at `server/repositories/procedureEvents.repo.ts:233-240` for `order_note`.
- **Retire legacy `/api/generated-notes` display on `/ancillary-documents`:**
  - New read path: `procedure_notes` for order+procedure notes; `documents` for reports + billing docs; `case_document_readiness` for readiness.
  - Mapping layer at client hook translates legacy `docKind` (`preProcedureOrder`, `postProcedureNote`, `billing`, `screening`) → canonical `(noteType, kind)`.
  - Zero UI change.
- Add clinic scoping to `/api/generated-notes` (or delete route once no client consumes it).

**Test gates:**

- Unit: `tests/unit/reconcileOrderNoteEligibility.test.ts` — preconditions enforced; idempotent; amendment lineage correct; void transitions work.
- Static architecture test: no client file imports `/api/generated-notes` after this phase.
- Playwright: `/ancillary-documents` UI unchanged; data sourced from `procedure_notes`.

**Rollback:** Feature flag OFF; legacy display re-enabled.

**Feature flags:** `FEATURE_ORDER_NOTE_ELIGIBILITY_STRICT`, `FEATURE_NOTE_GENERATOR`, `FEATURE_ANCILLARY_DOCS_CANONICAL_READ`.

## Phase 2F — Procedure event, report, and Procedure Note lifecycle

**Goal:** Real procedure state machine. `reconcileProcedureNoteEligibility(ancillary_case_id)` gates the Procedure Note. Report linkage anchored to ancillary_case.

**Schema (additive):**

- **New columns on `procedure_events`:**
  - `ancillary_case_id` int NULL FK → patient_ancillary_cases.id
  - `started_at`, `paused_at`, `cancelled_at`, `no_show_at`, `unable_to_complete_at` timestamptz NULL
  - `unable_to_complete_reason` text NULL
- **New nullable column `documents.ancillary_case_id`** int FK → patient_ancillary_cases.id.

**Wiring (flags `FEATURE_PROCEDURE_STATE_MACHINE`, `FEATURE_PROCEDURE_NOTE_ELIGIBILITY_STRICT`):**

- New endpoints: `POST /api/procedure-events/start`, `.../pause`, `.../resume`, `.../cancel`, `.../no-show`, `.../unable-to-complete`.
- Prerequisites classified in code:
  - **Hard procedure blocker** — canonical patient identity, valid appointment, active clinic tenancy.
  - **Soft operational warning** — missing consent, missing screening form.
  - **Documentation follow-up** — missing marketing intake.
  - **Billing blocker (not procedure)** — missing insurance verification, missing authorization.
  - **Claim-submission blocker (not procedure)** — missing coding.
- Implement `reconcileProcedureNoteEligibility(ancillary_case_id)`:
  - Precondition: `procedure_events.procedureStatus='complete'` for the ancillary_case AND canonical report document exists linked via `documents.ancillary_case_id`.
  - If both true and no procedure_note lineage exists: insert `procedure_notes` row with `noteType='post_procedure_note'`, `notes_lineage_id=<new>`, `generationStatus='pending'`. Trigger generator.
  - If report replaced: insert amendment row within existing lineage.
  - If procedure reverted (cancelled/unable_to_complete): void the lineage head.
- Trigger points:
  - `procedure_events.procedureStatus` transitions to `complete`.
  - `documents` inserted/updated with `kind='report'` + linked ancillary_case_id.
- **Procedure Note generator service** — extends or accompanies 2E generator.
- Retire `createPendingProcedureNotes` for `post_procedure_note`.
- Report upload path: after write, invoke `reconcileProcedureNoteEligibility` for the ancillary_case.

**Test gates:**

- Unit: `tests/unit/reconcileProcedureNoteEligibility.test.ts`.
- Unit: `tests/unit/procedureLifecycle.test.ts` — every state transition endpoint exists.

**Rollback:** Additive endpoints unregistered; schema columns stay nullable.

**Feature flags:** `FEATURE_PROCEDURE_STATE_MACHINE`, `FEATURE_PROCEDURE_NOTE_ELIGIBILITY_STRICT`.

## Phase 2G — Billing readiness + Billing Document lifecycle

**Goal:** Billing document request atomically produces a canonical `documents` row via a real generator. `generatedDocumentId` becomes a real FK.

**Schema (additive):**

- **New columns:**
  - `billing_readiness_checks.ancillary_case_id` int NULL FK → patient_ancillary_cases.id
  - `billing_document_requests.ancillary_case_id` int NULL FK → patient_ancillary_cases.id
  - Convert `billing_document_requests.generatedDocumentId` from bare int to FK → documents.id (nullable; enforce FK at DB level only after clean-data verification).
  - `billing_document_requests.attempt_count` int DEFAULT 0
  - `billing_document_requests.last_error_at` timestamptz NULL
  - `invoices.billing_document_request_id` int NULL FK → billing_document_requests.id

**Backfill:**

- Populate `ancillary_case_id` on existing rows via `(patient_screening_id, service_type)` lookup.

**Wiring (flag `FEATURE_BILLING_DOCUMENT_GENERATOR`, default OFF):**

- Merge fire-and-forget flow (`server/repositories/billingReadiness.repo.ts:173`) into single transaction: readiness evaluation + billing_document_requests upsert.
- **Billing document generator service** (`server/services/billing/documentGenerator.ts`, new):
  - Renders billing document from encounter + templates.
  - Writes to `documents` (kind='billing_document', patientScreeningId, ancillary_case_id, sourceNotes marker).
  - Sets `billing_document_requests.generatedDocumentId = new documents.id`.
  - Transitions `requestStatus: pending → generating → generated`.
- On generation success, create/link draft `invoices` row via `invoices.billing_document_request_id`.
- Reconciliation cron: catch orphaned `billing_readiness_checks.readinessStatus='ready_to_generate'` rows without a request; retry with capped attempt_count.
- Retire `reconcileCanonicalDuplicates` referenced-but-missing script mention (`server/repositories/billingDocuments.repo.ts:76`).

**Test gates:**

- Unit: `tests/unit/billingDocumentGeneration.test.ts`.
- Integration: end-to-end from procedure-complete → report-uploaded → note-signed → billing-readiness → billing-document → invoice-draft.

**Rollback:** Feature flag OFF; generator inert.

**Feature flag:** `FEATURE_BILLING_DOCUMENT_GENERATOR`, default OFF.

## Phase 2H — Clinician Portal live-data replacement

**Goal:** LinkedDocumentsPanel + Finance surfaces read live data.

**No schema change.**

**Wiring (flag `FEATURE_CLINICIAN_PORTAL_LIVE_DOCS`, default OFF):**

- Extend `server/routes/physicianPortal.ts`:
  - `GET /api/physician-portal/linked-documents?patientScreeningId=` — returns `procedure_notes` + `documents` scoped to physician's assigned patients (join through membership).
  - `GET /api/physician-portal/audit-events?patientScreeningId=` — returns `patient_journey_events`.
- Client hooks: `useLinkedDocuments`, `useAuditEvents` replace `mockData.DOCUMENTS`/`mockData.AUDIT_EVENTS` imports at `client/src/components/physician/orders/OrdersNotesPage.tsx:18-20`.
- Preserve LinkedDocumentsPanel UI exactly.

**Test gates:**

- Unit: `tests/unit/physicianLinkedDocuments.test.ts` — service returns only physician-scoped patients.
- Playwright: LinkedDocumentsPanel renders live documents.

**Rollback:** Revert client hooks to mockData imports.

**Feature flag:** `FEATURE_CLINICIAN_PORTAL_LIVE_DOCS`, default OFF. Coordinates with `FEATURE_CLINICIAN_PORTAL_BACKEND`.

## Phase 2I — PCS + ACS canonical visualization

**Goal:** PCS and ACS portals reference canonical document IDs.

**No schema change.**

**Wiring (bundled with 2E `FEATURE_ANCILLARY_DOCS_CANONICAL_READ`):**

- Consolidate document-panel data hooks:
  - Reports: `documents` (kind='report') + `case_document_readiness`.
  - Order/Procedure notes: `procedure_notes`.
  - Consent / Screening Form: `documents` (kind='informed_consent'/'screening_form').
- Remove references to legacy `generated_notes`.
- Mapping layer folds legacy `docKind` values.
- UI identical.

**Test gates:**

- Static architecture: no PCS/ACS component imports `/api/generated-notes`.
- Playwright: portal document panels render live documents.

**Rollback:** Revert client hooks.

## Phase 2J — Claims, remittance, payment, invoice, allocation, journey completion

**Goal:** Real claim → payment → invoice → allocation pipeline. Product decision required (§15.2).

**Two options — pick one before implementation:**

### Option A: In-house claims pipeline

- Schema (all additive): `claim_submissions`, `claim_submission_events`, `payer_remittance_files`, `revenue_allocations`.
- EDI 837 formatter + clearinghouse SFTP adapter.
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
  - Set `financially_completed_at` when invoice closed and allocation posted.
- Emit `patient_journey_events` for payment posting, invoice approval/delivery/close.
- Trigger `has_plexus_ancillary_history` derivation update on `clinically_completed_at` set.

**Test gates:**

- Unit: claim submission flow (mocked clearinghouse or partner API).
- Integration: end-to-end from paid invoice → allocation posted → `financially_completed_at` set → ancillary designation refreshed.

**Rollback:** All behind feature flags.

## Phase 2K — Full beginning-to-end E2E + Plexus Identity Console activation

**Goal:** Single Playwright test drives a patient from ingestion to fully closed. Plexus Identity Console (Plexus-only surface) activates. Mission Control finance section activates.

**Deliverables:**

- Add view `patient_journey_status(patient_screening_id)` returning discrete completed stages:
  - qualification_complete
  - admin_review_complete (per service — aggregated)
  - engagement_complete
  - scheduling_complete
  - order_note_signed (if required per §15.5)
  - procedure_complete
  - report_uploaded
  - procedure_note_signed
  - billing_ready
  - billing_document_generated
  - claim_submitted (2J option A) OR claim_snapshot_received (2J option B)
  - payment_received
  - invoice_closed
  - clinically_closed (patient_ancillary_cases.clinically_completed_at set)
  - financially_closed (patient_ancillary_cases.financially_completed_at set)
  - fully_closed (both set)
- **Plexus Identity Console** (new Plexus-only surface): renders `global_plexus_patients`, `patient_identity_match_candidates` queue, `patient_identity_merge_events` audit, `plexus_id_aliases`. Gated on Plexus-internal role + `FEATURE_PLEXUS_IDENTITY_CONSOLE`.
- Turn ON Mission Control finance section.
- New Playwright spec: `tests/e2e/interactions/full-journey.spec.ts` — drives a patient from ingestion through fully closed, verifying:
  - Global Plexus patient created.
  - Ancillary case created per service.
  - Service-specific Admin Review approval.
  - Canonical appointment scheduled.
  - Order Note created + signed.
  - Procedure complete + report uploaded.
  - Procedure Note created + signed.
  - Billing readiness + document generated.
  - Invoice paid.
  - Journey status view shows `fully_closed`.
  - Ancillary designation derivation triggers.

**Rollback:** Feature-flag Plexus Identity Console + Mission Control finance activation.

**Feature flags:** `FEATURE_PLEXUS_IDENTITY_CONSOLE`, `FEATURE_MISSION_CONTROL_FINANCE_LIVE`.

## Cross-cutting hygiene items (separate small PRs)

### Retire legacy `/sms/twilio/inbound` auth exemption

Dead code at `server/routes.ts:210-214` (from `e23face`, pre-Phase 1). No route registered under that path. Remove the 3-line exemption in a hygiene commit.

### Retire legacy `uploaded_documents` name-based match

Under Phase 2A, rewrite `documentLibraryLegacy.repo.ts::findLatestPatientScreeningByExactName` to prefer `patient_clinic_membership_id + dob` join. Deprecate exact-name matching.

### Retire unwired `server/modules/patient-directory/*`

Under Phase 2A, the wired resolver replaces this module.

### Plexus Bank isolation

Gate `client/src/pages/plexus-bank*` behind `?sandbox=1` or admin-only preview flag. Do not delete — it's a design deliverable.

### Prototype routes

`/home-preview` and `/plexus-iq-prototype` — gate behind admin-only wrapper or move under `/sandbox/*`.

## Migration Dependencies

All additive, non-destructive. None run during this audit.

| Phase | New table | New column | Notes |
|-------|-----------|------------|-------|
| 2A | `global_plexus_patients`, `patient_clinic_memberships`, `patient_external_identifiers`, `patient_identity_match_candidates`, `patient_identity_merge_events`, `plexus_id_aliases` | `patient_screenings.patient_clinic_membership_id`, `patient_screenings.global_plexus_patient_id` | Backfill via one-shot script; not `drizzle-kit push`. Every non-Plexus surface joins through the membership. |
| 2B | `patient_ancillary_cases` | (populated via backfill from execution_cases + selectedServices) | Partial-unique constraint on active episodes per (global_plexus_patient_id, clinic_id, service_type). |
| 2C | `ancillary_case_admin_review_events` (append-only) | `patient_ancillary_cases.admin_review_status` | Immutable history. |
| 2D | (none) | `global_schedule_events.ancillary_case_id`, `parent_event_id`, `cancellation_reason`, `no_show_reason`; `ancillary_appointments.global_schedule_event_id`; extend status enum with `rescheduled`; partial unique index one-per-case | Backfill script. |
| 2E | (none) | `procedure_notes.ancillary_case_id`, `notes_lineage_id`, `correction_of_note_id`, `effective_date`; extend signatureStatus with `voided` | |
| 2F | (none) | `procedure_events.ancillary_case_id`, `started_at`, `paused_at`, `cancelled_at`, `no_show_at`, `unable_to_complete_at`, `unable_to_complete_reason`; `documents.ancillary_case_id` | |
| 2G | (optional index) | `billing_readiness_checks.ancillary_case_id`; `billing_document_requests.ancillary_case_id`; convert `generatedDocumentId` to FK; `attempt_count`, `last_error_at`; `invoices.billing_document_request_id` | Enforce FK after clean data. |
| 2J opt A | `claim_submissions`, `claim_submission_events`, `payer_remittance_files`, `revenue_allocations` | Extend `invoices.status` with `closed` | |
| 2J opt B | `claim_status_snapshots`, `revenue_allocations` | Same enum extend | |
| 2K | (none) | `patient_journey_status` VIEW | Compute-only |

## Test Gates and E2E Gates (universal)

Every phase gate:

- `npm run check` exit 0
- `npm run test:unit` all passing
- `npm run build` exit 0
- `git diff --check` exit 0
- Playwright canonical UI manifest test still passes for all protected files
- Static test: no clinic-facing endpoint returns a `global_plexus_patients` row directly (only through membership projection)
- Static test: no client component imports `global_plexus_patients` fields not sourced through `patient_clinic_memberships`
- Static test: `patient_identity_match_candidates` / `patient_identity_merge_events` accessors gated on Plexus-internal role
- Static test: alias search enforces tenant + role
- No new imports of `@/pages/plexus-bank/mockData` outside `client/src/pages/plexus-bank/*`
- No new imports of `mockPortalMessages` outside `client/src/components/portal/messaging/*`
- No new `.name === ` matches on patient/document/appointment tables
- No new writes to `patient_screenings.appointmentStatus` after Phase 2D
- No new writes to legacy `/api/generated-notes` write path (route is authenticated — audit §12 — but legacy display retired in 2E)
- No new client-side hardcoded medical or billing data
- Operator-confirmed Replit production Playwright: current 39 / 39 (or expanded matching set) passes before merging any phase

## Do Not

- Do not begin ANY of Phase 2A–2K during this v3 revision.
- Do not enable any feature flag introduced by future phases without explicit approval.
- Do not merge future PRs into `main` without Playwright green from the Replit workspace.
- Do not restore Twilio / patient SMS / patient messaging at any point.
- Do not delete mock or legacy files during this audit. Deletion is a future phase.
- Do not create competing patient / appointment / ancillary-case / billing tables.
- Do not modify UI styling, layout, colors, spacing, typography, or navigation.
- Do not run destructive migrations. Every migration is additive.
- Do not backdate an actual action timestamp; use `effective_clinical_date` when clinical intent differs.
- Do not use unsupported percentages or metrics.
- Do not expose a `global_plexus_patients` row directly to any clinic-facing endpoint.
- Do not grant clinic users identity-review permission.
- Do not grant clinic users cross-clinic chart visibility because identity was linked.

## Recommended Source-of-Truth Principle — proposed v3, awaiting owner approval

- Patient Directory / Patient EHR = authoritative longitudinal visualization anchored on `patient_clinic_memberships` (never directly on `global_plexus_patients`).
- Ancillary Documents = global operational projection of canonical patient-linked ancillary records.
- Clinician Portal = role-specific clinical review and signature projection.
- PCS Portal = role-specific outreach, scheduling, and readiness projection.
- ACS Portal = role-specific execution, report, and readiness projection.
- Document Library = administrative file and version repository.
- Finance / Billing = role-specific financial workflow projections.
- **Plexus Identity Console** = Plexus-only surface for global identity registry, match candidates, merge audit, aliases.

Every projection references canonical source IDs. No independent copies for display. Clinic surfaces join through `patient_clinic_memberships` and never expose a `global_plexus_patients` row directly.

## Awaiting owner approval

Per audit stop condition:

1. **Global Plexus patient identity** — approve or refuse `global_plexus_patients` (serial int PK + opaque `plexus_id` public identifier); Plexus-central resolver; six new tables per §3 of the audit.
2. **Clinic membership + external identifiers + match candidates + merge events + Plexus ID aliases** — approve the five accompanying tables and the tenant/access rules.
3. **Canonical per-service ancillary case** — approve `patient_ancillary_cases` as sole ancillary case with `episode_sequence` + partial-unique constraint on active episodes.
4. **Service-specific Admin Review** — approve `ancillary_case_admin_review_events` (append-only) + `patient_ancillary_cases.admin_review_status`.
5. **Canonical appointment** — approve conditional `global_schedule_events` sole canonical with the seven conditions.
6. **Note lifecycle split** — approve `reconcileOrderNoteEligibility` + `reconcileProcedureNoteEligibility` as separate idempotent operations. Order Note may be created before the procedure workflow when its preconditions are met.
7. **Document architecture** — approved by owner.
8. **Ancillary designation derivation** — approve derived boolean + counts + timestamps on global patient, materialized from `patient_ancillary_cases` + `procedure_events` completion.
9. **Central Plexus identity resolver + Plexus Identity Console** — approve the operational flow (outcomes A/B/C) and the Plexus-only console surface.
10. **Phase order** — approve/adjust 2A → 2K.

No implementation until each of the above has an explicit go-ahead.
