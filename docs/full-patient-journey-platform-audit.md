# Full Patient Journey Platform Audit — v3.1

**Repository:** noorhanmedical/tertiary-command-center
**Starting main SHA:** `2aaa23bc75b0940c3c24f20d7abaf149403a322d`
**Audit branch:** `audit/full-patient-journey-platform`
**Status:** Documentation-only. Zero application/UI/schema/migration/data changes.
**Revision v3.1:** Correct ancillary-appointment event-type definition (exclude `doctor_visit`); replace blanket "missing consent = soft warning" with a **service-specific and configurable** blocker classification; explicitly document that `billing_document` is a **proposed additive** `DOCUMENT_KIND` (not currently allowed); keep the Order Note signature requirement as an unresolved product decision that does not gate the full E2E.
**Revision v3 (retained):** Plexus is a separate platform/operator entity from each clinic. Global identity is a Plexus-central function; clinics never search, review, or approve global matches. Every patient in the platform receives or resolves to one immutable Plexus ID.

**Status of every proposal below:** Proposed v3.1 architecture — awaiting final owner approval. Nothing in this document is implemented. No decision is final until an owner explicitly approves it.

The only confirmed business requirements from owner communication so far:

- Every patient imported into Plexus receives or resolves to one global Plexus ID.
- Plexus centrally handles cross-clinic identity resolution.
- Clinics perform normal clinic operations only.
- Authorized Plexus users review ambiguous cross-clinic matches.
- Prior Plexus ancillary completion creates a separate derived designation.
- Clinics remain tenant-isolated; cross-clinic identity linkage does not confer cross-clinic chart visibility.

---

## 1. Executive Summary

The platform has canonical writers for several core objects and structural gaps that block a real end-to-end patient journey. Written correctly today: `patient_screenings` (screening/qualification history), `patient_execution_cases` (engagement/outreach container), `procedure_notes` (both order and post-procedure notes), `documents` (files), `invoices` + `invoice_payments` + `invoice_adjustments` + `invoice_denials` + `remittance_events` (financial events).

**Structural gaps identified:**

1. **No global Plexus patient identity.** `patient_screenings` operates at the screening event level, scoped to a single clinic via `clinic_id`. Nothing today resolves the same real-world patient across clinics. Rename, DOB correction, clinic transfer, or re-import creates multiple rows with no durable link. The deterministic name+dob grouping module at `server/modules/patient-directory/repo.ts:3-232` groups within-tenant only and is unwired from any registered route.

2. **No canonical per-service ancillary case.** `patient_execution_cases` is a per-screening engagement container carrying `selectedServices[]` (`shared/schema/executionCase.ts:43`). It cannot cleanly anchor service-specific Admin Review, appointment, order note, procedure, report, procedure note, billing readiness, billing document, or completion status when a patient has multiple ancillary services. All service-specific state (`procedure_notes`, `procedure_events`, `case_document_readiness`, `billing_readiness_checks`, `billing_document_requests`) is keyed on `(patient_screening_id, service_type)` without an anchoring case row.

3. **Appointment fragmentation.** Four independent stores maintain appointment-adjacent state: `global_schedule_events`, `ancillary_appointments`, `patient_screenings.appointmentStatus`, `patient_execution_cases.engagementStatus`. There is no cross-store sync; `server/routes/outreach.ts:352` fires `ensureCanonicalSpineForScreening` as a fire-and-forget promise.

4. **Note-generation lifecycle collapsed into one operation.** `createPendingProcedureNotes` at `server/repositories/generatedNotes.repo.ts:82-132` unconditionally writes BOTH `order_note` AND `post_procedure_note` on procedure completion. Order Note should exist before the procedure workflow when its own preconditions are satisfied (Admin Review approved + scheduled appointment), independently of procedure completion. Business-rule gates for both notes are not enforced at write.

5. **Billing-document → claim chasm.** `billing_document_requests.generatedDocumentId` at `shared/schema/billingDocuments.ts:33` has no FK target, no writer, no reader. No claims table exists. No external clearinghouse submission exists. No revenue-allocation compute exists.

6. **Screening-level Admin Review incompatible with multi-service reality.** `patient_screenings.adminApprovalStatus` (`shared/schema/screening.ts:88-93`) is patient-level. Approval for two ancillaries and denial of a third cannot be captured. History is a single `admin_approval_updated` journey event, not an append-only approval log.

7. **No Plexus-central identity operating model.** All identity work today is tenant-scoped within a single clinic's `patient_screenings` rows. There is no separation between "clinic tenant record" and "global Plexus patient identity." There is no Plexus-only review queue. There is no derivation of a Plexus-ancillary designation.

**Retirement verified:** Twilio / patient SMS / patient messaging is absent from executable code. Only comments documenting the intentional removal remain. The pre-existing `/sms/twilio/inbound` auth-exemption at `server/routes.ts:210-214` is unreachable dead code — no route is registered under that path (introduced by `e23face` before Phase 1).

## 2. Global Operating Model — v3

Plexus is a **separate platform/operator entity** from each clinic. The clinic is the client. This section states the operating model that every proposal in this document must respect.

### 2.1 Clinic responsibilities

Clinics perform normal clinic operations only:

- Import patients (batch upload, single-patient manual entry, EHR/CSV import, direct schedule stub).
- Manually enter patients.
- Schedule patients.
- Update their own demographics.
- Use their own MRN / EHR identifiers.

Clinics do **not**:

- Search the Plexus global patient registry.
- Compare patients against prior clinics.
- Approve identity matches.
- Review possible cross-clinic duplicates.
- See another clinic's records.
- Perform Plexus identity resolution.

Clinic users remain tenant-scoped and do not receive access to another clinic's data merely because a global match exists.

### 2.2 Plexus responsibilities

Plexus performs the global identity work centrally and invisibly in the background.

Authorized Plexus administrators or authorized Plexus identity users can:

- View the global Plexus patient registry.
- View possible cross-clinic matches.
- Review match evidence.
- Confirm or reject identity links.
- Merge confirmed duplicate global records.
- Preserve aliases and audit history.
- See the Plexus ancillary designation and permitted cross-clinic relationships.

Identity-review access must be a Plexus-internal permission, not a general clinic admin permission.

### 2.3 Global Plexus ID guarantee

Every patient imported or entered anywhere in the Plexus platform receives or resolves to **one globally unique Plexus ID**.

The same real-world patient must retain the same Plexus ID regardless of:

- Clinic.
- Clinic transfer.
- Clinic onboarding order.
- Clinic MRN.
- Source EHR.
- Name correction.
- Phone change.
- Insurance change.
- Address change.
- Repeated screening.
- Repeated ancillary episode.

The clinic does not need to know the existing Plexus ID before import. The Plexus platform detects the possible existing patient during centralized identity resolution.

### 2.4 Tenant isolation invariants (must survive every phase)

- Clinic A cannot see Clinic B records.
- Clinic B does not receive prior-clinic information merely because Plexus linked the identity.
- Cross-clinic identity does not equal cross-clinic chart visibility.
- Search by Plexus ID must still enforce tenant + role authorization.
- Every existing repository helper that filters on `clinic_id` continues to do so.
- The Plexus-central identity work (matching, merge, alias) is a separate authorization boundary from every clinic surface.

## 3. Proposed v3 Identity Structure — awaiting owner approval

Six conceptual tables. None exist in the schema today. **None to be implemented in this audit.**

### 3.1 `global_plexus_patients`

One globally unique record per real patient in the Plexus ecosystem.

Conceptual fields:

- `id` — internal serial integer primary key.
- `plexus_id` — globally unique immutable public/platform identifier. Non-PHI. Not derived from name, DOB, clinic, sex, diagnosis, or insurance. Suggested format: `PLX-` prefix + ULID-derived or secure random identifier (opaque).
- `display_name` — current-best-known display casing.
- `normalized_name` — lower(trim(name)).
- `dob` — text YYYY-MM-DD.
- `phone` — normalized (E.164 preferred).
- `email` — normalized.
- `address` — structured or single line; treated as PHI.
- `identity_status` — enum: `active`, `possible_duplicate`, `merged`, `inactive`.
- `merged_into_patient_id` — nullable FK to `global_plexus_patients.id` (self); populated when this row was merged into a surviving row.
- `has_plexus_ancillary_history` — boolean, **derived** from completed ancillary cases (preferred) rather than manually entered.
- `first_ancillary_completed_at` — timestamptz nullable, derived.
- `most_recent_ancillary_completed_at` — timestamptz nullable, derived.
- `created_at`, `updated_at` — timestamptz.

**No `clinic_id` on this table.** Ownership is not by clinic. Every clinic relationship lives on `patient_clinic_memberships`.

### 3.2 `patient_clinic_memberships`

Represents the relationship between the global Plexus patient and each clinic client.

Conceptual fields:

- `id` — serial int PK.
- `global_plexus_patient_id` — FK to global_plexus_patients.id (NOT NULL).
- `clinic_id` — FK to clinics.id (NOT NULL).
- `clinic_mrn` — the clinic's MRN for this patient (nullable if the clinic doesn't emit one).
- `source_system` — text (e.g., `manual`, `csv_import`, `ehr_epic`, `ehr_athena`).
- `source_patient_identifier` — text; the clinic's/EHR's own patient id.
- `membership_status` — enum: `active`, `inactive`, `withdrawn`, `merged_away`.
- `first_seen_at` — timestamptz.
- `last_seen_at` — timestamptz.
- `created_at`, `updated_at`.

Rules:

- **One active membership per (global patient, clinic).** Partial unique index: `UNIQUE (global_plexus_patient_id, clinic_id) WHERE membership_status = 'active'`.
- **Clinic MRN uniqueness enforced only inside the applicable clinic/source system.** Partial unique index: `UNIQUE (clinic_id, source_system, clinic_mrn) WHERE clinic_mrn IS NOT NULL AND membership_status = 'active'`.

### 3.3 `patient_external_identifiers`

Stores identifiers used for reliable future matching.

Conceptual fields:

- `id` — serial int PK.
- `global_plexus_patient_id` — FK to global_plexus_patients.id (NOT NULL).
- `patient_clinic_membership_id` — FK to patient_clinic_memberships.id (nullable — some identifiers are cross-clinic like a Medicare identifier).
- `clinic_id` — FK to clinics.id (nullable when the identifier is not clinic-owned).
- `source_system` — text.
- `identifier_type` — enum: `clinic_mrn`, `ehr_patient_id`, `payer_member_id`, `medicare_identifier` (only where legally and operationally permitted), `external_import_id`, `prior_plexus_id_alias`.
- `identifier_value_encrypted` — encrypted or securely protected value. Do not store raw PHI in the clear when the field is sensitive.
- `normalized_or_hashed_match_value` — where appropriate; used for equality lookups without exposing the raw value.
- `active` — boolean.
- `created_at` — timestamptz.

Rules:

- Encryption or protection is required for `medicare_identifier`, `payer_member_id`, and any identifier deemed sensitive per policy.
- A `hashed_match_value` allows equality lookups without decrypting.

### 3.4 `patient_identity_match_candidates`

Plexus-only review queue.

Conceptual fields:

- `id` — serial int PK.
- `incoming_membership_id` — FK to patient_clinic_memberships.id (nullable if candidate row precedes membership creation).
- `staged_import_row_id` — FK to a per-import staging row (nullable).
- `candidate_global_patient_id` — FK to global_plexus_patients.id.
- `match_score` — numeric.
- `match_tier` — enum: `definitive`, `high`, `medium`, `low`.
- `matched_signals` — jsonb (e.g., `["dob", "phone", "name_high"]`).
- `conflicting_signals` — jsonb (e.g., `["insurance_id"]`).
- `review_status` — enum: `pending`, `confirmed`, `rejected`, `deferred`.
- `reviewed_by_user_id` — FK to users.id (nullable).
- `reviewed_at` — timestamptz (nullable).
- `review_note` — text (nullable).
- `created_at` — timestamptz.

Access is restricted to authorized Plexus identity users only.

### 3.5 `patient_identity_merge_events`

Append-only Plexus audit history.

Conceptual fields:

- `id` — serial int PK.
- `surviving_global_patient_id` — FK to global_plexus_patients.id.
- `merged_global_patient_id` — FK to global_plexus_patients.id.
- `surviving_plexus_id` — text (denormalized snapshot for audit).
- `merged_plexus_id` — text (denormalized snapshot).
- `reviewed_by_user_id` — FK to users.id.
- `reason` — text.
- `evidence_snapshot` — jsonb (matched/conflicting signals at merge time, immutable).
- `merged_at` — timestamptz.

Rows never mutate. If a merge is reversed later, a new row records the reverse — the original row is not altered.

### 3.6 `plexus_id_aliases`

Preserves old Plexus IDs after duplicate merges.

Conceptual fields:

- `alias_plexus_id` — text primary key.
- `surviving_global_patient_id` — FK to global_plexus_patients.id.
- `reason` — text.
- `created_at` — timestamptz.

Rules:

- Old Plexus IDs must **remain searchable** and redirect to the surviving global patient.
- Old Plexus IDs must **never be reused**.

## 4. Plexus ID Generation

- The public Plexus ID is assigned only **after** the central identity-resolution process determines that no existing global patient should be reused.
- A provisional internal import row may exist briefly before Plexus ID assignment (staged inside the clinic tenant boundary).
- The public Plexus ID is opaque and non-PHI:
  - Not derived from name, DOB, clinic code, diagnosis, sex, or insurance.
  - Not a sequential visible number.
  - Suggested: `PLX-` + ULID-derived or secure random identifier.
- Internal serial integer `id` remains the database primary key (matches every other domain table's ID convention).
- The Plexus ID is immutable once assigned.
- Old Plexus IDs (after merges) are preserved in `plexus_id_aliases` and continue to resolve to the surviving global patient.

## 4A. Canonical Ancillary Appointment — Event-Type Restriction (v3.1)

Only two `global_schedule_events.event_type` values may represent a canonical appointment for a `patient_ancillary_case`:

- `ancillary_appointment`
- `same_day_add`

A generic `doctor_visit` event **does NOT** link to `patient_ancillary_cases` and **does NOT** satisfy Order Note scheduling eligibility. `doctor_visit` remains a general clinic appointment and is outside the ancillary lifecycle unless a future explicit conversion workflow is designed and approved separately.

### 4A.1 Required constraints

- `global_schedule_events.ancillary_case_id` is **required** for `event_type IN ('ancillary_appointment', 'same_day_add')`. Enforce via check constraint after backfill (Phase 2D).
- `global_schedule_events.service_type` is **required** for those same two event types.
- The **partial unique index enforcing one active canonical ancillary appointment per case** applies ONLY to:

  ```sql
  UNIQUE (ancillary_case_id)
  WHERE event_type IN ('ancillary_appointment', 'same_day_add')
    AND status = 'scheduled'
  ```

- **Order Note eligibility must consider only** an active or completed canonical ancillary appointment linked to the same ancillary case, i.e., a `global_schedule_events` row with:
  - `ancillary_case_id = <this case>`
  - `event_type IN ('ancillary_appointment', 'same_day_add')`
  - `status IN ('scheduled', 'completed')`
  - matching `service_type`

`doctor_visit` rows must NOT contribute to Order Note eligibility.

### 4A.2 Reasoning

Grouping `doctor_visit` with ancillary appointment events would let a generic clinic visit satisfy an Order Note precondition, which is clinically wrong (an ancillary Order Note is authored for a specific ancillary service delivered on a specific canonical appointment). The clinic doctor visit is a separate encounter with its own workflow.

If a future conversion workflow is needed (e.g., "convert a same-day walk-in doctor visit into an ancillary appointment"), it must be an explicit, auditable transition that creates or links a new `ancillary_appointment` row — not an implicit event-type broadening.

## 4B. Consent & Procedure-Blocker Classification — Service-Specific and Configurable (v3.1)

The prior v3 draft classified "missing consent" as a blanket "soft operational warning." **That is retracted.** Consent classification MUST be service-specific and configurable per ancillary service. Some ancillary services have legally or clinically required consent that is a **hard blocker**; other services have optional administrative acknowledgments that are truly soft.

### 4B.1 Blocker categories

**A. Hard procedure blocker (procedure must not start):**

- Legally required consent (per applicable jurisdiction / service).
- Clinically required consent (per service's clinical protocol).
- Missing or unresolved patient identity.
- Invalid or absent canonical ancillary appointment where required.
- Inactive clinic tenancy.
- Service-specific safety prerequisite (e.g., pre-procedure clearance flag on the service configuration).

**B. Soft operational warning (procedure allowed with warning):**

- Optional administrative acknowledgment.
- Nonessential demographic gap.
- Information that does not create a legal, clinical, or safety restriction.

**C. Documentation follow-up item (never blocks procedure):**

- Optional nonclinical form.
- Marketing form.
- Nonessential administrative document.

**D. Billing blocker (blocks billing / billing-document generation, NOT the procedure):**

- Missing insurance verification when it does not prohibit performing the service.
- Missing authorization when payer rules permit performance but prevent billing.
- Missing billing-specific demographic or provider information.

**E. Claim-submission blocker (blocks claim submission, NOT the procedure):**

- Missing coding.
- Missing payer-required claim field.
- Missing final signature required for claim submission.

### 4B.2 Rules

- The platform **must not block** a study merely because nonessential information is missing.
- The platform **must never bypass** required consent, clinical safety, legal, or service-specific prerequisites.
- Consent is **not hardcoded globally** as either hard or soft. Each ancillary service's configuration determines:
  - Whether consent is required.
  - Which consent document(s) is/are required.
  - When it must be completed (before scheduling / before check-in / before procedure start / before billing).
  - Whether it blocks scheduling, check-in, procedure start, or only billing.
  - Which roles may override a warning (only for categories that permit override).
  - Which requirements are not overrideable (hard blockers cannot be silently bypassed; overrides for hard blockers require an explicit, audited exception path with rationale).

### 4B.3 Storage model (proposed additive — not implemented)

The ancillary service configuration must be data-driven. Proposed conceptual location:

- Extend `document_requirements` (existing table at `shared/schema/documentReadiness.ts`) with columns:
  - `blocker_category` — enum: `hard_procedure`, `soft_operational`, `documentation_followup`, `billing_blocker`, `claim_blocker`.
  - `blocks_stage` — enum or set: `scheduling`, `check_in`, `procedure_start`, `billing_document_generation`, `claim_submission`.
  - `override_allowed` — boolean.
  - `override_roles` — text[].
  - `override_audit_required` — boolean.
- OR add a companion table `ancillary_service_prerequisite_config(service_type, document_type, blocker_category, blocks_stage, override_allowed, override_roles, override_audit_required)`.

Final choice is a Phase 2F/G design decision; the classification is the requirement.

## 4C. `billing_document` Document Kind — Proposed Additive (v3.1)

`shared/schema/documents.ts` today declares a `DOCUMENT_KINDS` tuple used by:

- Zod / insert validation
- TypeScript type union
- Route validation for POST `/api/documents-library`
- Client display labels + filters (Ancillary Documents, Patient EHR, Document Library, Finance/Billing)
- Surface assignments

**`billing_document` is NOT currently a member of `DOCUMENT_KINDS`.** The audit's Phase 2G references `documents` rows with `kind='billing_document'`; that string is not a valid kind under the current contract. Any generator writing such rows would fail validation and every downstream reader would silently drop them.

**Status:** Proposed additive document kind to be introduced in Phase 2G. Not currently available. The generator must NOT be enabled until the shared document contract accepts the new kind.

**Required Phase 2G changes (all must land before the generator is enabled):**

- Shared document-kind constant / tuple: add `"billing_document"` to `DOCUMENT_KINDS` at `shared/schema/documents.ts`.
- TypeScript type: `DocumentKind` union extended.
- Zod validation / `insertDocumentSchema` / update validation.
- Route validation (`POST /api/documents-library` payload schema).
- Client display labels — Ancillary Documents (`client/src/pages/documents.tsx` DOC_KIND_LABELS), Patient EHR document mapping, Document Library.
- Filters + query handling on Document Library and Ancillary Documents.
- Allowed surface assignments — decide which `document_surface_assignments.surface` values (e.g., `patient_chart`, or a new `billing_workspace`) apply.
- Finance / Billing workspace document mapping.
- Unit tests: `tests/unit/documentKindContract.test.ts` asserts every consumer accepts `billing_document`.
- Integration tests: generator writes → readers render.
- E2E assertions: Playwright asserts a billing document appears on Patient EHR + Billing workspace after generation.

**Prohibition:** The billing document generator (Phase 2G) MUST NOT be enabled until every consumer on the list above accepts `billing_document`. Enabling the generator earlier would produce rows that pass insert validation for some paths and fail for others, corrupting the document library.

## 5. Central Matching Flow

**Clinic** imports or enters a patient normally → **clinic-scoped staging/import record** is created → **Plexus centralized identity resolver** searches the global Plexus registry → one of three outcomes:

**A. Definitive/high-confidence existing match**

- Reuse existing `global_plexus_patients` row.
- Reuse existing Plexus ID.
- Create new `patient_clinic_memberships` row for the new clinic.
- Create `patient_external_identifiers` rows for any new identifiers the import carried.
- Create audit event (journey / identity event as applicable).
- Clinic continues normal workflow — no clinic-facing prompt.

**B. Possible match**

- Create `patient_identity_match_candidates` row (Plexus-only).
- Clinic continues normal operations without performing the review.
- Meanwhile: the clinic-scoped staging record remains available for that clinic's workflow — either as a provisional new global patient or held pending review, per policy.
- Authorized Plexus user reviews the candidate:
  - **Confirmed** → link membership to the existing global patient; create alias for the provisional Plexus ID if one was pre-assigned; record `patient_identity_merge_events`.
  - **Rejected** → create new `global_plexus_patients` row + new Plexus ID; the membership binds to the new global.
  - **Deferred** → candidate remains pending; clinic membership binds to a provisional global row that may later be merged.

**C. No match**

- Create new `global_plexus_patients` row.
- Assign new Plexus ID.
- Create `patient_clinic_memberships` row.
- Create `patient_external_identifiers` rows for the import identifiers.

**The clinic performs no global matching.**

## 6. Matching Rules

- **Existing Plexus ID** or trusted **source-system identifier** (e.g., a returning EHR patient ID from the same clinic) can be definitive.
- **Exact clinic MRN** is definitive **only within the same clinic/source system**. Same MRN in a different clinic is not a match signal at all.
- **Insurance / member identifiers** can be strong signals where operationally and legally permitted.
- **DOB + phone + strong name match** may be high confidence.
- **Name + DOB alone must never auto-merge.**
- Match scoring must consider both **matching** signals AND **conflicting** signals (mismatched DOB, mismatched insurance identifier, etc.).
- Ambiguous matches go to Plexus-only review (`patient_identity_match_candidates`).
- **No automatic merge solely from fuzzy demographic similarity.**

## 7. Privacy and Access Rules

- Global Plexus identity is controlled by Plexus.
- Clinic users remain scoped to their clinic membership and clinic-owned records.
- Clinic A cannot see Clinic B records.
- Clinic B does not receive prior-clinic information merely because Plexus linked the identity.
- Authorized Plexus users can see the global identity and permitted relationships.
- **Identity-review access must be a Plexus-internal permission**, not a general clinic admin permission.
- **Search by Plexus ID must still enforce tenant + role authorization.**
- Cross-clinic identity does not equal cross-clinic chart visibility.
- Global patient rows are accessible only to Plexus-internal roles.
- Clinic-facing endpoints join through `patient_clinic_memberships` and NEVER expose a global patient row directly.

## 8. Plexus Ancillary Designation

Every imported patient receives a Plexus ID. A **separate special designation** is derived for patients who have completed an ancillary through Plexus.

Designation states (derived from data, not manually set):

- Never had Plexus ancillary.
- Active ancillary episode.
- Prior Plexus ancillary completed.
- Multiple Plexus ancillary episodes.
- On ancillary cooldown where applicable.

Suggested derived fields on `global_plexus_patients` (or a materialized view):

- `has_plexus_ancillary_history` boolean.
- `ancillary_case_count` int.
- `completed_ancillary_case_count` int.
- `ancillary_services_completed` text[].
- `first_ancillary_completed_at` timestamptz.
- `most_recent_ancillary_completed_at` timestamptz.

All derived from canonical `patient_ancillary_cases` (see §9) + `procedure_events` completion. Never manually typed onto the patient.

**Privacy invariant:** The designation on a global patient does not expose prior-clinic clinical records to a different clinic merely because the designation is set. A clinic viewing its own membership row may see "this patient has prior Plexus ancillary history" as a boolean fact, but it does not see the prior clinic's chart.

## 9. Revised Ancillary Case Model — v3

`patient_ancillary_cases` (proposed v3) links to:

- `global_plexus_patient_id` — FK to global_plexus_patients.id (NOT NULL).
- `patient_clinic_membership_id` — FK to patient_clinic_memberships.id (NOT NULL).
- `clinic_id` — FK to clinics.id (NOT NULL; denormalized for tenant scoping).
- `originating_screening_id` — FK to patient_screenings.id (nullable; the screening that qualified this ancillary if applicable).
- `execution_case_id` — FK to patient_execution_cases.id (nullable; the engagement container).
- `service_type` — text NOT NULL.
- `episode_sequence` — int NOT NULL DEFAULT 1 (increments when the same patient repeats the same service later).
- `opened_at` — timestamptz DEFAULT now().
- `closed_at` — timestamptz nullable.
- `lifecycle_status` — text: `new`, `active`, `on_hold`, `closed`, `cancelled`, `archived`.
- `qualification_status` — text: `unscreened`, `qualified`, `not_qualified`, `pending_review`.
- `admin_review_status` — text: `pending`, `approved`, `needs_info`, `rejected` (projection of latest event on the append-only history table).
- `clinically_completed_at` — timestamptz nullable.
- `financially_completed_at` — timestamptz nullable.

**Ownership rules:**

- Every downstream service-specific artifact (procedure_notes, procedure_events, case_document_readiness, billing_readiness_checks, billing_document_requests, documents.kind='report') links to `patient_ancillary_cases.id` in v3.
- The canonical appointment does **not** live on the ancillary case row. Appointment ownership remains `global_schedule_events.ancillary_case_id` → `patient_ancillary_cases.id`. Resolve the active appointment by querying canonical schedule events.

### 9.1 Ancillary episode uniqueness

Do **not** use `UNIQUE (global_patient_id, clinic_id, service_type)` — patients repeat services legitimately.

Recommended constraint:

- Partial unique constraint: `UNIQUE (global_plexus_patient_id, clinic_id, service_type) WHERE lifecycle_status IN ('new','active','on_hold')` — only one **active** episode per patient/clinic/service.
- Closed historical cases remain.
- A repeated future service creates a new `patient_ancillary_cases` row with `episode_sequence = max(prev) + 1`.

## 10. Patient Ingestion — Correct Language

Replace any wording implying:

- The clinic recognizes a prior Plexus patient.
- The clinic searches global identity.
- The clinic confirms matches.
- The clinic has access to previous clinic relationships.

Correct language:

- The clinic submits ordinary patient data.
- Plexus centrally resolves identity.
- Plexus authorized users review ambiguity.
- Clinic workflow continues normally.
- Global identity linkage remains a Plexus platform function.

## 11. Current Canonical Entities Today (unchanged evidence)

| Concept | Today | Sufficient for v3? |
|---------|:------|:-------------------|
| Patient identity (within a clinic tenant) | `patient_screenings` row keyed on int PK; deterministic name+dob grouping unwired | No — no global identity exists; no cross-clinic resolution |
| Ancillary case | `patient_execution_cases` per-screening engagement container; `selectedServices[]` array | No — cannot anchor service-specific state per episode |
| Appointment | 4 stores independent | No |
| Order Note / Procedure Note | `procedure_notes` canonical table with unique `(patientScreeningId, serviceType, noteType)`; unconditional write | Table shape sufficient; write gate missing |
| Report | `documents` kind='report' with legacy uploaded_documents first-read migration (name-based) | Adequate; name-based fallback is a data-quality risk |
| Billing Document Request | `billing_document_requests` with orphan `generatedDocumentId` | Partial |
| Payment / Invoice / Adjustment / Denial / Remittance | Wired | Adequate |
| Claim | Not implemented | No |
| Journey completion | Not implemented as aggregate | No |

Every file:line citation for these findings appears in the Verification Appendix (§16).

## 12. Corrected auth finding on `/api/generated-notes`

The route IS authenticated globally. Verified at commit `2aaa23b`:

- `server/routes.ts:239` — `app.use("/api", requireAuth);`
- `server/routes.ts:270` — `registerGeneratedNotesRoutes(app);`

Route registration order matters — global `requireAuth` is mounted BEFORE `registerGeneratedNotesRoutes`, so all `/api/generated-notes` calls pass through the auth gate.

The real defects:

1. Not clinic-scoped. The handler at `server/routes/generatedNotes.ts:11-18` returns notes across every clinic.
2. Legacy read path. `/ancillary-documents` reads it while all note writes go to `procedure_notes`.
3. Architecturally unsafe — retiring the display of this endpoint on `/ancillary-documents` in favor of a canonical read from `procedure_notes` is the correct fix.

## 13. Master Lifecycle Table

_All file:line citations at commit `2aaa23b`. This table describes today's state. §2–§10 describe the proposed v3 model — awaiting owner approval._

### 13.1 Patient Ingestion

| Field | Value |
|---|---|
| Stage | Patient Ingestion (multi-path) |
| Route | POST `/api/batches`, `.../patients`, `.../import-file`, `.../import-text` · POST `/api/plexus-iq/clinical-import` · POST `/api/patient-directory/import-confirm` (flag) · POST `/api/appointments` (stub) |
| Server handler | `server/routes/batches.ts:49-718` · `server/routes/plexusIqClinicalImport.ts:263-543` · `server/routes/patientDirectory.ts:191-433` · `server/routes/appointments.ts:25-89` |
| Table today | `patient_screenings` (clinic-scoped) |
| Canonical entity (today) | patient_screenings row |
| Canonical entity (v3 target) | Two distinct rows co-exist per import: `global_plexus_patients` (Plexus-owned) + `patient_clinic_memberships` (clinic membership) + `patient_external_identifiers` (identifiers). `patient_screenings` remains the clinic-owned screening/qualification history. |
| Central identity flow (v3) | Clinic writes clinic-scoped staged row → Plexus resolver runs asynchronously → outcome A / B / C per §5. Clinic surface does not block or prompt. |
| Current defect | (1) No global identity. (2) PATCH `/api/patients/:id` allows `data.name` mutation with no collision check (`server/routes/patients.ts:81`). (3) `patient_test_history` writes name+dob only, no FK (`shared/schema/patientHistory.ts:4-25`). |

### 13.2 Qualification (Plexus IQ)

| Field | Value |
|---|---|
| Stage | Qualification |
| Table today | `patient_screenings.qualifyingTests` + `.reasoning` |
| Anchor (v3) | Same table + `patient_ancillary_cases.qualification_status` projection |
| Current defect | `batchAnalysisRunner.ts:714-728` overwrites `reasoning` on re-run without calling `preserveAdminReviewReasoning` (function exists at `shared/plexus-iq/adminReviewEvidence.ts:969-985`). |

### 13.3 Admin Review (v3 — service-specific)

| Field | Value |
|---|---|
| Stage | Admin Review — service-specific per ancillary case |
| Table today | `patient_screenings.adminApprovalStatus` (screening-level, single row overwrite) |
| Anchor (v3) | Append-only `ancillary_case_admin_review_events` + projection `patient_ancillary_cases.admin_review_status` |
| Timestamps | `actual_reviewed_at = now()` NEVER backdated; optional `effective_clinical_date` |
| Current defect | Screening-level cannot express per-service decisions; single row prevents auditable history. |

### 13.4 Engagement & Outreach

| Field | Value |
|---|---|
| Stage | Engagement / Outreach |
| Table today | `patient_execution_cases` (engagement container per screening) + `outreach_calls` |
| Anchor (v3) | Execution case remains the engagement container; per-service ancillary_case rows track service-level status. |
| Current defect | Two divergent write paths: `/api/outreach/calls` vs `/api/engagement-center/call-result` do not converge (audit §5.4). |

### 13.5 Scheduling

| Field | Value |
|---|---|
| Stage | Scheduling |
| Table today | `global_schedule_events` + `ancillary_appointments` + `patient_screenings.appointmentStatus` + `patient_execution_cases.engagementStatus` (all independent) |
| Anchor (v3) | `global_schedule_events` sole canonical, subject to seven conditions in §14.4 (linked to ancillary_case_id, service_type required, one active per case, reschedule lineage, cancellation/no-show reasons preserved). |

### 13.6 Order Note (v3 — reconcileOrderNoteEligibility)

| Field | Value |
|---|---|
| Stage | Order Note |
| Trigger (today) | Procedure completion — unconditional |
| Trigger (v3) | `reconcileOrderNoteEligibility(ancillary_case_id)` after Admin Review OR canonical appointment change |
| Precondition (v3) | Admin Review approved AND canonical appointment scheduled |
| Table | `procedure_notes` with `noteType='order_note'`; v3 adds `ancillary_case_id` + `notes_lineage_id` |
| Current defect | Unconditional write; no lineage; no generator; `/ancillary-documents` reads legacy `/api/generated-notes` while writes go to `procedure_notes`. |

### 13.7 Procedure Event

| Field | Value |
|---|---|
| Stage | Procedure execution |
| Table today | `procedure_events` |
| Statuses today | `not_started, in_progress, complete, cancelled, no_show, reschedule_needed` — only `complete` reachable |
| Anchor (v3) | `procedure_events.ancillary_case_id` |

### 13.8 Report

| Field | Value |
|---|---|
| Stage | Report upload + associate |
| Table today | `documents` (canonical) + `uploaded_documents` (legacy migrated on first read) + `document_blobs` + `document_surface_assignments` |
| Anchor (v3) | `documents.ancillary_case_id` for reports (additive) |
| Current defect | Legacy migration uses exact-name matching (`server/routes/documentLibrary.ts:104`). |

### 13.9 Procedure Note (v3 — reconcileProcedureNoteEligibility)

| Field | Value |
|---|---|
| Stage | Procedure Note |
| Trigger (v3) | `reconcileProcedureNoteEligibility(ancillary_case_id)` after procedure complete OR report upload/replacement |
| Precondition (v3) | Procedure completed AND canonical report available |
| Table | `procedure_notes` `noteType='post_procedure_note'`; v3 adds ancillary_case_id + notes_lineage_id |

### 13.10 Billing Readiness

| Field | Value |
|---|---|
| Table | `billing_readiness_checks` |
| Anchor (v3) | `billing_readiness_checks.ancillary_case_id` |
| Current defect | Fire-and-forget billing_document_requests creation. |

### 13.11 Billing Document Request

| Field | Value |
|---|---|
| Table | `billing_document_requests` |
| Anchor (v3) | `billing_document_requests.ancillary_case_id` |
| Current defect | `generatedDocumentId` orphan (no FK, no writer, no reader); no generator service; `sent_to_billing` declared but no writer. |

### 13.12 Claim

**Not implemented.** No table. No route. No submission code. Product decision required.

### 13.13 Payment / Adjustment / Denial / Remittance / Invoice

Payments, adjustments, denials, remittance events wired (see §11 above). Invoice lifecycle exists; missing `closed` state; `sent_to_billing` declared elsewhere but not on invoices.status.

### 13.14 Journey Completion

Not implemented as aggregate. Discrete completion timestamps proposed on `patient_ancillary_cases.clinically_completed_at` + `.financially_completed_at` (v3). Aggregate view `patient_journey_status` proposed for Phase 2K.

## 14. Required Tables — Summary

| # | Concept | Purpose | Canonical table | Canonical ID | Globally unique or clinic-scoped | Created by | Visible to clinic user | Visible to authorized Plexus user | Matching role | Merge behavior | Downstream references |
|---|---------|---------|-----------------|--------------|----------------------------------|------------|:------------------------:|:---------------------------------:|---------------|----------------|-----------------------|
| 1 | Global Plexus patient | Single durable identity per real patient across the Plexus ecosystem | `global_plexus_patients` (v3 proposal) | serial int PK | Globally unique | Plexus resolver (outcome A reuses existing; outcome C creates) | ❌ never directly — visible only through the clinic's membership projection | ✅ | Anchors matching; carries `identity_status` | Merged rows retain `merged_into_patient_id` → surviving; `plexus_id_aliases` preserves old public IDs | Every downstream record joins through the membership |
| 2 | Plexus ID | Opaque platform-wide public identifier | text field on `global_plexus_patients.plexus_id` | text (opaque, non-PHI, `PLX-` prefix) | Globally unique | Assigned when Plexus resolver creates a new global patient | ⚠️ visible only when the clinic's own membership row surfaces it; NOT a cross-clinic lookup | ✅ | Definitive match signal when a returning import carries an existing Plexus ID | Immutable per global patient; old IDs preserved in `plexus_id_aliases` | Every clinic-facing surface renders the Plexus ID for THIS clinic's membership only |
| 3 | Clinic membership | Relationship between global patient and one clinic client | `patient_clinic_memberships` (v3 proposal) | serial int PK | Clinic-scoped (one active per patient+clinic) | Clinic import path (staging → resolver → membership) | ✅ (own clinic only) | ✅ | Definitive within-clinic match via clinic MRN | On merge, memberships from the merged global follow the surviving global | Ancillary cases, screenings, and every clinic-owned artifact link through membership + clinic_id |
| 4 | Clinic MRN | Clinic-owned patient identifier | column on `patient_clinic_memberships.clinic_mrn` + row in `patient_external_identifiers` | text | Clinic-scoped | Clinic import (import row supplies it) | ✅ (own clinic only) | ✅ | Definitive within same clinic/source system; not a match signal across clinics | Preserved on merge; alias if MRN was under merged global | Reads via clinic surfaces only |
| 5 | External identifier | Additional identifiers for matching | `patient_external_identifiers` (v3 proposal) | serial int PK | Mostly cross-clinic (e.g., Medicare); clinic MRN scoped to its clinic | Plexus resolver during resolution; clinic import supplies | ⚠️ some clinic-scoped identifiers visible to clinic; cross-clinic identifiers Plexus-only | ✅ | Strong signals per §6 | Preserved on merge under surviving global | Used by resolver; not surfaced on operational UI |
| 6 | Screening | Screening/qualification event | `patient_screenings` (exists today) | serial int PK | Clinic-scoped | Clinic ingest paths | ✅ (own clinic only) | ✅ | Not a matching table; screening rows carry a membership FK in v3 | Preserved | Qualification, engagement, ancillary case, order/procedure notes anchored here today; v3 adds `patient_clinic_membership_id` FK |
| 7 | Ancillary case | Per-service episode of care | `patient_ancillary_cases` (v3 proposal) | serial int PK | Clinic-scoped (belongs to a membership + a clinic) | Plexus IQ approve service / admin add service | ✅ (own clinic only) | ✅ | Not a matching table | Preserved; belongs to the membership | Every service-specific artifact (procedure_events, procedure_notes, case_document_readiness, billing_readiness_checks, billing_document_requests, documents.kind='report') |
| 8 | Ancillary designation | Derived indicator of Plexus ancillary history | Derived from `patient_ancillary_cases` + `procedure_events` completion; materialized on `global_plexus_patients` | Derived fields (see §8) | Globally derived; boolean surfaced per-membership | Automatically derived — never manually typed | ⚠️ clinic sees only "has prior Plexus ancillary" boolean flag; no prior clinic chart | ✅ | Not a matching table | Recomputed after merges | Patient EHR shows the flag; Plexus surfaces show full history |
| 9 | Match candidate | Plexus-only review queue for possible matches | `patient_identity_match_candidates` (v3 proposal) | serial int PK | Plexus-central | Plexus resolver on outcome B (possible match) | ❌ | ✅ | Authorized Plexus review only | Confirmed candidate merges into existing global patient; rejected creates new global | Merge events + membership updates |
| 10 | Merge event | Append-only Plexus identity audit | `patient_identity_merge_events` (v3 proposal) | serial int PK | Plexus-central | Plexus reviewer action | ❌ | ✅ | Immutable history | Never mutated | Referenced by `plexus_id_aliases` |
| 11 | Plexus ID alias | Old Plexus IDs preserved for lookup | `plexus_id_aliases` (v3 proposal) | alias_plexus_id text PK | Globally unique | Automatically populated on merge | ❌ raw alias not clinic-facing; searching for the alias surfaces the surviving global's membership per tenant rules | ✅ | Lookup returns surviving global for a merged alias | Never reused | Search flows redirect from alias → surviving global (subject to tenant scoping) |

## 15. Items Requiring Product Decision

1. **"Plexus internal clinical" role.** Should there be a distinct role separate from `admin` / `clinician` / `scheduler` / `biller` / `technician` / `liaison` for Plexus-central identity work? Today USER_ROLES has no `internal_reviewer` / `identity_reviewer` / `plexus_admin` variant.
2. **Claims strategy.** In-house EDI 837 + clearinghouse + 835 remittance parser OR delegate to external RCM (post charges via partner API, receive statuses via webhook)?
3. **Revenue allocation.** `projectedInvoices.projectedOurPortionPercentage` defaults to `"50"` (`shared/schema/projectedInvoices.ts:34`). Is this the canonical split? Where should the persisted ledger live?
4. **Effective clinical date exposure.** `ancillary_case_admin_review_events.effective_clinical_date` is an optional decoupling of clinical intent from action timestamp. Should the UI expose this widely, or restrict to retroactive-review workflows?
5. **Order-note signature requirement — UNRESOLVED (v3.1).** `KINDS_REQUIRING_SIGNATURE = ['post_procedure_note','report']` at `server/services/ancillary/signingService.ts:51-54` excludes `order_note`. Four sub-questions must be answered together, and none has an implicit default:
   1. Does an Order Note require clinician signature at all?
   2. If so, which role may sign it (physician / clinician / any authorized signer)?
   3. Must the Order Note merely be **generated** before procedure start, or **signed** before procedure start?
   4. Does the requirement vary by ancillary service (some services require signed order; others do not)?

   Until this is resolved, the full E2E test (Phase 2K) MUST NOT unconditionally require a signed Order Note. The E2E scenario states: "Order Note generated when eligibility conditions are met; Order Note signed before procedure ONLY when required by the configured service rule." If no service configures a signature requirement, the E2E passes without signature; if any service does, the corresponding step asserts signature for that service only.
6. **Plexus Bank future.** Retiring, moving to a real backend, or staying as a demo shell?
7. **Ancillary Documents legacy `/api/generated-notes` display.** Retire completely or route through canonical `procedure_notes`?
8. **Sensitive identifier storage.** Encryption strategy for Medicare/payer identifiers on `patient_external_identifiers`. At-rest column encryption via pgcrypto? External KMS? Column-level policy?
9. **Match candidate SLA.** How long does a `patient_identity_match_candidates` row stay `pending` before triggering an operational alert? What is the default clinic workflow while the candidate is under review?
10. **Alias search access.** Should clinic users be able to search by an aliased Plexus ID? If yes, the response must still enforce tenant scoping — the alias lookup returns the surviving global patient only if that patient has a membership in the caller's clinic.

## 16. Items Requiring Migration (proposals only — none in this audit)

All additive, non-destructive.

| Phase | New table | New column | Notes |
|-------|-----------|------------|-------|
| 2A | `global_plexus_patients`, `patient_clinic_memberships`, `patient_external_identifiers`, `patient_identity_match_candidates`, `patient_identity_merge_events`, `plexus_id_aliases` | `patient_screenings.patient_clinic_membership_id`, `patient_screenings.canonical_patient_id` (transitional projection) | Backfill via one-shot script; not `drizzle-kit push`. Every non-Plexus surface joins through the membership. |
| 2B | `patient_ancillary_cases` | (populated via backfill from execution_cases + selectedServices) | Composite partial-unique constraint on active episodes per (global_plexus_patient_id, clinic_id, service_type). |
| 2C | `ancillary_case_admin_review_events` (append-only) | `patient_ancillary_cases.admin_review_status` | Never mutates; projection column stays in sync. |
| 2D | (none) | `global_schedule_events.ancillary_case_id`, `parent_event_id`, `cancellation_reason`, `no_show_reason`; `ancillary_appointments.global_schedule_event_id`; extend status enum with `rescheduled`; partial unique index one-per-case | Backfill script populates FK. |
| 2E | (none) | `procedure_notes.ancillary_case_id`, `notes_lineage_id`, `correction_of_note_id`, `effective_date`; extend signatureStatus with `voided` | |
| 2F | (none) | `procedure_events.ancillary_case_id`, `started_at`, `paused_at`, `cancelled_at`, `no_show_at`, `unable_to_complete_at`, `unable_to_complete_reason`; `documents.ancillary_case_id` | |
| 2G | (optional index) | `billing_readiness_checks.ancillary_case_id`; `billing_document_requests.ancillary_case_id`; convert `generatedDocumentId` to FK; `attempt_count`, `last_error_at`; `invoices.billing_document_request_id` | Enforce FK after clean data. |
| 2J opt A | `claim_submissions`, `claim_submission_events`, `payer_remittance_files`, `revenue_allocations` | Extend `invoices.status` with `closed` | |
| 2J opt B | `claim_status_snapshots`, `revenue_allocations` | Same enum extend | |
| 2K | (none) | `patient_journey_status` VIEW | Compute-only |

## 17. Items Not Implemented

- Global Plexus patient identity (proposed v3).
- Plexus ID (proposed v3).
- Clinic membership relationship table (proposed v3).
- Plexus-only identity review queue (proposed v3).
- Plexus-only merge audit (proposed v3).
- Plexus ID alias table (proposed v3).
- Central identity resolver service.
- Ancillary designation derivation.
- Canonical per-service ancillary case (proposed v3).
- Service-specific Admin Review history (proposed v3).
- Canonical appointment enforcement (partial — table exists; constraints not enforced).
- Split note reconciliation (proposed v3).
- Note generator service.
- Billing document generator service.
- Claims submission (product decision required).
- Revenue allocation computation.
- Journey completion aggregate.
- Clinician Portal LinkedDocumentsPanel live data.
- Amendment chain on notes / reports.
- Reschedule lineage on appointments.

## 18. Verification Appendix

Every conclusion in this document is anchored to a file:line citation at commit `2aaa23b`.

### Ingestion
- `server/routes/batches.ts:49-718`
- `server/routes/plexusIqClinicalImport.ts:263-543`
- `server/routes/patientDirectory.ts:191-433`
- `server/routes/testHistory.ts:24-83`
- `server/routes/appointments.ts:25-89`
- `server/services/patientCommitService.ts:71-233`

### Identity (today — clinic-scoped, no global)
- `shared/schema/screening.ts:46-106`
- `server/modules/patient-directory/repo.ts:3-232` (unwired name+dob grouping within-tenant)
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
