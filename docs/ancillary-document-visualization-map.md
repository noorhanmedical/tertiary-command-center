# Ancillary Document Visualization Map — v3.1

**Purpose:** Identify exactly where every artifact and state in the patient journey is **created**, **stored**, **read**, and **displayed** across the entire platform, and identify the projection anchors that each surface must consume.

**Companion to:** `docs/full-patient-journey-platform-audit.md` (v3.1) and `docs/minimal-patient-journey-wiring-plan.md` (v3.1).

**Repository:** noorhanmedical/tertiary-command-center @ `2aaa23b` (branch: `audit/full-patient-journey-platform`).

**Status:** Proposed v3.1 architecture — awaiting final owner approval. Nothing in this document is implemented.

**Revision v3.1:**
- Canonical ancillary appointment event types are ONLY `ancillary_appointment` and `same_day_add`. `doctor_visit` is **excluded** — it does not link to `patient_ancillary_cases` and does not satisfy Order Note scheduling eligibility.
- Consent classification is now service-specific and configurable (see audit §4B). No blanket "soft warning" default.
- `documents.kind='billing_document'` is a **proposed additive** kind for Phase 2G. Not currently available. Every consumer of `DOCUMENT_KINDS` must accept the new value before the generator is enabled.
- Order Note signature requirement remains an unresolved product decision.

**Revision v3 (retained):**

- Patient identity is now a **Plexus-central** function. Every clinic-facing surface reads clinic-owned data via `patient_clinic_memberships` and never touches `global_plexus_patients` directly.
- `patient_ancillary_cases` (v3 proposal) anchors every per-service artifact. It links to `global_plexus_patient_id`, `patient_clinic_membership_id`, `clinic_id`, and includes `episode_sequence` for repeat services.
- Canonical appointment ownership is `global_schedule_events.ancillary_case_id`; the ancillary_case row does not carry `canonical_appointment_id`. Query canonical schedule events to resolve the active appointment.
- Plexus ancillary designation is a **derived** flag from completed cases + procedure events; never manually typed.
- New Plexus-only surfaces added: identity registry (`global_plexus_patients`), match candidate queue, merge audit, Plexus ID alias table.
- Corrected auth statement for `/api/generated-notes`: route is authenticated globally; not clinic-scoped.

## Reading Model

- **Canonical source** = the row-of-truth. Every read should ultimately trace here.
- **Projection** = a view that references canonical IDs; not a competing copy.
- **Missing** = the surface should read from canonical but doesn't.
- **Duplicate path** = a competing write or read that must be reconciled.

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Reads from canonical source |
| ⚠️ | Reads from a projection (indirect but consistent) |
| ❌ | Missing surface — does not display this artifact today |
| 🟠 | Reads from legacy / competing source |
| 🎭 | Displays mock or empty static data |
| 🚫 | Surface / route does not exist |
| PLX | Plexus-internal only (not visible to clinic users) |
| N/A | Not applicable to this surface |

## Canonical Anchor Cheat Sheet (v3)

| Artifact class | Canonical anchor (v3 target) | Visible to clinic user | Visible to authorized Plexus user |
|----------------|------------------------------|:----------------------:|:---------------------------------:|
| Global patient identity | `global_plexus_patients.id` + `.plexus_id` | ⚠️ own membership only | ✅ |
| Clinic membership | `patient_clinic_memberships.id` | ✅ own clinic only | ✅ |
| External identifier | `patient_external_identifiers.id` | ⚠️ own-clinic identifiers only; sensitive ones Plexus-only | ✅ |
| Match candidate | `patient_identity_match_candidates.id` | ❌ | ✅ PLX |
| Merge event | `patient_identity_merge_events.id` | ❌ | ✅ PLX |
| Plexus ID alias | `plexus_id_aliases.alias_plexus_id` | ⚠️ alias lookup returns the surviving global only through the caller's own clinic membership | ✅ |
| Screening | `patient_screenings.id`; v3 adds `patient_clinic_membership_id` FK | ✅ own clinic only | ✅ |
| Engagement/outreach container | `patient_execution_cases.id` | ✅ | ✅ |
| Per-service ancillary case | `patient_ancillary_cases.id` (v3) | ✅ own clinic only | ✅ |
| Ancillary designation | Derived from `patient_ancillary_cases` + `procedure_events`; materialized on `global_plexus_patients` | ⚠️ only "has prior Plexus ancillary" boolean flag; prior clinic chart NEVER visible | ✅ full history |
| Admin Review event | `ancillary_case_admin_review_events.id` (v3, append-only) + projection `patient_ancillary_cases.admin_review_status` | ✅ own clinic only | ✅ |
| Appointment (canonical ancillary) | `global_schedule_events.id` where **event_type ∈ (`ancillary_appointment`, `same_day_add`) ONLY** + `ancillary_case_id` link + `service_type` required. `doctor_visit` is NOT part of ancillary eligibility. | ✅ own clinic only | ✅ |
| Order Note | `procedure_notes.id` (`noteType='order_note'`) + v3 `notes_lineage_id`; anchored to `procedure_notes.ancillary_case_id` | ✅ | ✅ |
| Procedure event | `procedure_events.id`; v3 anchor `procedure_events.ancillary_case_id` | ✅ | ✅ |
| Report | `documents.id` (`kind='report'`); v3 anchor `documents.ancillary_case_id`; version via `supersededByDocumentId` | ✅ | ✅ |
| Procedure Note | `procedure_notes.id` (`noteType='post_procedure_note'`) + v3 `notes_lineage_id` | ✅ | ✅ |
| Signature | `procedure_notes.signatureStatus` / `.signedAt` / `.signedByUserId` | ✅ | ✅ |
| Billing readiness | `billing_readiness_checks.id`; v3 anchor `.ancillary_case_id` | ✅ | ✅ |
| Billing document request | `billing_document_requests.id`; v3 anchor `.ancillary_case_id` | ✅ | ✅ |
| Billing document (generated file) | `documents.id` (`kind='billing_document'`) — v3; linked from `billing_document_requests.generatedDocumentId` FK | ✅ | ✅ |
| Claim | Not implemented | ❌ | ❌ |
| Payment / Adjustment / Denial / Remittance | `invoice_payments.id` / `invoice_adjustments.id` / `invoice_denials.id` / `remittance_events.id` | ✅ | ✅ |
| Invoice | `invoices.id` + `invoices.invoiceNumber` | ✅ | ✅ |
| Journey completion | `patient_ancillary_cases.clinically_completed_at` + `.financially_completed_at` (v3) + view `patient_journey_status` (v3) | ✅ | ✅ |

## Artifact & State Table

Each row shows: canonical source, canonical table, canonical ID, created by, editable/approvable/signable by, versioned, per-surface visibility, missing visualization, duplicate paths, mock/live status, verified repository path.

### Global Plexus Patient (v3 target)

| Field | Value |
|---|---|
| Canonical source of truth | `global_plexus_patients` row (v3 proposal) |
| Canonical table | `global_plexus_patients` |
| Canonical ID | serial int `id` (DB PK) + opaque `plexus_id` text (platform-wide public identifier) |
| Globally unique or clinic-scoped | Globally unique |
| Created by | Plexus resolver (outcome A reuses; outcome C creates) |
| Editable by | Authorized Plexus identity users only |
| Approvable / Signable by | N/A |
| Versioned | Merge lineage via `merged_into_patient_id`; append-only merge history in `patient_identity_merge_events` |
| Patient EHR | ⚠️ visible only via the clinic's membership projection; global row NOT surfaced directly |
| Plexus IQ | ⚠️ same rule |
| Admin Review | ⚠️ same rule |
| Engagement Center | ⚠️ |
| PCS Portal | ⚠️ |
| ACS Portal | ⚠️ |
| Global Calendar | ⚠️ |
| Ancillary Documents | ⚠️ |
| Clinician Portal | ⚠️ |
| Imaging Central | ⚠️ |
| Finance | ⚠️ |
| Billing workspace | ⚠️ |
| Document Library | ⚠️ |
| Plexus Bank | 🎭 mock |
| Plexus Identity Console (new Plexus-only surface, v3) | ✅ PLX — the only surface that displays a global row directly |
| Clinic Analytics | 🚫 |
| Mission Control | ⚠️ (aggregate counts only; scoped by clinic) |
| Patient timeline | ⚠️ via membership |
| Missing visualization | None material for clinic surfaces; Plexus Identity Console (v3 proposal) is missing |
| Duplicate visualization path | Today: no global identity exists; per-clinic `patient_screenings` rows are the closest thing |
| Mock/live status | v3 proposal; nothing exists today |
| Verified repository path | — (proposal only) |

### Plexus ID (v3 target)

| Field | Value |
|---|---|
| Canonical source of truth | text column on `global_plexus_patients.plexus_id` (unique, immutable, opaque) |
| Format | Suggested `PLX-` + ULID-derived or secure random; non-PHI; not sequential; not derived from name/DOB/clinic/diagnosis |
| Globally unique | Yes |
| Created by | Plexus resolver on outcome C (new global patient) |
| Editable by | Nobody after assignment; only aliases can be created via merges |
| Merge behavior | Merged Plexus ID is preserved as `plexus_id_aliases.alias_plexus_id`; alias search resolves to surviving global |
| Patient EHR / clinic surfaces | ⚠️ rendered where the clinic's own membership row surfaces the identifier |
| Plexus Identity Console | ✅ PLX |
| Verified | — |

### Clinic Membership (v3 target)

| Field | Value |
|---|---|
| Canonical source | `patient_clinic_memberships` row |
| Canonical ID | serial int PK |
| Scope | Clinic-scoped — one active per (global_plexus_patient_id, clinic_id) |
| Created by | Clinic import path → Plexus resolver → membership creation |
| Editable by | Clinic (own clinic) — demographics update goes on the membership OR on the global row depending on the field (product decision) |
| Merge behavior | On merge, memberships from the merged global follow the surviving global |
| Every clinic surface | ✅ (own clinic only) |
| Plexus Identity Console | ✅ PLX |
| Verified | — |

### Clinic MRN

| Field | Value |
|---|---|
| Canonical source | `patient_clinic_memberships.clinic_mrn` + row in `patient_external_identifiers` |
| Scope | Clinic-scoped |
| Created by | Clinic import supplies |
| Every clinic surface | ✅ (own clinic only) — the MRN is the clinic's own identifier |
| Verified | — |

### External Identifier (v3 target)

| Field | Value |
|---|---|
| Canonical source | `patient_external_identifiers` row |
| Types | clinic_mrn, ehr_patient_id, payer_member_id, medicare_identifier, external_import_id, prior_plexus_id_alias |
| Storage | Sensitive values encrypted; normalized hash for lookup |
| Every clinic surface | ⚠️ own-clinic identifiers visible; cross-clinic identifiers Plexus-only |
| Plexus Identity Console | ✅ PLX |
| Verified | — |

### Screening

| Field | Value |
|---|---|
| Canonical source | `patient_screenings` row (exists today) |
| Canonical ID | serial int PK |
| Anchor today | `patient_screenings.clinic_id`; v3 adds `patient_screenings.patient_clinic_membership_id` FK |
| Every clinic surface | Patient EHR ✅, Plexus IQ ✅, Admin Review ✅, Engagement Center ⚠️, PCS ⚠️, ACS ⚠️, Global Calendar ⚠️, Ancillary Documents ⚠️, Clinician Portal ⚠️, Imaging Central ⚠️, Document Library ⚠️, Finance ❌, Billing ⚠️, Plexus Bank 🎭, Mission Control ✅ (backlog counts) |
| Verified | `shared/schema/screening.ts:46-106` |

### Qualification (Plexus IQ result)

| Field | Value |
|---|---|
| Canonical source | `patient_screenings.qualifyingTests` + `.reasoning` (jsonb) |
| Anchor v3 | Same; per-service data lives on `patient_ancillary_cases` |
| Every clinic surface | Patient EHR ✅, Plexus IQ ✅, Admin Review ✅, Engagement Center ✅, PCS ⚠️, ACS ⚠️, others ❌ |
| Verified | `shared/schema/screening.ts:70`; `server/services/batchAnalysisRunner.ts:714-728` (reasoning-preservation defect) |

### Clinical Reasoning

| Field | Value |
|---|---|
| Canonical source | `patient_screenings.reasoning` jsonb per test |
| Verified | `shared/schema/screening.ts:131-144`; `shared/plexus-iq/adminReviewEvidence.ts:667-985` |

### Cooldown

| Field | Value |
|---|---|
| Canonical source | `cooldown_records` row |
| Anchor today | `patientScreeningId` + `serviceType`; v3: `ancillary_case_id` |
| Verified | `shared/schema/cooldown.ts:26-54` |

### Insurance Eligibility

| Field | Value |
|---|---|
| Canonical source | `insurance_eligibility_reviews` row |
| Anchor today | `patientScreeningId` + `serviceType`; v3: `ancillary_case_id` |
| Verified | `shared/schema/insuranceEligibility.ts:19-64` |

### Admin Review (v3 — service-specific append-only history)

| Field | Value |
|---|---|
| Canonical source (today) | `patient_screenings.adminApprovalStatus` + `.adminApprovedAt` + `.adminApprovedByUserId` + `.adminApprovalNote` |
| Canonical source (v3 target) | `ancillary_case_admin_review_events` (append-only) + `patient_ancillary_cases.admin_review_status` (projection) |
| Screening-level row (today) | Remains as **compatibility projection** in v3 — derived from per-service events |
| Anchor | v3: `patient_ancillary_cases.id` |
| Created by | POST /api/patient-screenings/:id/admin-approval today; new per-service endpoint (v3) |
| Timestamps | `actual_reviewed_at = now()` — **never backdated**; optional `effective_clinical_date` |
| Every clinic surface | Patient EHR ✅ own clinic only, Plexus IQ ✅, Admin Review ✅ (this is where it happens), Engagement Center ⚠️, PCS ⚠️, ACS ⚠️, Physician Portal ❌ (missing — approval history should surface here) |
| Verified | `shared/schema/screening.ts:88-93,108-114`; `server/routes/patients.ts:662-865` |

### Engagement Case

| Field | Value |
|---|---|
| Canonical source | `patient_execution_cases` (engagement/outreach container per screening) |
| Note (v3) | Execution case is NOT the ancillary case. `patient_ancillary_cases` is the per-service canonical; execution case is the engagement grouping and may reference multiple ancillary cases |
| Verified | `shared/schema/executionCase.ts:30-62`; `server/repositories/executionCase.repo.ts:168-172` |

### Per-Service Ancillary Case (v3 target)

| Field | Value |
|---|---|
| Canonical source | `patient_ancillary_cases` row — one per (global_plexus_patient, clinic, service, episode) |
| Canonical ID | serial int PK |
| Anchor | `global_plexus_patient_id`, `patient_clinic_membership_id`, `clinic_id`, `service_type`, `episode_sequence` |
| Uniqueness | Partial unique on `(global_plexus_patient_id, clinic_id, service_type)` WHERE lifecycle_status IN ('new','active','on_hold'). Closed cases remain; repeated services get incremented episode_sequence. |
| Every clinic surface (v3 target) | Patient EHR ✅, Plexus IQ ✅, Admin Review ✅, Engagement Center ✅, PCS ✅, ACS ✅, Global Calendar ⚠️, Ancillary Documents ✅, Clinician Portal ✅, Imaging Central ⚠️, Finance ⚠️, Billing workspace ✅, Document Library ⚠️ |
| Note | This row does not exist today. Every per-service artifact currently keys on `(patient_screening_id, service_type)`. |
| Verified | — (v3 proposal) |

### Call Outcome

| Field | Value |
|---|---|
| Canonical source | `outreach_calls` row + derived `patient_screenings.appointmentStatus` |
| Verified | `shared/schema/outreach.ts:35-60`; two writers today: `server/routes/outreach.ts:200-352` and `server/routes/executionCases.ts:158-189` |

### Appointment (v3.1 — canonical via global_schedule_events with constraints)

| Field | Value |
|---|---|
| Canonical source (today) | **Fragmented** — no single truth |
| Canonical source (v3.1 target) | `global_schedule_events` where **event_type ∈ (`ancillary_appointment`, `same_day_add`) ONLY** AND row links `ancillary_case_id` + `service_type` + one active per case + reschedule lineage + cancellation/no-show reasons preserved. `doctor_visit` is EXCLUDED from ancillary eligibility — a generic doctor visit does not link to `patient_ancillary_cases` and does not satisfy Order Note scheduling eligibility. |
| Anchor (v3.1) | `global_schedule_events.id`; the ancillary_case row does NOT carry `canonical_appointment_id`. Resolve active canonical ancillary appointment by querying schedule events filtered to `event_type IN ('ancillary_appointment','same_day_add')`. |
| Partial unique index | `UNIQUE (ancillary_case_id) WHERE event_type IN ('ancillary_appointment','same_day_add') AND status = 'scheduled'` — one active canonical ancillary appointment per case. `doctor_visit` rows are NOT subject to this index. |
| Every clinic surface | Patient EHR ⚠️, Engagement Center ✅, PCS ✅, ACS ✅, Global Calendar ✅ (renders every event type), Ancillary Documents ❌ (missing — should show ancillary-only appointment link on each doc row), Clinician Portal ⚠️, Imaging Central ⚠️, Finance ❌, Billing workspace ❌ |
| Duplicate paths | `ancillary_appointments`, `patient_screenings.appointmentStatus`, `patient_execution_cases.engagementStatus` — all become projections in v3 |
| Verified | `shared/schema/globalSchedule.ts:47-77` (existing eventType list still includes `doctor_visit` for general clinic visits, which is correct — the v3.1 restriction is on which event types satisfy ancillary eligibility, not on which event types the enum permits); `shared/schema/appointments.ts:5-30`; `server/routes/globalSchedule.ts:281-378` |

### Consent, Screening Form

| Field | Value |
|---|---|
| Canonical source | `documents` (kind='informed_consent' / 'screening_form') + `case_document_readiness` |
| Anchor today | `documents.patientScreeningId`; v3.1: also `documents.ancillary_case_id` when applicable |
| Blocker classification (v3.1) | **Service-specific and configurable, NOT blanket-soft.** Consent may be a hard procedure blocker for some ancillary services (legally / clinically required) and a soft operational warning for others. Governed by ancillary service configuration (see audit §4B). Never hardcoded globally. Override permissions per role and per requirement. Some requirements are non-overrideable. |
| Every clinic surface | Patient EHR ✅, Engagement Center ✅, PCS ⚠️, ACS ✅, Ancillary Documents 🟠 (legacy `/api/generated-notes`), Clinician Portal 🎭 (LinkedDocumentsPanel=[]), Document Library ✅ |
| Verified | `shared/schema/documents.ts:97-149`; `server/routes/documentLibrary.ts:89-438` |

### Order Note (v3 — reconcileOrderNoteEligibility)

| Field | Value |
|---|---|
| Canonical source | `procedure_notes` with `noteType='order_note'` |
| Anchor (today) | `procedure_notes.id` + `(patientScreeningId, serviceType, noteType)` unique |
| Anchor (v3) | `procedure_notes.ancillary_case_id` + `notes_lineage_id` |
| Trigger (v3) | `reconcileOrderNoteEligibility(ancillary_case_id)` — idempotent; gated on (admin_review_status='approved' AND canonical appointment scheduled). Order Note must exist BEFORE the procedure workflow when preconditions are met. |
| Every clinic surface | Patient EHR ✅, Engagement Center ✅, PCS ⚠️, ACS ✅, Ancillary Documents 🟠 (legacy read), Clinician Portal 🎭, Document Library ⚠️ |
| Verified | `shared/schema/generatedNotes.ts:11-65`; `server/repositories/generatedNotes.repo.ts:82-132` |

### Procedure Event

| Field | Value |
|---|---|
| Canonical source | `procedure_events` row |
| Anchor v3 | `procedure_events.ancillary_case_id` |
| Statuses today | `not_started, in_progress, complete, cancelled, no_show, reschedule_needed` — only `complete` reachable |
| Every clinic surface | Patient EHR ✅, ACS ✅ (primary), Global Calendar ✅ (mirror event), Imaging Central ✅, others ⚠️ |
| Verified | `shared/schema/procedureEvents.ts:11-46`; `server/routes/procedureEvents.ts:56-82` |

### Report (documents kind='report')

| Field | Value |
|---|---|
| Canonical source | `documents` row + `document_blobs` + `document_surface_assignments` |
| Anchor v3 | `documents.ancillary_case_id` (additive) |
| Duplicate paths | Legacy `uploaded_documents` first-read migration uses exact-name matching (`server/routes/documentLibrary.ts:104`) |
| Every clinic surface | Patient EHR ✅, Engagement Center ✅ (readiness lane), PCS ⚠️, ACS ✅, Ancillary Documents 🟠 (legacy read), Clinician Portal 🎭, Imaging Central ✅, Document Library ✅, Billing workspace ⚠️ |
| Verified | `shared/schema/documents.ts:31-149`; `server/routes/documentLibrary.ts:89-438` |

### Procedure Note (v3 — reconcileProcedureNoteEligibility)

| Field | Value |
|---|---|
| Canonical source | `procedure_notes` with `noteType='post_procedure_note'` |
| Anchor v3 | `procedure_notes.ancillary_case_id` + `notes_lineage_id` |
| Trigger (v3) | `reconcileProcedureNoteEligibility(ancillary_case_id)` — idempotent; gated on (procedure complete AND canonical report available) |
| Every clinic surface | Patient EHR ✅, Engagement Center ✅, ACS ✅, Ancillary Documents 🟠, Clinician Portal 🎭 (LinkedDocumentsPanel empty) + ✅ (signature worklist real), Imaging Central ⚠️ |
| Verified | `server/services/physicianPortal/signatureRules.ts:76-144` |

### Signature

| Field | Value |
|---|---|
| Canonical source | `procedure_notes.signatureStatus` + `signedAt` + `signedByUserId` + `returnReason` |
| Verified | `shared/schema/generatedNotes.ts:27-33,50-52`; `server/services/physicianPortal/signatureWorkflow.ts:93-117` |

### Billing Readiness

| Field | Value |
|---|---|
| Canonical source | `billing_readiness_checks` row |
| Anchor v3 | `billing_readiness_checks.ancillary_case_id` |
| Verified | `shared/schema/billingReadiness.ts:10-42`; `server/repositories/billingReadiness.repo.ts:94-179` |

### Billing Document Request

| Field | Value |
|---|---|
| Canonical source | `billing_document_requests` row |
| Anchor v3 | `billing_document_requests.ancillary_case_id`; `generatedDocumentId` → FK to `documents.id` |
| Every clinic surface | Patient EHR ✅, Finance ⚠️, Billing workspace ✅, Ancillary Documents 🟠 (legacy generated_notes docKind='billing'), Clinician Portal 🎭, Plexus Bank 🎭 |
| Verified | `shared/schema/billingDocuments.ts:11-46` |

### Generated Billing Document (file)

| Field | Value |
|---|---|
| Canonical source (v3.1 target) | `documents` row with `kind='billing_document'` linked from `billing_document_requests.generatedDocumentId` FK. **`billing_document` is NOT currently a member of `DOCUMENT_KINDS`** at `shared/schema/documents.ts` — it is a **proposed additive document kind to be introduced in Phase 2G**. Every consumer of `DOCUMENT_KINDS` (shared constant, TypeScript type, Zod validation, insert/update validation, route validation, labels, filters, Document Library display mapping, Ancillary Documents mapping, Patient EHR mapping, Finance/Billing mapping, allowed surface assignments, unit tests, integration tests, E2E assertions) must accept `billing_document` before the generator is enabled. |
| Today | Not implemented — orphan int column, and `billing_document` is not a valid DOCUMENT_KIND value. |
| Verified | `shared/schema/billingDocuments.ts:33`; `shared/schema/documents.ts` DOCUMENT_KINDS declaration |

### Claim / Claim Status / Denial

| Field | Value |
|---|---|
| Claim canonical source | Not implemented |
| Denial canonical source | `invoice_denials` (implemented for the denial workflow) |
| Verified | `shared/schema/invoiceFinancialEvents.ts:39-55` |

### Remittance / Payment / Adjustment

All wired. See audit §5.13, §5.14.

### Invoice

| Field | Value |
|---|---|
| Canonical source | `invoices` row |
| Every clinic surface | Patient EHR ⚠️, Finance ✅, Billing workspace ✅, Clinician Portal 🎭, Plexus Bank 🎭, Mission Control ⚠️ (finance sourceMissing:true deliberately) |
| Verified | `shared/schema/invoices.ts:9-121` |

### Revenue Allocation

| Field | Value |
|---|---|
| Canonical source | Not implemented as compute |
| Schema hints only | `projectedInvoices.projectedOurPortionPercentage` (default `"50"`), `invoice_batch_items.revenueSplit` (jsonb) |
| Product decision | Required (audit §15) |
| Verified | `shared/schema/projectedInvoices.ts:34`; `shared/schema/invoiceBatches.ts:72` |

### Ancillary Designation (v3 derived)

| Field | Value |
|---|---|
| Canonical source | Derived from `patient_ancillary_cases` + `procedure_events` completion; materialized onto `global_plexus_patients` |
| Derived fields | `has_plexus_ancillary_history` bool, `ancillary_case_count` int, `completed_ancillary_case_count` int, `ancillary_services_completed` text[], `first_ancillary_completed_at` timestamptz, `most_recent_ancillary_completed_at` timestamptz |
| Every clinic surface | ⚠️ clinic sees only "has prior Plexus ancillary" boolean flag; prior clinic chart NEVER visible |
| Plexus Identity Console | ✅ PLX full history |
| Rule | Never manually typed onto the patient |

### Match Candidate (v3 Plexus-only)

| Field | Value |
|---|---|
| Canonical source | `patient_identity_match_candidates` row |
| Access | Plexus-central authorized identity users only |
| Every clinic surface | ❌ never |
| Plexus Identity Console | ✅ PLX |
| Rule | Clinic user cannot see, review, or respond to a candidate; clinic workflow continues normally while the candidate is pending |

### Merge Event (v3 Plexus-only)

| Field | Value |
|---|---|
| Canonical source | `patient_identity_merge_events` row (append-only) |
| Access | Plexus-central only |
| Every clinic surface | ❌ |
| Plexus Identity Console | ✅ PLX |

### Plexus ID Alias (v3)

| Field | Value |
|---|---|
| Canonical source | `plexus_id_aliases` row (alias_plexus_id → surviving global) |
| Rule | Old Plexus IDs remain searchable; never reused |
| Every clinic surface | ⚠️ alias search returns surviving global only via the caller's own clinic membership; no cross-clinic reveal |
| Plexus Identity Console | ✅ PLX |

## Summary Findings

### Honest and canonical surfaces (today)

Patient EHR, Plexus IQ (Admin Review), Engagement Center, Global Calendar, Billing Readiness page, Finance page, Document Library, Mission Control (its own scope).

### Broken visualization surfaces

1. **Ancillary Documents (`/ancillary-documents`)** — reads legacy `/api/generated-notes` while writes go to `procedure_notes`.
2. **Clinician Portal Orders & Notes → LinkedDocumentsPanel** — reads empty mock (`DOCUMENTS = []`). Renders "no linked documents" permanently.
3. **Plexus Bank** — 100% client-side mock, publicly routable.
4. **Claims / Payments / Invoices in Clinician Portal Finance page** — types-only; no live data.
5. **Journey completion nowhere** — no single roll-up.

### Missing Plexus-only surface (v3 proposal)

- **Plexus Identity Console** — a Plexus-central surface (not accessible to clinics) that renders `global_plexus_patients`, `patient_identity_match_candidates`, `patient_identity_merge_events`, `plexus_id_aliases`. Missing today.

### Missing visualization on Physician Portal

- Per-service Admin Review approval history should surface on the physician surface; today only the screening-level status is available.

### Recommended source-of-truth principle (proposed v3 — awaiting owner approval)

- Patient Directory / Patient EHR = authoritative longitudinal visualization anchored on `patient_clinic_memberships` (never directly on `global_plexus_patients`).
- Ancillary Documents = global operational projection reading canonical `procedure_notes` (order + procedure notes) + `documents` (reports + billing docs) + `case_document_readiness` + `billing_document_requests`.
- Clinician Portal = role-specific clinical review and signature projection.
- PCS Portal = role-specific outreach, scheduling, and readiness projection.
- ACS Portal = role-specific execution, report, and readiness projection.
- Document Library = administrative file and version repository.
- Finance / Billing = role-specific financial workflow projections.
- **Plexus Identity Console** = Plexus-only surface for identity registry, match candidates, merge audit, aliases.

**Every projection must reference canonical source IDs.** No independent copies for display. Clinic surfaces join through `patient_clinic_memberships` and never expose a `global_plexus_patients` row directly.

### Current violations (all documented above)

- `ancillary_appointments` copies patient linkage without linking to `global_schedule_events`.
- `patient_screenings.appointmentStatus` is a mutable projection derived from outreach calls without a link back to any canonical appointment row.
- Legacy `uploaded_documents` migrates into `documents` via name-based fallback rather than ID.
- Legacy `/api/generated-notes` is read by `/ancillary-documents` while writes go to `procedure_notes`.
- Clinician `LinkedDocumentsPanel` renders empty mock.
- `billing_document_requests.generatedDocumentId` has no FK — the generated file is never linked back to the request.
- No global Plexus patient identity exists today; every clinic is an island.
- No Plexus-only identity console exists.

### Corrected statement on `/api/generated-notes`

The route is authenticated globally by `app.use("/api", requireAuth)` at `server/routes.ts:239`, mounted before `registerGeneratedNotesRoutes(app)` at line 270. It is NOT unauthenticated. Its real defects are: (a) not clinic-scoped in the handler, (b) legacy read path from `generated_notes` table, (c) architecturally unsafe as the display path on `/ancillary-documents` while writes go to `procedure_notes`.

### v3.1 additions summary

- **Ancillary appointment event type restriction:** only `ancillary_appointment` and `same_day_add` may represent a canonical appointment for `patient_ancillary_cases`. `doctor_visit` is excluded. The partial unique index for one active canonical appointment per case applies only to those two event types. Order Note scheduling eligibility considers only these.
- **Configurable consent/blocker classification:** consent is NOT a blanket soft warning. Each ancillary service's configuration determines whether consent is required, which document(s), when, whether it blocks scheduling / check-in / procedure start / billing, which roles may override, and which requirements are non-overrideable.
- **`billing_document` document kind:** proposed additive for Phase 2G, NOT currently in `DOCUMENT_KINDS`. Every consumer of the shared document contract must accept the new value before the generator is enabled.
- **Order Note signature requirement:** unresolved product decision. Four sub-questions must be answered together (see audit §15.5). The full E2E does not unconditionally require a signed Order Note.
