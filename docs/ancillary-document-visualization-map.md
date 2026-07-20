# Ancillary Document Visualization Map

**Purpose:** Identify exactly where every artifact and state in the patient journey is **created**, **stored**, **read**, and **displayed** across the entire platform.

**Companion to:** `docs/full-patient-journey-platform-audit.md`

**Repository:** noorhanmedical/tertiary-command-center @ `2aaa23b` (branch: `audit/full-patient-journey-platform`)

**Reading model:**
- **Canonical source** = the row-of-truth. Every read should ultimately trace here.
- **Projection** = a view that MUST reference canonical IDs; not a competing copy.
- **Missing** = the table/route/component that should read from canonical but doesn't.
- **Duplicate path** = a competing write or read that must be reconciled.

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Reads from canonical source |
| ⚠️ | Reads from a projection (indirect) |
| ❌ | Missing surface — does not display this artifact today |
| 🟠 | Reads from legacy / competing source |
| 🎭 | Displays mock or empty static data |
| 🚫 | Route/component does not exist |
| N/A | Not applicable to this surface |

## Artifact & State Table

Columns:
- **Canonical source of truth** — the row that is the single truth
- **Canonical table** — the table name
- **Canonical ID** — the primary identifier
- **Created by** — the endpoint/service that inserts
- **Creation trigger** — the event that fires the write
- **Editable / Approvable / Signable by** — role IDs
- **Versioned** — whether the artifact has a version chain
- **Every UI surface** — one column per major surface
- **Missing visualization** — surfaces where the artifact should appear but doesn't
- **Duplicate visualization path** — parallel projections that read the wrong table
- **Mock/live status** — overall
- **Verified repository path** — the file:line proof

---

### Patient record

| Field | Value |
|---|---|
| Canonical source of truth | patient_screenings row (identity + screening event) |
| Canonical table | `patient_screenings` |
| Canonical ID | `patient_screenings.id` (int serial) |
| Created by | POST /api/batches, POST /api/batches/:id/patients, POST /api/plexus-iq/clinical-import, POST /api/patient-directory/import-confirm (flag), POST /api/appointments (stub) |
| Creation trigger | Batch upload / manual / clinical import / patient directory import / appointment stub |
| Editable by | admin (PATCH /api/patients/:id) — mutates name, dob, phone, insurance |
| Approvable by | any session user (POST /api/patient-screenings/:id/admin-approval) — **no role gate** |
| Signable by | N/A |
| Versioned | No (soft-delete only via deletedAt) |
| Patient EHR | ✅ Primary display via encoded roster key resolution |
| Plexus IQ | ✅ Full CRUD via batch flow |
| Admin Review | ✅ Reads for approval decisions |
| Engagement Center | ⚠️ Reads via execution_case join |
| PCS Portal | ⚠️ Reads via execution_case + outreach |
| ACS Portal | ⚠️ Reads via execution_case + procedure_event |
| Global Calendar | ⚠️ Reads via global_schedule_events.patientScreeningId |
| Ancillary Documents | ⚠️ Reads via document.patientScreeningId (legacy path uses name match) |
| Clinician Portal | ⚠️ Reads via physicianPortal service summary |
| Imaging Central | ⚠️ Reads via patient_screeningId on documents |
| Finance | ⚠️ Reads via invoice.patientScreeningId (when linked) |
| Billing workspace | ⚠️ Reads via billing_readiness_check.patientScreeningId |
| Document Library | ✅ Direct filter by patientScreeningId |
| Plexus Bank | 🎭 Hardcoded mock patient names — no live linkage |
| Clinic Analytics | 🚫 Route does not exist |
| Mission Control | ✅ Aggregate counts by clinic; no per-patient view |
| Patient timeline | ⚠️ Derived from patient_journey_events grouping |
| Missing visualization | None critical |
| Duplicate visualization path | Patient Directory canonical identity (`server/modules/patient-directory/repo.ts`) is unwired |
| Mock/live status | LIVE |
| Verified repository path | `shared/schema/screening.ts:46-106`; `server/routes/patients.ts:662-865`; `server/modules/patient-directory/repo.ts:3-232` |

### Screening

| Field | Value |
|---|---|
| Canonical source of truth | patient_screenings row itself (screening = identity in the same row) |
| Canonical table | `patient_screenings` |
| Canonical ID | `patient_screenings.id` |
| Created by | Same as Patient record |
| Creation trigger | Same |
| Editable by | admin, scheduler, clinician |
| Approvable by | admin (approval separate from screening completion) |
| Signable by | N/A |
| Versioned | No |
| Patient EHR | ✅ Primary display |
| Plexus IQ | ✅ Batch analysis workflow |
| Admin Review | ✅ Approves the screening |
| Engagement Center | ⚠️ Indirect via execution_case |
| PCS Portal | ⚠️ Indirect |
| ACS Portal | ⚠️ Indirect |
| Global Calendar | ⚠️ Indirect via events.patientScreeningId |
| Ancillary Documents | ⚠️ Legacy `/api/generated-notes` reads screening-batch-era notes |
| Clinician Portal | ⚠️ Indirect |
| Imaging Central | ❌ Screening state not shown |
| Finance | ❌ Not shown |
| Billing workspace | ❌ Not shown as a screening; shown as billing_readiness rows |
| Document Library | ⚠️ Indirect via documents.patientScreeningId |
| Plexus Bank | 🎭 Mock |
| Clinic Analytics | 🚫 |
| Mission Control | ✅ Backlog counts |
| Patient timeline | ⚠️ Via journey events |
| Missing visualization | None material |
| Duplicate visualization path | None |
| Mock/live status | LIVE |
| Verified repository path | `shared/schema/screening.ts:46-106` |

### Qualification (Plexus IQ result)

| Field | Value |
|---|---|
| Canonical source of truth | `patient_screenings.qualifyingTests` + `patient_screenings.reasoning` |
| Canonical table | `patient_screenings` |
| Canonical ID | `patient_screenings.id` |
| Created by | `server/services/batchAnalysisRunner.ts` |
| Creation trigger | Batch analysis job |
| Editable by | admin (via Admin Review add/remove ancillary services) |
| Approvable by | admin (approval is separate — adminApprovalStatus) |
| Signable by | N/A |
| Versioned | No — overwritten on batch re-run (bug documented in audit §5.2) |
| Patient EHR | ✅ Shows qualifyingTests + reasoning |
| Plexus IQ | ✅ Full display + edit |
| Admin Review | ✅ Full display + evidence assignment |
| Engagement Center | ✅ Reads qualifyingTests for outreach targeting |
| PCS Portal | ⚠️ Indirect via execution_case |
| ACS Portal | ⚠️ Indirect |
| Global Calendar | ❌ Not shown |
| Ancillary Documents | ❌ Not shown |
| Clinician Portal | ⚠️ Via physicianPortal summary |
| Imaging Central | ❌ Not shown |
| Finance | ❌ Not shown |
| Billing workspace | ❌ Not shown |
| Document Library | ❌ Not shown |
| Plexus Bank | 🎭 Mock |
| Clinic Analytics | 🚫 |
| Mission Control | ✅ qualification backlog count |
| Patient timeline | ⚠️ Via reasoning jsonb display |
| Missing visualization | None critical |
| Duplicate visualization path | None |
| Mock/live status | LIVE. **Reasoning lost on batch re-run** (`preserveAdminReviewReasoning` not wired). |
| Verified repository path | `shared/schema/screening.ts:70`; `server/services/batchAnalysisRunner.ts:714-728` |

### Clinical reasoning

| Field | Value |
|---|---|
| Canonical source of truth | `patient_screenings.reasoning` jsonb per test |
| Canonical table | `patient_screenings` |
| Canonical ID | `patient_screenings.id` + reasoning key (test name) |
| Created by | AI analysis + Admin Review adds |
| Creation trigger | Same as qualification |
| Editable by | admin (via Admin Review), AI (batch re-run) |
| Versioned | No (see qualification defect) |
| Patient EHR | ✅ |
| Plexus IQ | ✅ Full display |
| Admin Review | ✅ Full display; evidence chips rebuilt at read-time from Dx/Hx/Rx |
| Engagement Center | ⚠️ Via reasoning summary |
| Others | ❌ Not shown |
| Missing visualization | None material |
| Duplicate visualization path | None |
| Mock/live status | LIVE (see reasoning-loss bug) |
| Verified repository path | `shared/schema/screening.ts:131-144`; `shared/plexus-iq/adminReviewEvidence.ts:667-985` |

### Cooldown

| Field | Value |
|---|---|
| Canonical source of truth | cooldown_records row |
| Canonical table | `cooldown_records` |
| Canonical ID | `cooldown_records.id` |
| Created by | `server/services/cooldownCanonical.ts` (via execution_case creation + repeated qualification) |
| Creation trigger | Prior service completed within cooldown window |
| Editable by | admin (override) |
| Approvable by | admin (overrideStatus enum: none/pending/approved/denied) |
| Signable by | N/A |
| Versioned | No |
| Patient EHR | ✅ Shows cooldown warnings |
| Plexus IQ | ✅ Blocks qualification when active |
| Admin Review | ✅ Override request lives here |
| Engagement Center | ⚠️ Blocks scheduling |
| PCS Portal | ⚠️ Warns during outreach |
| ACS Portal | ❌ Not surfaced (procedure blocker but no UI warning found) |
| Global Calendar | ❌ Not shown |
| Others | ❌ Not shown |
| Missing visualization | ACS Portal (potential — see billing readiness for consequences) |
| Duplicate visualization path | None |
| Mock/live status | LIVE |
| Verified repository path | `shared/schema/cooldown.ts:26-54` |

### Insurance eligibility

| Field | Value |
|---|---|
| Canonical source of truth | insurance_eligibility_reviews row |
| Canonical table | `insurance_eligibility_reviews` |
| Canonical ID | `insurance_eligibility_reviews.id` |
| Created by | Via execution_case + qualification |
| Creation trigger | Qualification requires eligibility check |
| Editable by | admin (verification result) |
| Approvable by | admin (approvalStatus enum) |
| Signable by | N/A |
| Versioned | No |
| Patient EHR | ✅ Displays eligibility status |
| Plexus IQ | ✅ Blocks qualification when denied |
| Admin Review | ✅ Approval flow lives here |
| Engagement Center | ⚠️ Blocks scheduling handoff |
| PCS Portal | ⚠️ Warns during outreach |
| ACS Portal | ❌ Not surfaced directly |
| Others | ❌ |
| Missing visualization | Billing workspace should surface for pre-billing review |
| Duplicate visualization path | None |
| Mock/live status | LIVE |
| Verified repository path | `shared/schema/insuranceEligibility.ts:19-64` |

### Admin Review

| Field | Value |
|---|---|
| Canonical source of truth | `patient_screenings.adminApprovalStatus` + `adminApprovedAt` + `adminApprovedByUserId` + `adminApprovalNote` (+ reasoning jsonb) |
| Canonical table | `patient_screenings` (approval fields on same row) |
| Canonical ID | `patient_screenings.id` |
| Created by | POST `/api/patient-screenings/:id/admin-approval` (`server/routes/patients.ts:662-865`) |
| Creation trigger | Reviewer clicks Approve / Deny / Needs Info |
| Editable by | Any authenticated user (no role gate) — see audit §5.3 defect |
| Approvable by | Same — Enum: pending/approved/needs_info/rejected |
| Signable by | N/A (no signature — approval is a status) |
| Versioned | No (single row overwrite; journey event captures history) |
| Patient EHR | ✅ Shows approval status |
| Plexus IQ | ✅ Admin Review dialog is here |
| Admin Review | ✅ (this IS the admin review) |
| Engagement Center | ⚠️ Approved patients enter engagement |
| PCS Portal | ⚠️ Reads approval status via execution_case join |
| ACS Portal | ⚠️ Indirect |
| Global Calendar | ❌ Not shown |
| Others | ❌ |
| Missing visualization | Physician Portal (approval history + reasoning) |
| Duplicate visualization path | None |
| Mock/live status | LIVE |
| Verified repository path | `shared/schema/screening.ts:85-115`; `server/routes/patients.ts:662-865` |

### Engagement case

| Field | Value |
|---|---|
| Canonical source of truth | `patient_execution_cases` row |
| Canonical table | `patient_execution_cases` |
| Canonical ID | `patient_execution_cases.id` |
| Created by | `server/services/patientCommitService.ts` (`ensureCanonicalSpineForScreening`) via admin approval or appointment |
| Creation trigger | Admin approval + commit (auto) OR direct scheduling stub |
| Editable by | scheduler, admin, liaison |
| Approvable by | N/A |
| Signable by | N/A |
| Versioned | No |
| Patient EHR | ⚠️ Case shown through execution status |
| Plexus IQ | ❌ Not shown |
| Admin Review | ❌ Not shown |
| Engagement Center | ✅ Primary display; assignment board and baskets |
| PCS Portal | ✅ Primary display |
| ACS Portal | ✅ Primary display |
| Global Calendar | ⚠️ Reads case for context tags |
| Ancillary Documents | ❌ Not shown |
| Clinician Portal | ⚠️ Via physicianPortal summary |
| Imaging Central | ⚠️ Reads case for context |
| Finance | ❌ Not shown |
| Billing workspace | ❌ Not shown |
| Document Library | ❌ Not shown |
| Plexus Bank | 🎭 Mock |
| Clinic Analytics | 🚫 |
| Mission Control | ✅ Active-case count |
| Patient timeline | ⚠️ Via journey events |
| Missing visualization | Finance / Billing (should link case → invoice via patientScreeningId) |
| Duplicate visualization path | `engagement` schema (`shared/schema/engagement.ts`) — verify not competing (Explore found no separate engagement_case table) |
| Mock/live status | LIVE |
| Verified repository path | `shared/schema/executionCase.ts:30-62`; `server/repositories/executionCase.repo.ts:168-172` |

### Call outcome

| Field | Value |
|---|---|
| Canonical source of truth | `outreach_calls` row + derived state on `patient_screenings.appointmentStatus` |
| Canonical table | `outreach_calls` |
| Canonical ID | `outreach_calls.id` |
| Created by | POST /api/outreach/calls (has 18 outcome values) |
| Creation trigger | PCS records a call attempt |
| Editable by | (append-only) |
| Approvable by | N/A |
| Signable by | N/A |
| Versioned | Append-only log; no version |
| Patient EHR | ⚠️ Shown in patient activity |
| Plexus IQ | ❌ Not shown |
| Admin Review | ❌ Not shown |
| Engagement Center | ✅ Primary display; call-result dialogs |
| PCS Portal | ✅ Primary display |
| ACS Portal | ❌ Not shown |
| Global Calendar | ⚠️ Callback-at surfaces here (`callback_at` timestamp) |
| Ancillary Documents | ❌ |
| Others | ❌ |
| Missing visualization | Patient EHR (per-call timeline) |
| Duplicate visualization path | POST `/api/engagement-center/call-result` writes journey event + engagement status but does NOT insert into `outreach_calls`. **Two writers, different tables** — see audit §5.4. |
| Mock/live status | LIVE |
| Verified repository path | `shared/schema/outreach.ts:35-60`; `server/routes/outreach.ts:200-352`; `server/routes/executionCases.ts:158-189` |

### Appointment

| Field | Value |
|---|---|
| Canonical source of truth | **FRAGMENTED** — no single truth today |
| Canonical table | `global_schedule_events` (Global Calendar side) + `ancillary_appointments` (portal side) + `patient_screenings.appointmentStatus` (derived) + `patient_execution_cases.engagementStatus` (case) |
| Canonical ID | `global_schedule_events.id` OR `ancillary_appointments.id` (independent) |
| Created by | POST /api/global-schedule-events, POST /api/global-schedule-events/schedule-ancillary, POST /api/appointments |
| Creation trigger | Direct calendar drop / quick-schedule / call outcome scheduled / same-day add |
| Editable by | scheduler, admin |
| Approvable by | N/A |
| Signable by | N/A |
| Versioned | No; reschedule creates a new row without `parent_event_id` linkage |
| Patient EHR | ⚠️ Reads mostly from global_schedule_events |
| Plexus IQ | ❌ Not shown as appointment surface |
| Admin Review | ❌ |
| Engagement Center | ✅ Displays scheduled state |
| PCS Portal | ✅ via technician-liaison feeds |
| ACS Portal | ✅ via technician-liaison feeds |
| Global Calendar | ✅ Primary display |
| Ancillary Documents | ❌ Not shown as an appointment surface |
| Clinician Portal | ⚠️ |
| Imaging Central | ⚠️ Shows ancillary appointments in workspace |
| Finance | ❌ |
| Billing workspace | ❌ |
| Document Library | ❌ |
| Plexus Bank | 🎭 |
| Clinic Analytics | 🚫 |
| Mission Control | ✅ Scheduled-today count |
| Patient timeline | ⚠️ Via journey events at scheduling time |
| Missing visualization | Ancillary Documents (should show appointment link on each document row) |
| Duplicate visualization path | **FOUR:** global_schedule_events, ancillary_appointments, patient_screenings.appointmentStatus, patient_execution_cases.engagementStatus — all independent |
| Mock/live status | LIVE |
| Verified repository path | `shared/schema/globalSchedule.ts:10-77`; `shared/schema/appointments.ts:5-30`; `server/routes/globalSchedule.ts:281-378` |

### Consent

| Field | Value |
|---|---|
| Canonical source of truth | `documents` row (kind='informed_consent') + `case_document_readiness` row (documentType='informed_consent') |
| Canonical table | `documents` + `case_document_readiness` |
| Canonical ID | `documents.id` |
| Created by | POST /api/documents-library or POST /api/portal/uploads |
| Creation trigger | Upload |
| Editable by | admin |
| Approvable by | N/A |
| Signable by | Physician (signatureRequirement — schema/documents.ts DOCUMENT_SIGNATURE_REQUIREMENTS enum) |
| Versioned | Yes (documents.supersededByDocumentId chain) |
| Patient EHR | ✅ Documents section |
| Plexus IQ | ❌ |
| Admin Review | ❌ |
| Engagement Center | ✅ Document readiness lane |
| PCS Portal | ⚠️ Shown in Tools |
| ACS Portal | ✅ Consent picker (surface="tech_consent_picker") |
| Global Calendar | ❌ |
| Ancillary Documents | ⚠️ Shown via legacy `/api/generated-notes` docKind='informed_consent' |
| Clinician Portal | 🎭 LinkedDocumentsPanel = [] |
| Imaging Central | ⚠️ |
| Finance | ❌ |
| Billing workspace | ⚠️ Read via billing_readiness_check |
| Document Library | ✅ Admin surface |
| Plexus Bank | 🎭 |
| Clinic Analytics | 🚫 |
| Mission Control | ✅ Documentation backlog count |
| Patient timeline | ⚠️ Via document_sent journey event |
| Missing visualization | Physician Portal LinkedDocumentsPanel (empty mock) |
| Duplicate visualization path | Legacy uploaded_documents → documents migration uses **exact-name matching** |
| Mock/live status | LIVE (except Clinician LinkedDocumentsPanel) |
| Verified repository path | `shared/schema/documents.ts:97-149`; `server/routes/documentLibrary.ts:89-438` |

### Screening Form

| Field | Value |
|---|---|
| Canonical source of truth | `documents` row (kind='screening_form') + `case_document_readiness` |
| Canonical table | `documents` |
| Canonical ID | `documents.id` |
| Created by | POST /api/documents-library / POST /api/portal/uploads |
| Creation trigger | Upload |
| Editable by | admin |
| Approvable by | N/A |
| Signable by | Optional (per DOCUMENT_SIGNATURE_REQUIREMENTS) |
| Versioned | Yes (supersededBy chain) |
| Patient EHR | ✅ |
| Plexus IQ | ⚠️ Referenced in reasoning |
| Admin Review | ⚠️ |
| Engagement Center | ✅ Document readiness lane |
| PCS Portal | ⚠️ |
| ACS Portal | ✅ |
| Global Calendar | ❌ |
| Ancillary Documents | ⚠️ Legacy docKind='screening_form' |
| Clinician Portal | 🎭 |
| Imaging Central | ⚠️ |
| Finance | ❌ |
| Billing workspace | ⚠️ Via billing_readiness |
| Document Library | ✅ |
| Plexus Bank | 🎭 |
| Clinic Analytics | 🚫 |
| Mission Control | ✅ Backlog count |
| Patient timeline | ⚠️ |
| Missing visualization | Clinician LinkedDocumentsPanel |
| Duplicate visualization path | Same as Consent (legacy uploaded_documents) |
| Mock/live status | LIVE |
| Verified repository path | Same as Consent |

### Order Note

| Field | Value |
|---|---|
| Canonical source of truth | `procedure_notes` row with `noteType='order_note'` |
| Canonical table | `procedure_notes` |
| Canonical ID | `procedure_notes.id` + `(patientScreeningId, serviceType, noteType)` unique |
| Created by | Side-effect of `markProcedureComplete` → `createPendingProcedureNotes` |
| Creation trigger | Procedure event marked complete (NOT the documented gate) |
| Editable by | admin, clinician |
| Approvable by | (generation status transitions) |
| Signable by | Not signed per current code (KINDS_REQUIRING_SIGNATURE excludes `order_note`) |
| Versioned | No (no notes_lineage_id) |
| Patient EHR | ✅ Reads /api/procedure-notes |
| Plexus IQ | ❌ |
| Admin Review | ❌ |
| Engagement Center | ✅ Displays via procedureNotesQueryKey (`client/src/components/engagement/EngagementDocuments.tsx:491-506`) |
| PCS Portal | ⚠️ |
| ACS Portal | ✅ |
| Global Calendar | ❌ |
| Ancillary Documents | 🟠 Reads LEGACY `/api/generated-notes` — **NOT** procedure_notes |
| Clinician Portal | 🎭 LinkedDocumentsPanel empty mock |
| Imaging Central | ⚠️ |
| Finance | ❌ |
| Billing workspace | ⚠️ Via billing_readiness lane |
| Document Library | ⚠️ Kind-filtered when uploaded as document |
| Plexus Bank | 🎭 |
| Clinic Analytics | 🚫 |
| Mission Control | ✅ backlog count |
| Patient timeline | ⚠️ Via journey events on completion |
| Missing visualization | Clinician LinkedDocumentsPanel + Ancillary Documents (both are on the wrong surface) |
| Duplicate visualization path | **Two writers-vs-readers:** `procedure_notes` (write) vs `generated_notes` (read on Ancillary Documents). See audit §5.6. |
| Mock/live status | Written LIVE; Ancillary Documents display is 🟠 legacy; Clinician display is 🎭 mock |
| Verified repository path | `shared/schema/generatedNotes.ts:11-65`; `server/repositories/generatedNotes.repo.ts:75-132`; `client/src/pages/documents.tsx:135-137` |

### Procedure event

| Field | Value |
|---|---|
| Canonical source of truth | `procedure_events` row |
| Canonical table | `procedure_events` |
| Canonical ID | `procedure_events.id` |
| Created by | POST /api/procedure-events/complete (only endpoint) |
| Creation trigger | ACS marks procedure complete |
| Editable by | technician, admin |
| Approvable by | N/A |
| Signable by | N/A (notes carry the signature) |
| Versioned | No |
| Patient EHR | ✅ |
| Plexus IQ | ❌ |
| Admin Review | ❌ |
| Engagement Center | ⚠️ Case status reflects |
| PCS Portal | ⚠️ |
| ACS Portal | ✅ Primary display |
| Global Calendar | ✅ Mirror event (eventType='procedure_complete') |
| Ancillary Documents | ⚠️ |
| Clinician Portal | ⚠️ |
| Imaging Central | ✅ |
| Finance | ⚠️ Via billing_readiness link |
| Billing workspace | ⚠️ Via readiness |
| Document Library | ⚠️ |
| Plexus Bank | 🎭 |
| Clinic Analytics | 🚫 |
| Mission Control | ✅ Completed-today count |
| Patient timeline | ⚠️ |
| Missing visualization | None material |
| Duplicate visualization path | None |
| Mock/live status | LIVE. Only `complete` transition endpoint exists; `not_started`, `in_progress`, `cancelled`, `no_show`, `reschedule_needed` states are declared but no endpoints reach them. |
| Verified repository path | `shared/schema/procedureEvents.ts:11-46`; `server/routes/procedureEvents.ts:56-82` |

### Report

| Field | Value |
|---|---|
| Canonical source of truth | `documents` row (kind='report') |
| Canonical table | `documents` + `document_blobs` + `document_surface_assignments` |
| Canonical ID | `documents.id` |
| Created by | POST /api/documents-library, POST /api/portal/uploads |
| Creation trigger | Upload |
| Editable by | admin |
| Approvable by | N/A |
| Signable by | Physician (KINDS_REQUIRING_SIGNATURE includes `report`) |
| Versioned | Yes (documents.supersededByDocumentId chain) |
| Patient EHR | ✅ Via /api/documents-library?patientId= |
| Plexus IQ | ⚠️ Reasoning may reference |
| Admin Review | ⚠️ |
| Engagement Center | ✅ Report readiness lane |
| PCS Portal | ⚠️ |
| ACS Portal | ✅ Uploaded via portal upload endpoint |
| Global Calendar | ❌ |
| Ancillary Documents | 🟠 Legacy `/api/generated-notes` reads screening-batch-era reports |
| Clinician Portal | 🎭 LinkedDocumentsPanel empty; signature worklist reads case_document_readiness for report state |
| Imaging Central | ✅ |
| Finance | ❌ |
| Billing workspace | ⚠️ Via readiness (report is a required doc) |
| Document Library | ✅ |
| Plexus Bank | 🎭 |
| Clinic Analytics | 🚫 |
| Mission Control | ✅ Reports-missing count |
| Patient timeline | ⚠️ Via document journey events |
| Missing visualization | Clinician LinkedDocumentsPanel (mock) |
| Duplicate visualization path | Legacy uploaded_documents migration uses exact-name matching |
| Mock/live status | LIVE (except Clinician LinkedDocumentsPanel) |
| Verified repository path | `shared/schema/documents.ts:31-149`; `server/routes/documentLibrary.ts:89-438` |

### Procedure Note

| Field | Value |
|---|---|
| Canonical source of truth | `procedure_notes` row with `noteType='post_procedure_note'` |
| Canonical table | `procedure_notes` |
| Canonical ID | Same as Order Note (shared table + unique index) |
| Created by | Side-effect of `markProcedureComplete` → `createPendingProcedureNotes` |
| Creation trigger | Procedure event complete (NOT the documented "procedure complete + report uploaded" gate at write; enforced at signature time only) |
| Editable by | admin, clinician |
| Approvable by | Generation status transition |
| Signable by | Physician (KINDS_REQUIRING_SIGNATURE includes `post_procedure_note`); report presence required at signature (`server/services/physicianPortal/signatureRules.ts:114-116`) |
| Versioned | No; `signatureStatus='returned_for_correction'` + `returnReason` is the only correction mechanism |
| Patient EHR | ✅ |
| Plexus IQ | ❌ |
| Admin Review | ❌ |
| Engagement Center | ✅ |
| PCS Portal | ⚠️ |
| ACS Portal | ✅ |
| Global Calendar | ❌ |
| Ancillary Documents | 🟠 Same legacy read as Order Note |
| Clinician Portal | 🎭 LinkedDocumentsPanel empty; signature workflow lives here separately |
| Imaging Central | ⚠️ |
| Finance | ❌ |
| Billing workspace | ⚠️ Via readiness |
| Document Library | ⚠️ |
| Plexus Bank | 🎭 |
| Clinic Analytics | 🚫 |
| Mission Control | ✅ Backlog count |
| Patient timeline | ⚠️ Via signature journey event |
| Missing visualization | Clinician LinkedDocumentsPanel |
| Duplicate visualization path | Same as Order Note |
| Mock/live status | Written LIVE; Ancillary Documents display 🟠; Clinician display 🎭 |
| Verified repository path | Same as Order Note |

### Signature

| Field | Value |
|---|---|
| Canonical source of truth | `procedure_notes.signatureStatus` + `signedAt` + `signedByUserId` (+ `returnReason`) — OR `documents.signatureRequirement` state |
| Canonical table | `procedure_notes` (for note signatures); `documents` for document signature state |
| Canonical ID | Row primary keys |
| Created by | POST /api/physician-portal/signature-items (batch), /api/clinician-portal/notes/:id/sign |
| Creation trigger | Physician signs a note |
| Editable by | admin (return for correction) |
| Approvable by | N/A |
| Signable by | Physician (clinician role) |
| Versioned | No |
| Patient EHR | ✅ Shows signed state on document |
| Plexus IQ | ❌ |
| Admin Review | ❌ |
| Engagement Center | ✅ Signed state visible on document lane |
| PCS Portal | ⚠️ |
| ACS Portal | ✅ |
| Global Calendar | ❌ |
| Ancillary Documents | 🟠 Reads legacy generated_notes |
| Clinician Portal | ✅ Signature worklist (real) |
| Imaging Central | ⚠️ |
| Finance | ⚠️ Signed report/note is a billing readiness input |
| Billing workspace | ⚠️ |
| Document Library | ⚠️ |
| Plexus Bank | 🎭 |
| Clinic Analytics | 🚫 |
| Mission Control | ✅ Signature backlog count |
| Patient timeline | ⚠️ |
| Missing visualization | Formal audit trail table (signature updates use `signedByUserId` + `signedAt` only, no audit_events table row) |
| Duplicate visualization path | Signature worklist (real) vs LinkedDocumentsPanel (mock) both attempt to show physician's queue |
| Mock/live status | Write LIVE; display: worklist is real, LinkedDocumentsPanel is 🎭 |
| Verified repository path | `shared/schema/generatedNotes.ts:27-33,50-52`; `server/services/physicianPortal/signatureWorkflow.ts:93-117` |

### Billing readiness

| Field | Value |
|---|---|
| Canonical source of truth | `billing_readiness_checks` row per (patientScreeningId, serviceType) |
| Canonical table | `billing_readiness_checks` |
| Canonical ID | `billing_readiness_checks.id` |
| Created by | `evaluateBillingReadinessForProcedure` (repository helper) called from procedure complete, note signature, document upload |
| Creation trigger | Any input that could change readiness |
| Editable by | (evaluation side-effect only) |
| Approvable by | N/A |
| Signable by | N/A |
| Versioned | No (upserted in place; readyAt captured at first ready) |
| Patient EHR | ✅ |
| Plexus IQ | ❌ |
| Admin Review | ❌ |
| Engagement Center | ✅ Displays readiness state |
| PCS Portal | ⚠️ |
| ACS Portal | ✅ |
| Global Calendar | ❌ |
| Ancillary Documents | ❌ |
| Clinician Portal | ⚠️ |
| Imaging Central | ⚠️ |
| Finance | ✅ |
| Billing workspace | ✅ Primary display (`billing-readiness.tsx` page) |
| Document Library | ❌ |
| Plexus Bank | 🎭 |
| Clinic Analytics | 🚫 |
| Mission Control | ✅ Ready-for-billing count |
| Patient timeline | ⚠️ Via readiness transitions in journey events |
| Missing visualization | None material |
| Duplicate visualization path | None |
| Mock/live status | LIVE. **Fire-and-forget** downstream to billing_document_requests. |
| Verified repository path | `shared/schema/billingReadiness.ts:10-42`; `server/repositories/billingReadiness.repo.ts:94-179` |

### Billing Document request

| Field | Value |
|---|---|
| Canonical source of truth | `billing_document_requests` row |
| Canonical table | `billing_document_requests` |
| Canonical ID | `billing_document_requests.id` |
| Created by | `createPendingBillingDocumentRequestFromReadiness` (side-effect of readiness → ready_to_generate) |
| Creation trigger | Readiness reaches ready_to_generate |
| Editable by | biller |
| Approvable by | N/A |
| Signable by | N/A |
| Versioned | No |
| Patient EHR | ✅ |
| Plexus IQ | ❌ |
| Admin Review | ❌ |
| Engagement Center | ❌ |
| PCS Portal | ❌ |
| ACS Portal | ❌ |
| Global Calendar | ❌ |
| Ancillary Documents | 🟠 Legacy generated_notes reads billing docs (docKind='billing') per `client/src/pages/documents.tsx:116-121` DOC_KIND_LABELS |
| Clinician Portal | 🎭 |
| Imaging Central | ❌ |
| Finance | ⚠️ Read-only; no generator |
| Billing workspace | ✅ Read-only display |
| Document Library | ❌ Never linked (generatedDocumentId is orphan) |
| Plexus Bank | 🎭 |
| Clinic Analytics | 🚫 |
| Mission Control | ✅ Backlog count (part of billing lanes) |
| Patient timeline | ❌ Not emitted as journey event |
| Missing visualization | Generator does not exist; Document Library link does not exist |
| Duplicate visualization path | Legacy generated_notes (docKind='billing') on Ancillary Documents |
| Mock/live status | **Schema-only / partially implemented.** No generator. `generatedDocumentId` orphan. |
| Verified repository path | `shared/schema/billingDocuments.ts:11-46`; `server/routes/billingDocuments.ts:11-54` |

### Generated Billing Document (file)

| Field | Value |
|---|---|
| Canonical source of truth | **Not implemented.** Intended target: `documents` row with kind='billing_document'. `billing_document_requests.generatedDocumentId` is an orphan FK column. |
| Canonical table | Would be `documents` |
| Canonical ID | Would be `documents.id` |
| Created by | **No writer exists.** |
| Creation trigger | Billing generator (missing) |
| Editable by | admin |
| Approvable by | N/A |
| Signable by | Potentially — DOCUMENT_SIGNATURE_REQUIREMENTS allows |
| Versioned | Yes if aligned to `documents.supersededByDocumentId` |
| Patient EHR | ❌ |
| Others | ❌ |
| Missing visualization | Everywhere |
| Duplicate visualization path | Legacy generated_notes (docKind='billing') is the current stand-in |
| Mock/live status | **Not implemented** |
| Verified repository path | `shared/schema/billingDocuments.ts:33` (bare int, no FK) |

### Claim

| Field | Value |
|---|---|
| Canonical source of truth | **Not implemented.** No claims table. |
| Canonical table | None |
| Canonical ID | N/A |
| Created by | Nothing |
| Creation trigger | N/A |
| Editable by | N/A |
| Approvable by | N/A |
| Signable by | N/A |
| Versioned | N/A |
| Patient EHR | ❌ |
| Plexus IQ | ❌ |
| Admin Review | ❌ |
| Engagement Center | ❌ |
| PCS Portal | ❌ |
| ACS Portal | ❌ |
| Global Calendar | ❌ |
| Ancillary Documents | ❌ |
| Clinician Portal | 🎭 Types-only (mockData.CLAIMS structure) |
| Imaging Central | ❌ |
| Finance | ❌ |
| Billing workspace | ❌ |
| Document Library | ❌ |
| Plexus Bank | 🎭 Mock claims flow |
| Clinic Analytics | 🚫 |
| Mission Control | ❌ |
| Patient timeline | ❌ |
| Missing visualization | Everywhere |
| Duplicate visualization path | Plexus Bank mock is the only "claims" surface |
| Mock/live status | **Not implemented** |
| Verified repository path | grep of shared/schema for `claim` returns no hits |

### Claim status / Denial

| Field | Value |
|---|---|
| Canonical source of truth | Denial workflow is partially implemented via `invoice_denials`; claim-status per se is not modeled |
| Canonical table | `invoice_denials` (for denial rows), `remittance_events` (for payment/denial event history) |
| Canonical ID | `invoice_denials.id` |
| Created by | POST /api/invoices/:id/denials |
| Creation trigger | Biller records payer denial |
| Editable by | biller (PATCH /api/denials/:id/status) |
| Approvable by | N/A |
| Signable by | N/A |
| Versioned | Status enum: open/appealed/overturned/upheld/closed |
| Patient EHR | ❌ Not shown |
| Others | ❌ |
| Finance | ✅ Denial workflow |
| Billing workspace | ✅ |
| Plexus Bank | 🎭 |
| Missing visualization | Patient EHR, Ancillary Documents (denial impact on documentation) |
| Duplicate visualization path | None |
| Mock/live status | LIVE (denial workflow only) |
| Verified repository path | `shared/schema/invoiceFinancialEvents.ts:39-55` |

### Remittance

| Field | Value |
|---|---|
| Canonical source of truth | `remittance_events` row |
| Canonical table | `remittance_events` |
| Canonical ID | `remittance_events.id` |
| Created by | Inserted by `postPayment`, `postAdjustment`, `postDenial` |
| Creation trigger | Any financial event |
| Editable by | (append-only) |
| Approvable by | N/A |
| Signable by | N/A |
| Versioned | Append-only |
| Patient EHR | ❌ |
| Others | ❌ |
| Finance | ⚠️ Read indirectly |
| Billing workspace | ⚠️ |
| Plexus Bank | 🎭 |
| Missing visualization | Full remittance timeline |
| Duplicate visualization path | None |
| Mock/live status | LIVE |
| Verified repository path | `shared/schema/invoiceFinancialEvents.ts:66-79` |

### Payment

| Field | Value |
|---|---|
| Canonical source of truth | `invoice_payments` row |
| Canonical table | `invoice_payments` |
| Canonical ID | `invoice_payments.id` |
| Created by | POST /api/invoices/:id/payments |
| Creation trigger | Biller records payment |
| Editable by | (append-only; corrections via adjustments) |
| Approvable by | N/A |
| Signable by | N/A |
| Versioned | Append-only |
| Patient EHR | ❌ |
| Plexus IQ | ❌ |
| Admin Review | ❌ |
| Engagement Center | ❌ |
| PCS Portal | ❌ |
| ACS Portal | ❌ |
| Global Calendar | ❌ |
| Ancillary Documents | ❌ |
| Clinician Portal | 🎭 Finance page reads mock claims |
| Imaging Central | ❌ |
| Finance | ✅ Primary display |
| Billing workspace | ✅ |
| Document Library | ❌ |
| Plexus Bank | 🎭 |
| Clinic Analytics | 🚫 |
| Mission Control | ⚠️ Finance section is `sourceMissing: true` today (deliberate per Phase 3) |
| Patient timeline | ❌ No journey event on payment |
| Missing visualization | Journey timeline; Clinician Portal Finance (mock) |
| Duplicate visualization path | Plexus Bank mock |
| Mock/live status | LIVE |
| Verified repository path | `shared/schema/invoices.ts:108-121`; `server/services/billing/invoiceFinancialService.ts:55-82` |

### Adjustment

| Field | Value |
|---|---|
| Canonical source of truth | `invoice_adjustments` row |
| Canonical table | `invoice_adjustments` |
| Canonical ID | `invoice_adjustments.id` |
| Created by | POST /api/invoices/:id/adjustments |
| Creation trigger | Biller enters write-off / contractual / correction / discount / dispute_hold / manual |
| Editable by | (append-only) |
| Others | Finance/Billing only |
| Mock/live status | LIVE |
| Verified repository path | `shared/schema/invoiceFinancialEvents.ts:15-28` |

### Invoice

| Field | Value |
|---|---|
| Canonical source of truth | `invoices` row |
| Canonical table | `invoices` |
| Canonical ID | `invoices.id` + `invoices.invoiceNumber` |
| Created by | `createDraftsFromBatch` OR manual draft |
| Creation trigger | Batch creation OR manual |
| Editable by | admin, biller (approval state machine) |
| Approvable by | admin, biller |
| Signable by | N/A |
| Versioned | approvalStatus history via `revised`; no explicit version chain |
| Patient EHR | ⚠️ Reads invoice status per patient |
| Plexus IQ | ❌ |
| Admin Review | ❌ |
| Engagement Center | ❌ |
| PCS Portal | ❌ |
| ACS Portal | ❌ |
| Global Calendar | ❌ |
| Ancillary Documents | ❌ |
| Clinician Portal | 🎭 Finance page types-only |
| Imaging Central | ❌ |
| Finance | ✅ Primary |
| Billing workspace | ✅ |
| Document Library | ❌ |
| Plexus Bank | 🎭 |
| Clinic Analytics | 🚫 |
| Mission Control | ⚠️ finance sourceMissing:true (deliberate) |
| Patient timeline | ❌ No journey event |
| Missing visualization | Patient EHR (better invoice status) |
| Duplicate visualization path | None |
| Mock/live status | LIVE. No `closed` state. `sent_to_billing` declared in billingReadiness/billingDocuments enums but NOT in invoices.status. |
| Verified repository path | `shared/schema/invoices.ts:9-121`; `server/services/billing/invoiceFinancialService.ts:14-93` |

### Revenue allocation (clinic vs Plexus)

| Field | Value |
|---|---|
| Canonical source of truth | **Not implemented as compute.** Schema hints only. |
| Canonical table | `projected_invoice_rows.revenueSplit` (jsonb) + `invoice_batch_items.revenueSplit` + `projected_invoices.projectedOurPortionPercentage` (default `"50"`) |
| Created by | None |
| Missing visualization | Everywhere except Plexus Bank mock |
| Duplicate visualization path | Plexus Bank mock is the only revenue-split surface |
| Mock/live status | **Schema-only** |
| Verified repository path | `shared/schema/projectedInvoices.ts:34`; `shared/schema/invoiceBatches.ts:72` |

### Journey completion

| Field | Value |
|---|---|
| Canonical source of truth | **Not implemented.** Fragmented across `patient_execution_cases.lifecycleStatus`, `patient_screenings.commitStatus`, `procedure_events.procedureStatus`, `invoices.status` |
| Canonical table | None |
| Created by | Individual stage transitions |
| Missing visualization | Everywhere |
| Duplicate visualization path | Every surface derives its own "complete" state |
| Mock/live status | **Not implemented** |
| Verified repository path | grep of shared/schema for `journey_complete` returns no hits |

## Summary Findings

### Where the visualization is honest and canonical

Patient EHR, Plexus IQ (Admin Review), Engagement Center, Global Calendar, Billing Readiness page, Finance page, Document Library, Mission Control (its own scope).

### Where the visualization is broken

1. **Ancillary Documents (`/ancillary-documents`)** — reads legacy `/api/generated-notes` while writes go to `procedure_notes`. Every note surfaced here is stale relative to the canonical source.
2. **Clinician Portal Orders & Notes → LinkedDocumentsPanel** — reads empty mock (`DOCUMENTS = []`). Renders "no linked documents" permanently regardless of live state.
3. **Plexus Bank** — 100% client-side mock, publicly routable, localStorage-persisted.
4. **Claims / Payments / Invoices in the Clinician Portal Finance page** — types-only; no live data.
5. **Journey completion nowhere** — no single "fully complete" indicator exists.

### The Patient EHR as intended longitudinal SoT

The Patient EHR IS the intended longitudinal visualization. It reads from:
- `patient_screenings` (identity + status)
- `patient_execution_cases` (case)
- `patient_journey_events` (timeline)
- `documents` (via `/api/documents-library?patientId=...`)
- `procedure_notes` (via `/api/procedure-notes?patientScreeningId=...`)
- `billing_readiness_checks`, `billing_document_requests` (financial state)
- `invoices` (billing state, per patient)

**Missing from Patient EHR today:** payment events, journey completion roll-up, revenue allocation, per-claim status.

### Ancillary Documents as intended global operational projection

Today, Ancillary Documents reads the LEGACY `/api/generated-notes` endpoint. To become the intended global operational projection, it must be rewired to read from:
- `procedure_notes` (order + procedure notes)
- `documents` (reports + billing documents)
- `case_document_readiness` (readiness state)
- `billing_document_requests` (billing artifact lifecycle)

All while preserving the existing UI. The legacy DOC_KIND_LABELS at `client/src/pages/documents.tsx:116-121` (`preProcedureOrder`, `postProcedureNote`, `billing`, `screening`) needs a mapping layer that folds them into the canonical `noteType` + `kind` values.

### Every projection must reference canonical IDs

Verified in code that projections already reference canonical IDs where they exist:
- `procedure_notes.patientScreeningId` → `patient_screenings.id`
- `procedure_notes.procedureEventId` → `procedure_events.id`
- `documents.patientScreeningId` → `patient_screenings.id`
- `billing_readiness_checks.executionCaseId` → `patient_execution_cases.id`
- `billing_document_requests.billingReadinessCheckId` → `billing_readiness_checks.id`

**Violations of "no independent copies":**
- `ancillary_appointments` copies patient linkage without linking back to `global_schedule_events`.
- `patient_screenings.appointmentStatus` is a mutable projection derived from outreach calls without a link back to any canonical appointment row.
- Legacy `uploaded_documents` migrates into `documents` via name-based fallback rather than ID.

These three items are the highest-priority visualization-integrity items.
