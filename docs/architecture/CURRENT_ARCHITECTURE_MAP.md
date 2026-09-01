# Plexus Platform — Current Architecture Map

**Phase 1 Deliverable**
Produced by: Kiro repository inspection
Date: 2026-08-23
Status: **AWAITING PROJECT OWNER APPROVAL — Phase 2 must not begin until explicitly approved**

---

## How to Read This Document

Each domain entry contains:
- **Classification** — CURRENT / CANONICAL / CONNECT / MIGRATE / BUILD / BUILD ON CURRENT / DEPRECATE
- **Existing Tables** — confirmed by direct database inspection
- **Key Columns** — only the operationally significant ones
- **Routes / Services / Jobs** — confirmed from source files
- **Current Behavior** — what actually happens today in production
- **Required Change** — what the spec requires
- **Migration Risk** — HIGH / MEDIUM / LOW with explanation
- **Spec Discrepancies** — where the spec's assumptions differ from repo reality

---

## Spec Discrepancies Summary

The following material discrepancies were found between the spec's assumptions and the actual repository. Each is documented in full in the relevant domain section below.

| # | Domain | Discrepancy | Impact |
|---|--------|-------------|--------|
| D-01 | Per-Service Episodes | `patient_ancillary_cases` table already exists and is feature-flagged OFF via `FEATURE_ANCILLARY_CASE_WRITE`. The spec treats this as a pure BUILD. It is BUILD ON CURRENT. | Reduces Phase 2 scope; migration strategy applies to enabling existing table, not creating it |
| D-02 | Canonical Chain | A complete 10-phase canonical feature flag chain (2A–2J) already exists in `featureFlags.ts` with explicit dependency ordering. The spec did not fully account for this pre-existing architecture. | All Phase 2–10 work must integrate with or extend this existing chain, not create parallel flags |
| D-03 | Ancillary Service Catalog | `shared/plexus.ts` already lists 11 `ANCILLARY_TESTS` including Upper Extremity Arterial/Venous and AAA Duplex. The AI prompt in `screening.ts` only covers 7 (missing the 4 new ones). | Service Registry work must reconcile plexus.ts list with screening.ts prompt |
| D-04 | Clinics / Facility Config | `clinics` table contains only `id`, `name`, `slug`, `created_at`. No timezone, no EMR config, no financial config, no enabled-services list. Spec assumes facility configuration already exists. | Facility configuration is a BUILD, not an extension of an existing rich model |
| D-05 | Canonical Financial Tables | `shared/schema/canonicalInvoices.ts` and `shared/schema/canonicalFinancialTransitions.ts` exist in shared schema. Phase 2J canonical financial flags exist. The spec treats Plexus Bank as a pure BUILD ON CURRENT. It is further along than assumed. | Plexus Bank work should inspect these canonical schema files before designing the ledger model |
| D-06 | `ancillary_document_references` | This canonical document reference index table already exists with full canonical linkage fields. Not mentioned in the spec's domain table. | Phase 5 (Order Note lifecycle) should treat this as CURRENT infrastructure, not BUILD |
| D-07 | AI Prompt — Service List | `screening.ts` AI prompt lists only 7 services (hardcoded strings in the prompt). `shared/plexus.ts` `ANCILLARY_TESTS` has 11. Neither matches the spec's 9-service catalog exactly. | Service Registry must be the single source of truth; AI prompt must read from it |
| D-08 | `VALID_FACILITIES` | Facilities are hardcoded as a TypeScript constant in `shared/plexus.ts`. Morning rebuild iterates this constant. Spec assumes a database-driven facility model. | Any facility configuration work must also update this constant or replace it with a DB-driven lookup |
| D-09 | Plexus Findings | Confirmed completely absent — no table, no schema, no routes, no services. `ci_*` tables (Clinical Intelligence) exist but serve a different purpose (rule governance, not patient-specific findings). | Full BUILD as classified |
| D-10 | Screening Addendum | Confirmed completely absent. No `note_addenda` table, no addendum model, no addendum workflow anywhere in the repo. | Full BUILD as classified |
| D-11 | EMR Integration | Confirmed completely absent. Zero EMR connector, adapter, sync service, or FHIR/HL7 code. | Phase 11 only |

---

## Domain 1 — Patient Identity

**Classification:** CANONICAL (partial) — feature-flagged OFF

### Existing Tables
| Table | Purpose |
|-------|---------|
| `global_plexus_patients` | Master patient record across all clinics |
| `patient_clinic_memberships` | Per-clinic patient relationship |
| `patient_external_identifiers` | Source EMR IDs and external identifiers |
| `plexus_id_aliases` | Surviving patient ID aliases post-merge |
| `patient_identity_match_candidates` | Deduplication candidates |
| `patient_identity_merge_events` | Append-only merge audit |

### Key Columns — `global_plexus_patients`
`plexus_id` (unique), `display_name`, `normalized_name`, `dob`, `phone`, `email`, `address`, `identity_status`, `merged_into_patient_id`, `has_plexus_ancillary_history`

### Key Columns — `patient_clinic_memberships`
`global_plexus_patient_id`, `clinic_id`, `clinic_mrn`, `source_system`, `source_patient_identifier`, `membership_status`

### Feature Flags
- `FEATURE_PLEXUS_IDENTITY_WRITE` — default OFF — gates all writes to identity tables
- `FEATURE_PLEXUS_IDENTITY_REVIEW` — default OFF — gates identity review endpoints (merge/match UI)

### Current Behavior
Tables exist with complete schema. Writes are disabled by default. `patient_screenings` has `global_plexus_patient_id` and `patient_clinic_membership_id` FK columns (nullable) that link to the canonical identity system. Identity orchestrator writes links on screening insert when flag is ON.

### Required Change
Enable identity writes and validate backfill. No schema changes required.

### Migration Risk: LOW
Tables exist, flags exist, backfill scripts exist. Risk is operational (flag sequencing), not architectural.

---

## Domain 2 — Patient Execution Cases

**Classification:** CURRENT — requires staged migration to per-service semantics

### Existing Table: `patient_execution_cases`
| Column | Type | Notes |
|--------|------|-------|
| `id` | integer | Primary key |
| `clinic_id` | integer | Multi-tenancy |
| `patient_screening_id` | integer | FK → patient_screenings |
| `patient_name`, `patient_dob` | text | Denormalized identity |
| `facility_id` | text | String-based facility |
| `engagement_bucket` | text | `visit` / `outreach` / `scheduling_triage` |
| `lifecycle_status` | text | `active` / `completed` / `archived` / `cancelled` |
| `engagement_status` | text | `new` / `assigned` / `contacted` / `scheduled` / `completed` |
| `selected_services` | text[] | Array of service strings for this case |
| `assigned_team_member_id` | integer | FK → outreach_schedulers |
| `call_attempt_count` | integer | Running call attempt counter |
| `sent_to_engagement_at` | timestamp | Phase 2C engagement send timestamp |

### Downstream Dependencies (tables with FK to `patient_execution_cases`)
`case_document_readiness`, `completed_billing_packages`, `cooldown_records`, `global_schedule_events`, `insurance_eligibility_reviews`, `invoice_readiness_snapshots`, `patient_journey_events`, `patient_notes`, `procedure_events`, `procedure_notes`, `projected_invoice_rows`, `scheduling_triage_cases`

### Routes / Services
- `commitPatient()` — `server/services/patientCommitService.ts` — creates execution case on approval
- `server/routes/executionCases.ts` — CRUD endpoints
- `server/services/callListEngine.ts` — reads execution cases for call list
- `server/services/schedulerAutoAssign.ts` — assigns team member to execution case
- `server/routes/engagementAssignmentBoard.ts` — engagement board reads execution cases
- `server/services/morningRebuildScheduler.ts` — daily rebuild for all facilities

### Current Behavior
One `patient_execution_cases` row per `patient_screenings` row (i.e., per patient per batch). `selected_services` is an array on the single case. All downstream tables reference this single case ID.

### Required Change
Migrate to one `patient_ancillary_cases` row per qualified service (see Domain 3). `patient_execution_cases` must remain live during migration via dual-write strategy (Phases A–G in spec).

### Migration Risk: HIGH
13 downstream tables reference `patient_execution_cases.id`. Every portal, the call list engine, billing readiness, procedure notes, and schedule events all use it. This is the highest-risk migration in the platform. Must follow the spec's dual-write + shadow validation + per-reader migration sequence exactly.

---

## Domain 3 — Per-Service Episode (patient_ancillary_cases)

**Classification:** BUILD ON CURRENT — table exists, feature-flagged OFF

> **Spec Discrepancy D-01:** The spec classified this as a pure BUILD. The `patient_ancillary_cases` table already exists in the database with a complete schema including per-service lifecycle fields.

### Existing Table: `patient_ancillary_cases`
| Column | Type | Notes |
|--------|------|-------|
| `id` | integer | Primary key |
| `global_plexus_patient_id` | integer | FK → global_plexus_patients (canonical identity) |
| `patient_clinic_membership_id` | integer | FK → patient_clinic_memberships |
| `clinic_id` | integer | Multi-tenancy |
| `originating_screening_id` | integer | FK → patient_screenings (nullable) |
| `execution_case_id` | integer | FK → patient_execution_cases (nullable — bridge) |
| `service_type` | text | One row per service (e.g., `BrainWave`, `Bilateral Carotid Duplex`) |
| `episode_sequence` | integer | Supports requalification (2nd episode = 2, etc.) |
| `lifecycle_status` | text | `new` / and extended states |
| `qualification_status` | text | `unscreened` / `qualified` / `not_qualified` / `pending_review` |
| `admin_review_status` | text | `pending` / `approved` / `needs_info` / `rejected` |
| `clinically_completed_at` | timestamp | Clinical completion timestamp |
| `financially_completed_at` | timestamp | Financial completion timestamp |

### Feature Flag
`FEATURE_ANCILLARY_CASE_WRITE` — default OFF — requires `FEATURE_PLEXUS_IDENTITY_WRITE` to be ON first

### Existing Indexes
`idx_pac_active_lookup` on `(global_plexus_patient_id, clinic_id, service_type)` — supports fast per-patient per-service lookup

### Also Referenced By
`ancillary_document_references.ancillary_case_id`, `billing_readiness_checks.ancillary_case_id`, `procedure_notes.ancillary_case_id`, `procedure_events.ancillary_case_id`, `engagement_list_memberships.ancillary_case_id`, `global_schedule_events.ancillary_case_id`

### Current Behavior
Table exists but all writes are gated by `FEATURE_ANCILLARY_CASE_WRITE = false`. The table is empty in production. No readers are currently using it as the authoritative source.

### Required Change
Enable writes (after Phase 2A identity is validated). Dual-write `commitPatient()` to both `patient_execution_cases` and `patient_ancillary_cases`. Shadow validate. Migrate readers per spec.

### Migration Risk: HIGH
Same as Domain 2 — all downstream readers must be migrated individually. However, the table and FK relationships are already in place, which eliminates the schema risk. Only the write/read migration remains.

---

## Domain 4 — generated_notes

**Classification:** BUILD ON CURRENT — extend for document lifecycle

### Existing Table: `generated_notes`
| Column | Type | Notes |
|--------|------|-------|
| `id` | integer | Primary key |
| `clinic_id` | integer | Multi-tenancy |
| `patient_id` | integer | FK → patient_screenings (legacy, not service episode) |
| `batch_id` | integer | FK → screening_batches |
| `facility` | text | Facility string |
| `service` | text | Service name string |
| `doc_kind` | text | Document type identifier |
| `title` | text | Document title |
| `sections` | jsonb | Generated document content (structured sections) |
| `generated_at` | timestamp | Generation timestamp |
| `drive_file_id` | text | Google Drive file reference |
| `drive_web_view_link` | text | Google Drive view link |
| `is_test` | boolean | Test data flag |

### Missing Columns (not present — must be added)
`status`, `service_episode_id` / `ancillary_case_id`, `signed_at`, `signed_by_user_id`, `current_version`, `signed_version`, `created_by_user_id`

### Current Behavior
Generates PDF/document content per patient per service. Stores text blobs in `sections` jsonb. Linked to `patient_screenings` (legacy) and `screening_batches`. No signature state, no lifecycle, no versioning. Used by the existing PDF generation workflow (`client/src/lib/pdfGeneration.ts`).

### Also Note
`ancillary_document_templates` table exists (service_type, document_type, facility_id, required, active, effective_date) and is the template registry foundation. Has `approval_status` and `effective_date`/`expiration_date` for versioning.

### Required Change (Phase 5)
Add lifecycle columns to `generated_notes`. Create `note_addenda` table. Add `ancillary_case_id` FK. Existing records must be preserved — backfill logic must be auditable and reversible. Do not delete or reassign existing records during migration.

### Migration Risk: MEDIUM
Adding columns is non-breaking. The backfill (linking existing `generated_notes` rows to `ancillary_case_id`) requires careful matching logic since current records are keyed by `patient_id` (screening) + `service` string, not by service episode.

---

## Domain 5 — case_document_readiness

**Classification:** CURRENT — reuse and extend

### Existing Table: `case_document_readiness`
| Column | Type | Notes |
|--------|------|-------|
| `execution_case_id` | integer | FK → patient_execution_cases |
| `patient_screening_id` | integer | FK → patient_screenings |
| `service_type` | text | Per-service tracking |
| `document_type` | text | `informed_consent` / `screening_form` / `report` / `order_note` / `post_procedure_note` / `billing_document` |
| `document_status` | text | `missing` / `pending` / `uploaded` / `generated` / `completed` / `approved` |
| `blocks_billing` | boolean | Whether this document blocks billing |
| `uploaded_by_user_id` | varchar | FK → users |
| `completed_at` | timestamp | Completion timestamp |
| `metadata` | jsonb | Flexible metadata |

### Routes
- `POST /api/case-document-readiness/complete` — canonical report/document completion endpoint; writes status, indexes document reference, fires billing readiness evaluation
- `server/routes/documentReadiness.ts` — full CRUD

### Services
- `server/services/documents/patientTestAttachmentService.ts` — pre-upload state prediction
- `server/repositories/billingReadiness.repo.ts` — billing readiness evaluation reads this table

### Current Behavior
Tracks per-case per-service document completion. Report upload (`documentType = 'report'`, `status = 'uploaded'`) is the canonical event that feeds billing readiness. The `POST /api/case-document-readiness/complete` route already: sets status, appends journey event, indexes canonical document reference, and evaluates billing readiness. **This is the attachment point for Procedure Note generation.**

### Required Change
Add `ancillary_case_id` FK column to support per-service episode linkage. Current rows are linked via `execution_case_id` (patient-level). As `patient_ancillary_cases` becomes authoritative, this table needs the per-service case link.

### Migration Risk: LOW
Adding a nullable FK column is non-breaking. Existing queries continue to work. Backfill via execution_case → ancillary_case mapping once dual-write is active.

---

## Domain 6 — Plexus Findings

**Classification:** BUILD — does not exist

> **Spec Discrepancy D-09:** Confirmed completely absent. No table, no schema file, no routes, no services, no client components for patient-specific AI-found clinical findings. The `ci_*` tables (`ci_rules`, `ci_learning_items`, `ci_evidence_records`, `ci_rule_versions`, `ci_audit_entries`) exist but serve clinical intelligence governance (rule management), not patient-specific finding storage.

### Required Table: `plexus_clinical_findings`
Per spec: patient_id, facility_id, ancillary_case_id (nullable), finding_type, display_name, normalized_concept, suggested_icd10, confirmed_icd10, source_type, source_record_id, source_date, source_excerpt, confidence, review_status, analysis_run_id, created_by, reviewed_by, created_at, reviewed_at

### Required Change (Phase 3)
Full BUILD. Create table, schema, routes, repository, and EHR UI section. Connect to AI qualification output and screening form workflow.

### Migration Risk: N/A — new table
No existing production data at risk. However, this domain has upstream dependencies: Plexus IQ must be updated to write findings, and Admin Review must be able to display and act on them.

---

## Domain 7 — Order Note Lifecycle

**Classification:** BUILD ON CURRENT — extend generated_notes + ancillary_document_references

> **Spec Discrepancy D-06:** `ancillary_document_references` table already exists as the canonical document reference index. This is the linking layer between documents and service episodes, already used by the billing readiness and procedure note workflows.

### `ancillary_document_references` (existing)
| Column | Type | Notes |
|--------|------|-------|
| `ancillary_case_id` | integer | Per-service episode link |
| `document_kind` | text | `report` / `consent` / `screening_form` / `order_note` / etc. |
| `source_table` | text | Where the actual document lives |
| `source_id` | integer | ID in the source table |
| `document_status` | text | Mirrors source status |
| `signed_at` | timestamp | Signature timestamp |
| `superseded_at` | timestamp | Supersession tracking |

### Feature Flags
- `FEATURE_CANONICAL_ORDER_NOTE` — default OFF — gates canonical Order Note flow
- `FEATURE_UNIFIED_ANCILLARY_DOCUMENTS` — default OFF — required upstream dependency

### Current Behavior
Order notes are generated via `generated_notes` as static blobs. No Draft→Pending Signature→Signed lifecycle exists. No routing to clinician. No signature capture. The `ancillary_document_references` table provides the canonical linkage layer but it is gated behind `FEATURE_UNIFIED_ANCILLARY_DOCUMENTS`.

### Required Change (Phase 5)
1. Add lifecycle columns to `generated_notes` (status, signed_at, signed_by_user_id, versions)
2. Create `note_addenda` table
3. Implement Draft → Pending Signature → Signed state machine
4. Implement scheduling trigger: `APPOINTMENT_SCHEDULED` → route existing Order Note Draft to Clinician Portal
5. All changes behind `FEATURE_CANONICAL_ORDER_NOTE` flag

### Migration Risk: MEDIUM
The lifecycle columns are additive. The state machine introduces new behavior without removing existing generation. The main risk is the scheduling trigger — it must not fire for historical/legacy records that never had a proper Draft.

---

## Domain 8 — Screening Addendum

**Classification:** BUILD — does not exist

> **Spec Discrepancy D-10:** Confirmed completely absent. No `note_addenda` table, no addendum model, no addendum workflow anywhere in the repo.

### Required Change (Phase 7)
1. Create `note_addenda` table with: `id`, `parent_note_id` (FK → generated_notes), `ancillary_case_id`, `author_user_id`, `content`, `reason`/category, `created_at`, `signed_at` (nullable), `signed_by_user_id` (nullable)
2. Implement Screening Form → Order Note Addendum trigger
3. Implement: if Order Note is already signed, attach addendum without mutating signed content
4. Surface addendum in Clinician Portal and Procedure Note generation

### Migration Risk: LOW
New table, no existing data migration required. Risk is in the trigger wiring and ensuring the signed-note immutability rule is enforced.

---

## Domain 9 — Procedure Notes

**Classification:** CURRENT / CONNECT — existing architecture is complete; generation trigger is the gap

### Existing Table: `procedure_notes`
| Column | Type | Notes |
|--------|------|-------|
| `execution_case_id` | integer | FK → patient_execution_cases |
| `patient_screening_id` | integer | FK → patient_screenings |
| `procedure_event_id` | integer | FK → procedure_events |
| `ancillary_case_id` | integer | FK → patient_ancillary_cases (canonical) |
| `global_plexus_patient_id` | integer | Canonical patient identity |
| `patient_clinic_membership_id` | integer | Canonical clinic membership |
| `service_type` | text | Service identifier |
| `note_type` | text | Note type (`post_procedure_note` etc.) |
| `generation_status` | text | `pending` / `generating` / `generated` / `failed` |
| `generated_text` | text | Full note body |
| `generated_by_ai` | boolean | Whether AI generated |
| `source_data` | jsonb | Clinical source lineage |
| `error_message` | text | Generation failure reason |
| `signature_status` | text | `needs_signature` / `ready_to_sign` / `returned_for_correction` / `signed` |
| `signed_at` | timestamp | Signature timestamp |
| `signed_by_user_id` | varchar | FK → users |
| `return_reason` | text | Correction return reason |
| `report_document_reference_id` | integer | FK to report reference |
| `supersedes_note_id` | integer | Note versioning (self-referential) |
| `superseded_at` | timestamp | When superseded |
| `effective_clinical_date` | timestamp | Clinical date for the note |
| `qualifying_global_schedule_event_id` | integer | Qualifying schedule event |
| `admin_review_event_id` | integer | Admin review linkage |

### Services
- `server/services/physicianPortal/signatureWorkflow.ts` — individual sign, bulk sign, return-for-correction
- `server/services/physicianPortal/signatureRules.ts` — pure validation rules
- `server/services/physicianPortal/reportsService.ts` — report listing
- `server/services/physicianPortal/summaryService.ts` — dashboard tiles

### Feature Flags
- `FEATURE_CANONICAL_PROCEDURE_LIFECYCLE` — gates procedure event canonical linkage
- `FEATURE_CANONICAL_PROCEDURE_NOTE` — gates canonical Procedure Note creation/reuse
- `FEATURE_PROCEDURE_NOTE_GENERATOR` — gates AI body generation
- All three must be ON for `procedureNoteRuntimeEnabled()` to return true (plus `FEATURE_UNIFIED_ANCILLARY_DOCUMENTS`)

### Current Behavior
Full signature lifecycle exists and works. Signing triggers billing readiness reevaluation. Supersession architecture exists. The **only missing piece** is the generation trigger: `REPORT_UPLOADED` (via `POST /api/case-document-readiness/complete` with `documentType = 'report'`) must invoke Procedure Note generation. Generation flags are all OFF.

### Required Change (Phase 8)
Add generation trigger to `POST /api/case-document-readiness/complete` for `documentType = 'report'`. Must be idempotent (check existing `procedure_notes` by `ancillary_case_id` + `report_document_reference_id`). Generation failure must not roll back a valid report upload. Enable `FEATURE_CANONICAL_PROCEDURE_LIFECYCLE`, `FEATURE_CANONICAL_PROCEDURE_NOTE`, and `FEATURE_PROCEDURE_NOTE_GENERATOR` in sequence after validation.

### Migration Risk: LOW
The signing, correction, and supersession infrastructure is production-ready. Only the trigger and generator are missing. Risk is limited to idempotency logic and source chain assembly.

---

## Domain 10 — Ancillary Service Registry

**Classification:** BUILD ON CURRENT — service logic is currently scattered

> **Spec Discrepancy D-07 / D-03:** Service definitions exist in three places today:
> 1. `shared/plexus.ts` — `ANCILLARY_TESTS` array (11 services) and `VALID_FACILITIES` array (3 facilities) as hardcoded TypeScript constants
> 2. `server/services/screening.ts` — AI qualification prompt hardcodes 7 services with clinical criteria embedded in prompt text
> 3. `admin_settings` table — per-facility qualification mode (permissive/standard/conservative)

### Current `ANCILLARY_TESTS` in `shared/plexus.ts`
```
BrainWave, VitalWave, Bilateral Carotid Duplex, Echocardiogram TTE,
Stress Echocardiogram, Lower Extremity Venous Duplex, Upper Extremity Venous Duplex,
Renal Artery Doppler, Lower Extremity Arterial Doppler,
Upper Extremity Arterial Doppler, Abdominal Aortic Aneurysm Duplex
```

### Current Services in `screening.ts` AI Prompt (7 only)
BrainWave, VitalWave, Bilateral Carotid Duplex, Echocardiogram TTE, Renal Artery Doppler, Lower Extremity Arterial Doppler, Lower Extremity Venous Duplex

### Spec Target Service Catalog (9 vascular/cardiac + BrainWave + VitalWave = 11 total)
BrainWave, VitalWave, Bilateral Carotid Duplex (93880), Complete TTE (93306), Renal Artery Duplex (93975), Lower Extremity Arterial Duplex (93925), Upper Extremity Arterial Duplex (93930), Lower Extremity Venous Duplex (93970), Upper Extremity Venous Duplex (93970), Stress Echocardiogram (93350), Aortoiliac/AAA Duplex (93978)

### Gap
`screening.ts` AI prompt is missing: Upper Extremity Arterial Duplex, Upper Extremity Venous Duplex, Stress Echocardiogram, Aortoiliac/AAA Duplex. CPT codes are not stored anywhere in the database — they are embedded in the AI prompt string only.

### Required Change (Phase 4)
Create `ancillary_service_registry` table (or equivalent admin-managed configuration). Fields per spec: service_id, internal_code, display_name, category, active, CPT, qualification criteria per mode, cooldown rules, template linkages. Make `shared/plexus.ts` `ANCILLARY_TESTS` read from this table (or keep as a derived constant). Make `screening.ts` AI prompt build dynamically from the registry. **CPT codes must be confirmed by coding team before entering the registry as billing truth.**

### Migration Risk: MEDIUM
Changing the AI prompt affects qualification output. Must be validated before enabling for production batches. Existing service name strings in `patient_screenings.qualifyingTests[]` and across all downstream tables must remain valid during transition.

---

## Domain 11 — Clinician Portal

**Classification:** CONNECT + BUILD — server substantial, client is a stub

### Frontend
- `client/src/pages/physician-portal.tsx` — **5 lines** — effectively a placeholder/stub

### Backend
- `server/routes/physicianPortal.ts` — 255 lines — production-grade API
- `server/services/physicianPortal/signatureWorkflow.ts` — individual + bulk sign + return
- `server/services/physicianPortal/signatureRules.ts` — pure signature validation
- `server/services/physicianPortal/reportsService.ts` — report listing from `case_document_readiness`
- `server/services/physicianPortal/summaryService.ts` — dashboard tiles
- `server/routes/clinicianPortalGuard.ts` — `requireClinicianOrAdmin` + `requireClinicScope`

### Existing API Endpoints
| Endpoint | Purpose |
|----------|---------|
| `GET /api/physician-portal/signature-items` | Signature worklist with filters |
| `POST /api/physician-portal/signature-items/:id/sign` | Individual signing |
| `POST /api/physician-portal/signature-items/bulk-sign` | Bulk signing |
| `POST /api/physician-portal/signature-items/:id/return` | Return for correction |
| `GET /api/physician-portal/reports` | Report listing |
| `GET /api/physician-portal/ancillary-metrics` | Per-service rollups |
| `GET /api/physician-portal/summary` | Dashboard tile counts |
| `GET /api/physician-portal/financial-health` | Invoice-based financial summary |

### Feature Flags
- `FEATURE_CLINICIAN_PORTAL_BACKEND` — default OFF
- `FEATURE_CLINICIAN_PORTAL_CANONICAL_DATA` — default OFF — gates canonical overview read model (Phase 2H)

### Current Behavior
Server API is complete for procedure note signing, reports, and metrics. Client page is a stub. `FEATURE_CLINICIAN_PORTAL_CANONICAL_DATA` flag gates the canonical read model (Phase 2H) which serves a structured `canonicalOverview` response.

### Required Change (Phase 6)
Build the client-side clinician UI against existing server APIs. Add Order Note queue (requires Phase 5 Order Note lifecycle). Add Screening Addendum display (requires Phase 7). Do not create a second backend or second signature system. Extend existing server routes only where gaps are confirmed.

### Migration Risk: LOW
Server is stable. Frontend build is additive. Risk is in Phase 5/7 dependencies — Order Note and Addendum workflows must exist before they can be surfaced here.

---

## Domain 12 — Engagement Center

**Classification:** CURRENT — working, needs per-service awareness post-migration

### Tables
| Table | Purpose |
|-------|---------|
| `engagement_lists` | Multi-list engagement repository (Phase 2C) |
| `engagement_list_memberships` | Per-service per-list membership with `ancillary_case_id` |
| `engagement_call_settings` | Per-member KPI config |
| `engagement_reconciliation_failures` | Durable retry for failed sends |

### `engagement_list_memberships` key columns
`engagement_list_id`, `ancillary_case_id`, `patient_screening_id`, `execution_case_id`, `service_type`, `status`, `added_at`, `removed_at`

### Routes
- `server/routes/engagementAssignmentBoard.ts` — board reads + writes
- `server/routes/engagementDistribution.ts` — round-robin distribution (role-gated)
- `server/routes/engagementBaskets.ts` — basket/disposition views
- `server/routes/engagementCallSettings.ts` — KPI config
- `server/routes/engagementTeamMetrics.ts` — team metrics

### Feature Flags
- `FEATURE_ENGAGEMENT_MULTI_LIST_REPOSITORY` — default OFF — gates multi-list model
- `FEATURE_ENGAGEMENT_ADMIN_REVIEW_SYNC` — default OFF — engagement reconciles on Admin Review changes
- `FEATURE_ENGAGEMENT_RECENT_LISTS` — default OFF

### Current Behavior
Engagement board reads `patient_execution_cases` (one per patient). Multi-list repository tables exist but are feature-flagged OFF. `engagement_list_memberships` has `ancillary_case_id` column ready for per-service membership.

### Required Change
As `patient_ancillary_cases` becomes authoritative (Phase 2 migration), migrate engagement board to read from per-service episodes. Enable `FEATURE_ENGAGEMENT_MULTI_LIST_REPOSITORY` after Phase 2B/2C validation. Migration must follow spec's per-reader flag strategy.

### Migration Risk: MEDIUM
The multi-list infrastructure is built. Risk is in the reader migration and ensuring the board correctly aggregates per-service episodes without losing existing assignment state.

---

## Domain 13 — Morning Rebuild / Call List

**Classification:** CURRENT — working, needs service-episode awareness post-migration

### Services
- `server/services/morningRebuildScheduler.ts` — daily advisory-lock-based rebuild
- `server/services/callListEngine.ts` — assignment algorithm (capacity-weighted round-robin)
- `server/services/callListPriority.ts` — patient priority ranking

### Tables
- `scheduler_assignments` — daily call list assignments (one active per patient per day)
- `outreach_schedulers` — scheduler roster with `capacity_percent`, `facility`, `user_id`
- `pto_requests` — PTO awareness for scheduler exclusion

### Feature Flags
- `FEATURE_PCS_CANONICAL_VIEW` — default OFF — canonical PCS stage-vector read model
- `MORNING_REBUILD_DISABLED=1` env var — disables rebuild

### Current Behavior
Rebuilds daily at BUILD_HOUR (default 7 AM) for each facility in `VALID_FACILITIES` hardcoded constant. Uses 90-day patient eligibility window. Capacity-weighted round-robin assignment. PTO-aware. Advisory lock prevents double-firing across multiple workers.

> **Spec Discrepancy D-08:** `VALID_FACILITIES` is a hardcoded TypeScript constant in `shared/plexus.ts`. Any facility configuration work must update this constant or replace it with a DB-driven lookup. The morning rebuild currently iterates this constant directly.

### Required Change
After per-service episode migration, call list must become service-episode-aware. Each call list row should represent a patient+service, not just a patient. `scheduler_assignments` currently links by `patient_screening_id` — will need `ancillary_case_id` linkage. Replace `VALID_FACILITIES` constant with DB-driven facility lookup.

### Migration Risk: MEDIUM
Algorithm changes affect every scheduler's daily work. Must shadow-validate before promoting.

---

## Domain 14 — Billing Records

**Classification:** CURRENT (legacy) — `billing_records` is the current write surface

### Table: `billing_records`
Linked to `patient_screenings` (via `patient_id`) and `screening_batches` (via `batch_id`). Contains per-service financial fields: `total_charges`, `paid_amount`, `insurance_paid_amount`, `billing_status`, `response`, `paid_status`, `balance_remaining`. No `ancillary_case_id` — patient-level, not service-episode-level.

### `billing_readiness_checks` (canonical — more complete)
Has `ancillary_case_id`, `report_document_reference_id`, `order_note_document_reference_id`, `procedure_note_document_reference_id`, `billing_blockers` (jsonb), `claim_blockers` (jsonb), `canonical_status`, `evidence_fingerprint`, `evaluator_version`. This is the canonical billing readiness system (Phase 2G, feature-flagged).

### Feature Flags
- `FEATURE_CANONICAL_BILLING_READINESS` — default OFF
- `FEATURE_CANONICAL_BILLING_DOCUMENT` — default OFF
- `FEATURE_BILLING_DOCUMENT_GENERATOR` — default OFF
- `billingReadinessRuntimeEnabled()` — requires ALL of: procedure note runtime + ancillary case + canonical appointment + canonical order note + canonical billing readiness

### Current Behavior
`billing_records` is the active write surface used by the existing billing UI. `billing_readiness_checks` with canonical fields exists but is feature-flagged OFF. The canonical billing document, claim, and payment lifecycle (Phase 2G–2J) is architecturally designed but all flags are OFF.

### Required Change (Phase 9)
Enable canonical billing readiness chain (requires all upstream phases validated). Connect document readiness to billing document generation to claim lifecycle. `billing_records` remains authoritative until canonical chain is validated.

### Migration Risk: HIGH
Financial records require zero-error migration. Must not generate incorrect billing documents or claims. The upstream dependency chain (all canonical phases 2A–2G) must be validated before Phase 9 begins.

---

## Domain 15 — Invoices and Payments

**Classification:** CURRENT — working invoice lifecycle exists

### Tables
| Table | Purpose |
|-------|---------|
| `invoices` | Facility invoices with full approval + delivery lifecycle |
| `invoice_line_items` | Per-patient per-service line items |
| `invoice_payments` | Facility payment records |
| `invoice_batches` | Invoice accumulation periods per facility |
| `invoice_batch_items` | Items within a batch |
| `invoice_adjustments` | Post-invoice adjustments |
| `invoice_delivery_events` | Delivery audit trail |
| `invoice_denials` | Denial tracking |
| `invoice_readiness_snapshots` | Readiness snapshots per execution case |
| `remittance_events` | Remittance tracking |

### `invoice_batches` key columns
`facility_id`, `invoice_period_start`, `invoice_period_end`, `cutoff_at`, `batch_status`, `policy_snapshot`, `recipient_snapshot`

### Current Behavior
Full invoice lifecycle exists: Draft → pending_review → approved → ready_to_send → sent → partially_paid → paid → voided. `invoice_batches` has `cutoff_at` column. `policy_snapshot` and `recipient_snapshot` store configuration snapshots at invoice time.

> **Spec Discrepancy D-04:** The `clinics` table has only `id`, `name`, `slug`, `created_at`. There is no `timezone` column on clinics. Invoice `cutoff_at` is stored as a timestamp but there is no facility-timezone-aware cutoff calculation visible in the current schema. This must be addressed before Phase 10 facility-local cutoff invoicing.

### Required Change (Phase 10)
Add `timezone` column to `clinics` table. Implement facility-local invoice cutoff calculation. Connect canonical claim payment (Phase 2J) to invoice eligibility. Until Phase 2J is validated, existing manual invoice workflow remains authoritative.

### Migration Risk: MEDIUM
Invoice table is stable. Adding timezone to clinics is non-breaking. The claim-to-invoice automation (Phase 2J) is the risky part — it requires the full canonical chain upstream.

---

## Domain 16 — Plexus Bank

**Classification:** BUILD ON CURRENT — existing invoice/payment infrastructure is the foundation

> **Spec Discrepancy D-05:** `shared/schema/canonicalInvoices.ts` and `shared/schema/canonicalFinancialTransitions.ts` already exist. Phase 2J flags (`FEATURE_CANONICAL_CLAIMS`, `FEATURE_CANONICAL_INVOICES`, `FEATURE_CANONICAL_PAYMENTS`) exist. This is further along than the spec assumed.

### Existing Canonical Financial Schema
- `shared/schema/canonicalInvoices.ts` — canonical invoice model (inspect before designing ledger)
- `shared/schema/canonicalFinancialTransitions.ts` — financial state machine transitions
- `FEATURE_CANONICAL_CLAIMS` / `FEATURE_CANONICAL_INVOICES` / `FEATURE_CANONICAL_PAYMENTS` — all default OFF

### Current Behavior
`invoices` + `invoice_payments` + `invoice_adjustments` + `remittance_events` form the current financial picture. The canonical financial schema exists in shared types but no tables have been created from it yet (flags are OFF, no migration applied).

### Required Change (Phase 10)
Before designing the Plexus Bank ledger model, inspect `canonicalInvoices.ts` and `canonicalFinancialTransitions.ts` to understand the existing design intent. Build the ledger as an extension of the existing financial infrastructure. Per spec: append-only event model, separate payer payment / facility obligation / facility payment. Do not create a disconnected third financial system.

### Migration Risk: HIGH (financial)
Any financial ledger change requires zero-error implementation. Append-only event model must be enforced at the database constraint level. All existing `invoices` and `invoice_payments` data must remain valid and traceable.

---

## Domain 17 — EMR Integration

**Classification:** BUILD — does not exist

> **Spec Discrepancy D-11:** Confirmed completely absent. No EMR connector, no FHIR adapter, no HL7 parser, no eClinicalWorks integration, no sync service, no patient import automation beyond manual/bulk paste. The `patient_external_identifiers` table exists and is designed to hold external EMR IDs, but nothing populates it today.

### Relevant Existing Infrastructure (can be used as foundation)
- `patient_external_identifiers` — already has `source_system`, `source_patient_identifier`, external ID storage
- `patient_clinic_memberships` — `source_system` and `source_patient_identifier` columns
- `plexus_identity_link_failures` — durable retry for identity link failures

### Required Change (Phase 11 only — after all internal canonical workflow is stable)
Design and implement EMR connector layer. Start with eClinicalWorks. Use `patient_external_identifiers` as the ID mapping store. Feed updates into Plexus EHR → Plexus Findings → automatic qualification queue.

### Migration Risk: HIGH
EMR integration affects patient data integrity at the source. Must not create duplicates. Must not overwrite human-corrected data with stale EMR updates. Identity deduplication rules must be confirmed before any sync runs.

---

## Domain 18 — Facility Configuration

**Classification:** BUILD — clinics table is minimal

> **Spec Discrepancy D-04:** Current `clinics` table: `id`, `name`, `slug`, `created_at` only. No timezone, no EMR config, no financial config, no enabled-services list, no PCS/ACS config, no clinician routing config, no document template linkages.

### Current Behavior
Facilities exist as string values in `VALID_FACILITIES` constant (`shared/plexus.ts`). `clinics` table is multi-tenancy scoping only. Facility-specific configuration (qualification mode, billing recipients, invoice schedule) is stored in `admin_settings` (key-value store) and `app_settings`.

### Required Change (Phase 4 alongside Service Registry)
Extend `clinics` table with: `timezone`, `address`, `phone`, `active`. Create facility configuration model for: enabled services, invoice schedule (frequency, day, cutoff, timezone), billing recipients, PCS/ACS coverage rules, clinician routing, qualification mode override. Replace `VALID_FACILITIES` constant with DB-driven facility lookup.

### Migration Risk: LOW
Adding columns to `clinics` is non-breaking. The `VALID_FACILITIES` constant replacement requires updating all callers (morning rebuild, etc.) but is a contained change.

---

## Phase Execution Order (confirmed by repository analysis)

The existing canonical feature flag chain defines the dependency order. No phase may enable its canonical flags without validating all upstream phases first.

```
Phase 1  — Architecture Map (THIS DOCUMENT) ← AWAITING APPROVAL
Phase 2  — Canonical service episodes (patient_ancillary_cases enable + dual-write)
           Prerequisite: FEATURE_PLEXUS_IDENTITY_WRITE validated
Phase 3  — Plexus Findings (new table + AI output + EHR section)
Phase 4  — Service Registry + Facility Configuration
           (replace hardcoded ANCILLARY_TESTS and VALID_FACILITIES)
Phase 5  — Order Note lifecycle
           (extend generated_notes + FEATURE_CANONICAL_ORDER_NOTE)
Phase 6  — Engagement/PCS canonical migration + Clinician Portal client
           (shadow validate engagement, migrate readers, build clinician UI)
Phase 7  — Screening Addendum
           (new note_addenda table + screening → addendum trigger)
Phase 8  — Procedure Note generation trigger
           (add to POST /api/case-document-readiness/complete + enable generator flags)
Phase 9  — Billing canonical chain
           (FEATURE_CANONICAL_BILLING_READINESS → DOCUMENT → CLAIMS)
Phase 10 — Invoicing / Facility timezone / Plexus Bank
           (add timezone to clinics + Phase 2J flags + ledger model)
Phase 11 — EMR Integration
Phase 12 — Reporting + Legacy Retirement
```

**No phase may begin without explicit project owner approval following Phase 1 review.**

---

## Complete Table Inventory (84 tables confirmed)

All 84 tables in the database as of inspection date:

`admin_settings`, `analysis_jobs`, `ancillary_appointments`, `ancillary_case_admin_review_events`, `ancillary_case_reconciliation_failures`, `ancillary_document_reconciliation_failures`, `ancillary_document_references`, `ancillary_document_templates`, `app_settings`, `audit_log`, `billing_document_requests`, `billing_readiness_checks`, `billing_records`, `canonical_appointment_reconciliation_failures`, `case_document_readiness`, `cash_price_settings`, `ci_audit_entries`, `ci_evidence_records`, `ci_learning_items`, `ci_rule_versions`, `ci_rules`, `clinics`, `completed_billing_packages`, `contacts`, `conversations`, `cooldown_records`, `document_blobs`, `document_requirements`, `document_surface_assignments`, `documents`, `engagement_call_settings`, `engagement_list_memberships`, `engagement_lists`, `engagement_reconciliation_failures`, `generated_notes`, `global_plexus_patients`, `global_schedule_events`, `insurance_eligibility_reviews`, `invoice_adjustments`, `invoice_batch_items`, `invoice_batches`, `invoice_delivery_events`, `invoice_denials`, `invoice_line_items`, `invoice_payments`, `invoice_readiness_snapshots`, `invoices`, `marketing_materials`, `messages`, `outbox_items`, `outreach_calls`, `outreach_schedulers`, `patient_ancillary_cases`, `patient_clinic_memberships`, `patient_execution_cases`, `patient_external_identifiers`, `patient_identity_match_candidates`, `patient_identity_merge_events`, `patient_journey_events`, `patient_notes`, `patient_reference_data`, `patient_screenings`, `patient_test_history`, `plexus_id_aliases`, `plexus_identity_link_failures`, `plexus_projects`, `plexus_task_collaborators`, `plexus_task_events`, `plexus_task_messages`, `plexus_task_reads`, `plexus_tasks`, `portal_widgets`, `procedure_events`, `procedure_notes`, `projected_invoice_rows`, `pto_requests`, `remittance_events`, `scheduler_assignments`, `scheduling_triage_cases`, `screening_batches`, `session`, `uploaded_documents`, `users`, `workspace_prefs`

---

## Approval Gate

**This document requires explicit project owner review and approval before Phase 2 begins.**

Absence of feedback is NOT approval.

Upon approval, Phase 2 scope is:
- Enable `FEATURE_PLEXUS_IDENTITY_WRITE` after identity backfill validation
- Enable `FEATURE_ANCILLARY_CASE_WRITE` after Phase 2A validated
- Implement dual-write in `commitPatient()` to both `patient_execution_cases` and `patient_ancillary_cases`
- Begin shadow validation per spec's Phase D criteria
- No legacy reader migration until shadow validation exit criteria are met
