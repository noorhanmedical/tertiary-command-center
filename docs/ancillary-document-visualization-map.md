# Ancillary Document Visualization Map — v2

**Purpose:** Identify exactly where every artifact and state in the patient journey is **created**, **stored**, **read**, and **displayed** across the entire platform, and identify the projection anchors that each surface must consume.

**Companion to:** `docs/full-patient-journey-platform-audit.md` (v2) and `docs/minimal-patient-journey-wiring-plan.md` (v2).

**Repository:** noorhanmedical/tertiary-command-center @ `2aaa23b` (branch: `audit/full-patient-journey-platform`).

**Revision v2:** Canonical anchor updated to `patient_ancillary_cases.id` for every per-service artifact. Screening-level Admin Review row treated as a compatibility projection. Corrected auth statement for `/api/generated-notes` — the route is authenticated globally but not clinic-scoped.

## Reading Model

- **Canonical source** = the row-of-truth. Every read should ultimately trace here.
- **Projection** = a view that references canonical IDs; not a competing copy.
- **Missing** = the table/route/component that should read from canonical but doesn't.
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
| N/A | Not applicable to this surface |

## Canonical Anchor Cheat Sheet (v2)

| Artifact class | Canonical anchor | Note |
|----------------|------------------|------|
| Patient identity | `canonical_patients.id` (v2 target; today: `patient_screenings.id`) | Model A — clinic-scoped |
| Screening / qualification event | `patient_screenings.id` | Multiple screenings can link to one canonical patient |
| Engagement / outreach container | `patient_execution_cases.id` | One per screening; references multiple ancillary cases |
| **Per-service ancillary case** | `patient_ancillary_cases.id` (v2 target) | One per (canonical patient, clinic, service, episode of care) |
| Admin Review event | `ancillary_case_admin_review_events.id` (v2 target); append-only | `patient_ancillary_cases.admin_review_status` is the projection |
| Appointment | `global_schedule_events.id` where event_type ∈ (ancillary_appointment, same_day_add, doctor_visit) + `ancillary_case_id` link | Only one active canonical appointment per ancillary_case |
| Order Note | `procedure_notes.id` (`noteType='order_note'`) + `notes_lineage_id` (v2) | Anchored to `procedure_notes.ancillary_case_id` (v2) |
| Procedure event | `procedure_events.id` | Anchored to `procedure_events.ancillary_case_id` (v2) |
| Report | `documents.id` (`kind='report'`) + `supersededByDocumentId` chain | Anchored to `documents.ancillary_case_id` (v2 additive) |
| Procedure Note | `procedure_notes.id` (`noteType='post_procedure_note'`) + `notes_lineage_id` (v2) | Anchored to `procedure_notes.ancillary_case_id` (v2) |
| Signature | `procedure_notes.signatureStatus` / `.signedAt` / `.signedByUserId` | Same table anchor |
| Billing readiness | `billing_readiness_checks.id` | Anchored to `billing_readiness_checks.ancillary_case_id` (v2) |
| Billing document request | `billing_document_requests.id` | Anchored to `billing_document_requests.ancillary_case_id` (v2) |
| Billing document (generated file) | `documents.id` (`kind='billing_document'`) — v2 target | Linked from `billing_document_requests.generatedDocumentId` FK (v2) |
| Claim | Not implemented | Product decision required |
| Payment | `invoice_payments.id` | Wired |
| Adjustment | `invoice_adjustments.id` | Wired |
| Denial | `invoice_denials.id` | Wired |
| Remittance | `remittance_events.id` | Wired |
| Invoice | `invoices.id` + `invoices.invoiceNumber` | Wired; missing `closed` state |
| Revenue allocation | Not implemented — projected columns exist as schema-only | Product decision required |
| Journey completion | Aggregate `patient_ancillary_cases.clinically_completed_at` + `.financially_completed_at` (v2) + view `patient_journey_status(patient_screening_id)` (v2) | Not implemented |

## Artifact & State Table

### Patient record

| Field | Value |
|---|---|
| Canonical source of truth (today) | `patient_screenings` row |
| Canonical source of truth (v2 target) | `canonical_patients` row (clinic-scoped Model A) |
| Canonical table | `patient_screenings` today; `canonical_patients` v2 |
| Canonical ID | `patient_screenings.id`; `canonical_patients.id` v2 (serial int) |
| Created by | POST /api/batches, POST /api/plexus-iq/clinical-import, POST /api/patient-directory/import-confirm, POST /api/appointments (stub) |
| Creation trigger | Batch upload / manual / clinical import / patient directory import / appointment stub |
| Editable by | admin (PATCH /api/patients/:id — mutates name/dob/phone/insurance) |
| Approvable by | (screening-level admin approval — see Admin Review row) |
| Signable by | N/A |
| Versioned | Soft-delete only (deletedAt) |
| Patient EHR | ✅ Primary display via encoded roster key resolution |
| Plexus IQ | ✅ |
| Admin Review | ✅ |
| Engagement Center | ⚠️ Via execution_case join |
| PCS Portal | ⚠️ |
| ACS Portal | ⚠️ |
| Global Calendar | ⚠️ Via `global_schedule_events.patientScreeningId` (v2: also ancillary_case_id) |
| Ancillary Documents | ⚠️ Via `documents.patientScreeningId` (legacy path: exact-name matching) |
| Clinician Portal | ⚠️ |
| Imaging Central | ⚠️ |
| Finance | ⚠️ |
| Billing workspace | ⚠️ |
| Document Library | ✅ Direct filter by patientScreeningId |
| Plexus Bank | 🎭 Mock only |
| Clinic Analytics | 🚫 |
| Mission Control | ✅ Aggregate counts |
| Patient timeline | ⚠️ Via patient_journey_events |
| Missing visualization | None material |
| Duplicate visualization path | `server/modules/patient-directory/repo.ts` canonical grouping unwired |
| Mock/live status | LIVE |
| Verified repository path | `shared/schema/screening.ts:46-106`; `server/routes/patients.ts:662-865`; `server/modules/patient-directory/repo.ts:3-232` |

### Screening

| Field | Value |
|---|---|
| Canonical source of truth | `patient_screenings` row (screening event) |
| Anchor | `patient_screenings.id`; v2: `patient_screenings.canonical_patient_id` FK to canonical patient |
| Every surface | Same as Patient record above (screening = identity today) |
| Verified | `shared/schema/screening.ts:46-106` |

### Qualification (Plexus IQ result)

| Field | Value |
|---|---|
| Canonical source of truth | `patient_screenings.qualifyingTests` + `.reasoning` (jsonb) |
| Anchor | `patient_screenings.id`; per-test data lives on `patient_ancillary_cases` (v2) |
| Versioned | No — overwritten on batch re-run (audit §5.2 defect: `preserveAdminReviewReasoning` exists but not called) |
| Patient EHR | ✅ |
| Plexus IQ | ✅ Full display + edit |
| Admin Review | ✅ Full display + evidence assignment |
| Engagement Center | ✅ Reads qualifyingTests |
| PCS Portal | ⚠️ Via execution_case |
| ACS Portal | ⚠️ |
| Global Calendar | ❌ |
| Ancillary Documents | ❌ |
| Clinician Portal | ⚠️ Via physicianPortal summary |
| Imaging Central | ❌ |
| Finance | ❌ |
| Billing workspace | ❌ |
| Document Library | ❌ |
| Plexus Bank | 🎭 |
| Clinic Analytics | 🚫 |
| Mission Control | ✅ Qualification backlog count |
| Patient timeline | ⚠️ |
| Verified | `shared/schema/screening.ts:70`; `server/services/batchAnalysisRunner.ts:714-728` |

### Clinical reasoning

| Field | Value |
|---|---|
| Canonical source of truth | `patient_screenings.reasoning` jsonb (per test) |
| Anchor | `patient_screenings.id`; per-service move to `patient_ancillary_cases` (v2) |
| Versioned | No |
| Patient EHR | ✅ |
| Plexus IQ | ✅ |
| Admin Review | ✅ (evidence chips rebuilt at read-time from Dx/Hx/Rx) |
| Engagement Center | ⚠️ Summary |
| Others | ❌ |
| Verified | `shared/schema/screening.ts:131-144`; `shared/plexus-iq/adminReviewEvidence.ts:667-985` |

### Cooldown

| Field | Value |
|---|---|
| Canonical source of truth | `cooldown_records` row |
| Anchor | `cooldown_records.id`; keys on `patientScreeningId` + `serviceType` today; v2 target: `ancillary_case_id` |
| Every surface | Patient EHR ✅, Plexus IQ ✅, Admin Review ✅, Engagement Center ⚠️, PCS ⚠️, ACS ❌, Global Calendar ❌ |
| Verified | `shared/schema/cooldown.ts:26-54` |

### Insurance eligibility

| Field | Value |
|---|---|
| Canonical source of truth | `insurance_eligibility_reviews` row |
| Anchor | Keys on `patientScreeningId` + `serviceType`; v2 target: `ancillary_case_id` |
| Every surface | Patient EHR ✅, Plexus IQ ✅, Admin Review ✅, Engagement Center ⚠️, PCS ⚠️, ACS ❌, Billing workspace ❌ (missing) |
| Verified | `shared/schema/insuranceEligibility.ts:19-64` |

### Admin Review (v2 — service-specific append-only history)

| Field | Value |
|---|---|
| Canonical source of truth (today) | `patient_screenings.adminApprovalStatus` + `.adminApprovedAt` + `.adminApprovedByUserId` + `.adminApprovalNote` |
| Canonical source of truth (v2 target) | `ancillary_case_admin_review_events` (append-only) + `patient_ancillary_cases.admin_review_status` (projection) |
| Screening-level row (today) | Remains as **compatibility projection** — derived from per-service events once history table is authoritative |
| Anchor | `patient_screenings.id` today; `patient_ancillary_cases.id` v2 |
| Created by | POST /api/patient-screenings/:id/admin-approval (today); new per-service endpoint (v2) |
| Timestamps | `actual_reviewed_at = now()` — **never backdated** |
| Effective clinical date | Optional `effective_clinical_date` — separate from actual review timestamp |
| Editable by | Any authenticated user (product decision — no role gate today) |
| Every surface | Patient EHR ✅, Plexus IQ ✅, Admin Review ✅ (this is where it happens), Engagement Center ⚠️, PCS ⚠️, ACS ⚠️, Physician Portal ❌ (missing — approval history should surface here) |
| Missing visualization | Physician Portal per-service approval history |
| Verified | `shared/schema/screening.ts:88-93,108-114`; `server/routes/patients.ts:662-865` |

### Engagement case (execution case = engagement/outreach container)

| Field | Value |
|---|---|
| Canonical source of truth | `patient_execution_cases` row — engagement/outreach container per screening |
| Anchor | `patient_execution_cases.id`; v2: `patient_execution_cases` may reference multiple `patient_ancillary_cases` |
| Note (v2) | Execution case is NOT the ancillary case anymore. `patient_ancillary_cases` is the per-service canonical; execution case is the engagement grouping |
| Created by | `server/services/patientCommitService.ts::ensureCanonicalSpineForScreening` |
| Editable by | scheduler, admin, liaison |
| Every surface | Patient EHR ⚠️, Engagement Center ✅ (primary), PCS ✅, ACS ✅, Global Calendar ⚠️, Ancillary Documents ❌, Clinician Portal ⚠️, Finance ❌, Billing workspace ❌ |
| Verified | `shared/schema/executionCase.ts:30-62`; `server/repositories/executionCase.repo.ts:168-172` |

### Per-service ancillary case (v2 target)

| Field | Value |
|---|---|
| Canonical source of truth (v2) | `patient_ancillary_cases` row — one per (canonical patient, clinic, service, episode) |
| Canonical ID (v2) | `patient_ancillary_cases.id` (serial int) |
| Exists today? | **No.** Every per-service artifact currently keys on `(patient_screening_id, service_type)`. |
| Anchor conceptual columns | `canonical_patient_id`, `patient_screening_id` (nullable), `execution_case_id` (nullable), `clinic_id`, `service_type`, `lifecycle_status`, `qualification_status`, `admin_review_status`, `canonical_appointment_id`, `clinically_completed_at`, `financially_completed_at` |
| Every surface (target) | Patient EHR ✅ (primary), Plexus IQ ✅, Admin Review ✅, Engagement Center ✅, PCS ✅, ACS ✅, Global Calendar ⚠️, Ancillary Documents ✅, Clinician Portal ✅, Imaging Central ⚠️, Finance ⚠️, Billing workspace ✅, Document Library ⚠️ |
| Verified | See canonical-anchor cheat sheet — this row does not exist today |

### Call outcome

| Field | Value |
|---|---|
| Canonical source of truth | `outreach_calls` row + derived `patient_screenings.appointmentStatus` |
| Anchor | `outreach_calls.id` |
| Verified | `shared/schema/outreach.ts:35-60` |
| Current defect | Two write paths: `/api/outreach/calls` (writes outreach_calls) vs `/api/engagement-center/call-result` (writes journey event only). Consolidation is a Phase 2D+ item. |

### Appointment (v2 — canonical via global_schedule_events with constraints)

| Field | Value |
|---|---|
| Canonical source of truth (today) | **Fragmented** — no single truth |
| Canonical source of truth (v2 target) | `global_schedule_events` row WHEN it links `ancillary_case_id` + `service_type` + one active per case + reschedule lineage + cancellation/no-show reasons preserved |
| Anchor (v2) | `global_schedule_events.id`; `patient_ancillary_cases.canonical_appointment_id` points here |
| Every surface | Patient EHR ⚠️, Plexus IQ ❌, Admin Review ❌, Engagement Center ✅, PCS ✅, ACS ✅, Global Calendar ✅ (primary), Ancillary Documents ❌, Clinician Portal ⚠️, Imaging Central ⚠️, Finance ❌, Billing workspace ❌, Document Library ❌ |
| Missing visualization | Ancillary Documents (should show appointment link on each document row) |
| Duplicate paths | `ancillary_appointments`, `patient_screenings.appointmentStatus`, `patient_execution_cases.engagementStatus` — all become projections in v2 |
| Verified | `shared/schema/globalSchedule.ts:47-77`; `shared/schema/appointments.ts:5-30`; `server/routes/globalSchedule.ts:281-378` |

### Consent, Screening Form (documents kind='informed_consent' / 'screening_form')

| Field | Value |
|---|---|
| Canonical source of truth | `documents` row + `case_document_readiness` row |
| Anchor | `documents.id` + `documents.patientScreeningId`; v2: also `documents.ancillary_case_id` when relevant |
| Version | `documents.supersededByDocumentId` chain |
| Every surface | Patient EHR ✅, Engagement Center ✅ (Document Readiness lane), PCS ⚠️, ACS ✅ (consent picker), Ancillary Documents 🟠 (legacy `/api/generated-notes` read), Clinician Portal 🎭 (LinkedDocumentsPanel=[]), Imaging Central ⚠️, Document Library ✅, Billing workspace ⚠️ |
| Verified | `shared/schema/documents.ts:97-149`; `server/routes/documentLibrary.ts:89-438` |

### Order Note (v2 — reconcileOrderNoteEligibility)

| Field | Value |
|---|---|
| Canonical source of truth | `procedure_notes` row with `noteType='order_note'` |
| Anchor (today) | `procedure_notes.id` + `(patientScreeningId, serviceType, noteType)` unique |
| Anchor (v2 target) | `procedure_notes.ancillary_case_id` + `notes_lineage_id` |
| Created by (today) | Side-effect of `markProcedureComplete` — unconditional, wrong |
| Created by (v2) | `reconcileOrderNoteEligibility(ancillary_case_id)` — idempotent, gated on (admin_review_status='approved' AND canonical appointment scheduled) |
| Signable by | Not required today (KINDS_REQUIRING_SIGNATURE excludes `order_note`); product decision §12.5 |
| Every surface | Patient EHR ✅, Plexus IQ ❌, Admin Review ❌, Engagement Center ✅, PCS ⚠️, ACS ✅, Ancillary Documents 🟠 (legacy read), Clinician Portal 🎭, Imaging Central ⚠️, Finance ❌, Billing workspace ⚠️ (readiness lane), Document Library ⚠️ |
| Missing visualization | Clinician LinkedDocumentsPanel + Ancillary Documents canonical read |
| Verified | `shared/schema/generatedNotes.ts:11-65`; `server/repositories/generatedNotes.repo.ts:82-132` |

### Procedure event

| Field | Value |
|---|---|
| Canonical source of truth | `procedure_events` row |
| Anchor (today) | Keys on `patientScreeningId` + `serviceType`; v2: `procedure_events.ancillary_case_id` |
| Statuses | `not_started, in_progress, complete, cancelled, no_show, reschedule_needed` — only `complete` reachable via route |
| Every surface | Patient EHR ✅, ACS ✅ (primary), Global Calendar ✅ (mirror event), Imaging Central ✅, Engagement Center ⚠️, PCS ⚠️, Ancillary Documents ⚠️, Clinician Portal ⚠️, Finance ⚠️, Billing workspace ⚠️ |
| Verified | `shared/schema/procedureEvents.ts:11-46`; `server/routes/procedureEvents.ts:56-82` |

### Report (documents kind='report')

| Field | Value |
|---|---|
| Canonical source of truth | `documents` row |
| Anchor (today) | `documents.id` + `documents.patientScreeningId`; v2: `documents.ancillary_case_id` for reports |
| Every surface | Patient EHR ✅, Plexus IQ ⚠️, Admin Review ⚠️, Engagement Center ✅, PCS ⚠️, ACS ✅, Global Calendar ❌, Ancillary Documents 🟠 (legacy read), Clinician Portal 🎭, Imaging Central ✅, Document Library ✅, Billing workspace ⚠️ |
| Missing visualization | Clinician LinkedDocumentsPanel canonical read |
| Duplicate paths | Legacy uploaded_documents migration uses exact-name matching (`server/routes/documentLibrary.ts:104`) |
| Verified | `shared/schema/documents.ts:31-149`; `server/routes/documentLibrary.ts:89-438` |

### Procedure Note (v2 — reconcileProcedureNoteEligibility)

| Field | Value |
|---|---|
| Canonical source of truth | `procedure_notes` row with `noteType='post_procedure_note'` |
| Anchor (v2) | `procedure_notes.ancillary_case_id` + `notes_lineage_id` |
| Created by (today) | Side-effect of `markProcedureComplete` — unconditional |
| Created by (v2) | `reconcileProcedureNoteEligibility(ancillary_case_id)` — idempotent, gated on (procedure complete AND canonical report available) |
| Signable by | Physician (KINDS_REQUIRING_SIGNATURE includes `post_procedure_note`); report presence enforced at signature (`server/services/physicianPortal/signatureRules.ts:114-116`) |
| Every surface | Patient EHR ✅, Engagement Center ✅, PCS ⚠️, ACS ✅, Ancillary Documents 🟠, Clinician Portal 🎭 (LinkedDocumentsPanel) + ✅ (signature worklist real), Imaging Central ⚠️, Finance ❌, Billing workspace ⚠️ |
| Missing visualization | Clinician LinkedDocumentsPanel canonical read |
| Verified | `shared/schema/generatedNotes.ts:35-65`; `server/services/physicianPortal/signatureRules.ts:76-144` |

### Signature

| Field | Value |
|---|---|
| Canonical source of truth | `procedure_notes.signatureStatus` + `signedAt` + `signedByUserId` + `returnReason` |
| Anchor | `procedure_notes.id` |
| Every surface | Patient EHR ✅, Engagement Center ✅, PCS ⚠️, ACS ✅, Ancillary Documents 🟠, Clinician Portal ✅ (worklist), Imaging Central ⚠️, Finance ⚠️, Billing workspace ⚠️ |
| Verified | `shared/schema/generatedNotes.ts:27-33,50-52`; `server/services/physicianPortal/signatureWorkflow.ts:93-117` |

### Billing readiness

| Field | Value |
|---|---|
| Canonical source of truth | `billing_readiness_checks` row per (patientScreeningId, serviceType) |
| Anchor (v2) | `billing_readiness_checks.ancillary_case_id` |
| Every surface | Patient EHR ✅, Engagement Center ✅, PCS ⚠️, ACS ✅, Finance ✅, Billing workspace ✅ (primary), Ancillary Documents ❌, Clinician Portal ⚠️, Mission Control ✅ |
| Verified | `shared/schema/billingReadiness.ts:10-42`; `server/repositories/billingReadiness.repo.ts:94-179` |

### Billing Document request

| Field | Value |
|---|---|
| Canonical source of truth | `billing_document_requests` row |
| Anchor (v2) | `billing_document_requests.ancillary_case_id` |
| Fix required | `generatedDocumentId` → FK to `documents.id`; generator service |
| Every surface | Patient EHR ✅, Finance ⚠️, Billing workspace ✅, Ancillary Documents 🟠 (legacy generated_notes docKind='billing'), Clinician Portal 🎭, Plexus Bank 🎭 |
| Verified | `shared/schema/billingDocuments.ts:11-46`; `server/routes/billingDocuments.ts:11-54` |

### Generated Billing Document (file)

| Field | Value |
|---|---|
| Canonical source of truth (v2 target) | `documents` row with `kind='billing_document'` linked from `billing_document_requests.generatedDocumentId` FK |
| Exists today? | No — orphan int column, no writer, no reader |
| Every surface | ❌ everywhere; Plexus Bank 🎭 mock |
| Verified | `shared/schema/billingDocuments.ts:33` |

### Claim / Claim status / Denial

| Field | Value |
|---|---|
| Claim canonical source | Not implemented |
| Denial canonical source | `invoice_denials` row (implemented for the denial workflow) |
| Anchor | `invoice_denials.id`; keys on `invoiceId` + `lineItemId` |
| Every surface (claim) | ❌ everywhere; Plexus Bank 🎭 mock |
| Every surface (denial) | Patient EHR ❌, Finance ✅, Billing workspace ✅, Others ❌ |
| Verified | `shared/schema/invoiceFinancialEvents.ts:39-55` |

### Remittance, Payment, Adjustment

All wired (`invoice_payments`, `invoice_adjustments`, `remittance_events`). Every surface except Finance / Billing shows N/A or ❌. See §5.13, §5.14 in the audit for anchors.

### Invoice

| Field | Value |
|---|---|
| Canonical source | `invoices` row |
| Every surface | Patient EHR ⚠️, Finance ✅ (primary), Billing workspace ✅, Clinician Portal 🎭, Plexus Bank 🎭, Mission Control ⚠️ (finance sourceMissing:true deliberately) |
| Verified | `shared/schema/invoices.ts:9-121` |

### Revenue allocation

Not implemented as compute. Schema hints only (`projectedInvoices.projectedOurPortionPercentage` default `"50"`). Product decision §12.3.

### Journey completion

Not implemented as aggregate. Discrete stages exist on separate tables. `patient_ancillary_cases.clinically_completed_at` and `.financially_completed_at` (v2 target) become the two authoritative timestamps per service; aggregate view `patient_journey_status` (Phase 2K) rolls them up.

## Summary Findings

### Honest and canonical surfaces (today)

Patient EHR, Plexus IQ (Admin Review), Engagement Center, Global Calendar, Billing Readiness page, Finance page, Document Library, Mission Control (its own scope).

### Broken visualization surfaces

1. **Ancillary Documents (`/ancillary-documents`)** — reads legacy `/api/generated-notes` while writes go to `procedure_notes`.
2. **Clinician Portal Orders & Notes → LinkedDocumentsPanel** — reads empty mock (`DOCUMENTS = []`). Renders "no linked documents" permanently.
3. **Plexus Bank** — 100% client-side mock, publicly routable.
4. **Claims / Payments / Invoices in Clinician Portal Finance page** — types-only; no live data.
5. **Journey completion nowhere** — no single roll-up.

### Missing visualization on Physician Portal

- Per-service Admin Review approval history should surface on the physician surface; today only the screening-level status is available.

### Recommended source-of-truth principle (owner-approved)

- Patient Directory / Patient EHR = authoritative longitudinal visualization anchored on `canonical_patients` + `patient_ancillary_cases`.
- Ancillary Documents = global operational projection reading canonical `procedure_notes` (order + procedure notes) + `documents` (reports + billing docs) + `case_document_readiness` + `billing_document_requests`.
- Clinician Portal = role-specific clinical review and signature projection.
- PCS Portal = role-specific outreach, scheduling, and readiness projection.
- ACS Portal = role-specific execution, report, and readiness projection.
- Document Library = administrative file and version repository.
- Finance / Billing = role-specific financial workflow projections.

**Every projection must reference canonical source IDs.** No independent copies for display.

### Current violations (all documented above, with fixes in the wiring plan)

- `ancillary_appointments` copies patient linkage without linking to `global_schedule_events`.
- `patient_screenings.appointmentStatus` is a mutable projection derived from outreach calls without a link back to any canonical appointment row.
- Legacy `uploaded_documents` migrates into `documents` via name-based fallback rather than ID.
- Legacy `/api/generated-notes` is read by `/ancillary-documents` while writes go to `procedure_notes`.
- Clinician `LinkedDocumentsPanel` renders empty mock.
- `billing_document_requests.generatedDocumentId` has no FK — the generated file is never linked back to the request.

### Corrected statement on `/api/generated-notes`

The route is authenticated globally by `app.use("/api", requireAuth)` at `server/routes.ts:239`, mounted before `registerGeneratedNotesRoutes(app)` at line 270. It is NOT unauthenticated. Its real defects are: (a) not clinic-scoped in the handler, (b) legacy read path from `generated_notes` table, (c) architecturally unsafe as the display path on `/ancillary-documents` while writes go to `procedure_notes`.
