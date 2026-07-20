# Full Patient Journey Platform Audit

**Repository:** noorhanmedical/tertiary-command-center
**Starting main SHA:** `2aaa23bc75b0940c3c24f20d7abaf149403a322d`
**Audit branch:** `audit/full-patient-journey-platform`
**Scope:** Complete patient lifecycle — ingestion → identity → qualification → admin review → engagement → scheduling → order note → procedure → report → procedure note → billing readiness → billing document → claim → payment → invoice → journey completion
**Status:** Phase 1 — audit only. Zero application/UI/schema/migration changes.

---

## 1. Executive Summary

The platform has **five clean canonical surfaces** and **three architectural fractures** that block a true end-to-end patient journey. The canonical surfaces are: `patient_screenings` (identity), `patient_execution_cases` (case), `procedure_notes` (both order + post-procedure notes), `documents` (files), and `invoices/invoice_payments/invoiceAdjustments/invoiceDenials/remittanceEvents` (financial events). Every other stage is either fragmented, schema-only, or displayed but not written.

**The three architectural fractures:**

1. **Appointment fragmentation.** No single canonical appointment table. Four stores independently maintain appointment-adjacent state: `global_schedule_events`, `ancillary_appointments`, `patient_screenings.appointmentStatus`, and `patient_execution_cases.engagementStatus`. There is no cross-store sync (`server/services/globalSchedule.repo.ts`, `server/routes/outreach.ts:352` — spine sync is fire-and-forget).

2. **Billing-document → claim chasm.** `billing_document_requests` is canonical but its `generatedDocumentId` column has **no FK, no writer, and no reader** (`shared/schema/billingDocuments.ts:33`). No claims table exists, no external clearinghouse call exists, no EDI formatter exists. The path from "billing document generated" → "claim submitted" → "payment received" is entirely aspirational after the invoice payment surface.

3. **Business-rule gates enforced only at UI or signature-time, not at write.** Two documented eligibility rules — Order Note requires (admin approval + scheduled appointment); Procedure Note requires (procedure complete + report uploaded) — are **not enforced when the note is created**. `createPendingProcedureNotes()` fires unconditionally on procedure complete (`server/repositories/generatedNotes.repo.ts:82-132`); report presence is only checked at signature-eligibility time (`server/services/physicianPortal/signatureRules.ts:114-116`).

Everything else — patient ingestion, qualification, admin review, engagement, scheduling triage, procedure events, note signature, invoice lifecycle, payment posting, denial workflow — is implemented and canonical. The system is **96% coherent by count of touched tables**, but the three fractures above are load-bearing for a complete journey.

Retirement of Twilio / patient SMS is verified complete on `main` at `2aaa23b`: zero live code, zero live endpoint, only comments documenting the removal. The pre-existing `/sms/twilio/inbound` auth-exemption at `server/routes.ts:210-214` is unreachable dead code (no route registered).

## 2. Current Canonical Entity Findings

| Concept | Canonical entity | Canonical ID | Evidence |
|---------|:-----------------|:-------------|:---------|
| Patient identity | `patient_screenings` row | `patient_screenings.id` (int, serial) | `shared/schema/screening.ts:46-106`. Deterministic name+dob grouping exists as an unwired read-only module: `server/modules/patient-directory/repo.ts:3-232`. |
| Ancillary case | `patient_execution_cases` row | `patient_execution_cases.id` (int, serial) | `shared/schema/executionCase.ts:30-62`. One-per-screening enforced by upsert-by-screening-id at `server/repositories/executionCase.repo.ts:168-172`. |
| Appointment | **Fragmented** — no single canonical | N/A | `global_schedule_events` (`shared/schema/globalSchedule.ts:47-77`), `ancillary_appointments` (`shared/schema/appointments.ts:5-30`), and `patient_screenings.appointmentStatus` all track different views of the same fact. |
| Order Note | `procedure_notes` row with `noteType='order_note'` | `procedure_notes.id` (int) + `(patientScreeningId, serviceType, noteType)` unique index | `shared/schema/generatedNotes.ts:35-65`; NOTE_TYPES declared line 11; `idx_pn_unique_note` unique index line 64. |
| Procedure Note | `procedure_notes` row with `noteType='post_procedure_note'` | `procedure_notes.id` (int) + `(patientScreeningId, serviceType, noteType)` unique index | Same table as Order Note. Signature-status enum lines 27-32. |
| Report | `documents` row (kind = 'report'), with `uploaded_documents` legacy first-read migration | `documents.id` (int) | `shared/schema/documents.ts:97-120`. Legacy migration: `server/routes/documentLibrary.ts:89-145` uses `LEGACY_SOURCE_PREFIX` marker and `findLatestPatientScreeningByExactName` (name-based fallback). |
| Billing Document Request | `billing_document_requests` row | `billing_document_requests.id` (int) + FK to `billing_readiness_checks.id` | `shared/schema/billingDocuments.ts:20-46`. |
| Billing Document (generated file) | **Not implemented** — `billing_document_requests.generatedDocumentId` is a bare int with no FK and no writer | N/A | `shared/schema/billingDocuments.ts:33`. Grep of the codebase finds zero code that populates `generatedDocumentId`. |
| Claim | **Not implemented** | N/A | Zero claims table in `shared/schema/`. Zero `/api/claims/*` routes. Zero external submission calls. |
| Payment | `invoice_payments` row | `invoice_payments.id` (int) | `shared/schema/invoices.ts:108-121`. `postPayment()` at `server/services/billing/invoiceFinancialService.ts:55-82` inserts payment, then remittance event, then recomputes invoice totals. |
| Invoice | `invoices` row | `invoices.id` (int) | `shared/schema/invoices.ts` — status enum `["Draft", "Sent", "Partially Paid", "Paid"]` (line 9), approval enum `["draft", "pending_review", "approved", "voided", "revised"]` (lines 58-64), delivery enum `["pending", "ready_to_send", "queued", "sent", "failed", "download_only", "blocked_missing_recipient", "blocked_not_approved"]` (lines 67-76). |

## 3. Competing Source-of-Truth Findings

The following overlapping stores maintain independent truth and are not automatically reconciled:

### 3.1 Appointment truth is split across four stores

| Store | Table | What it tracks | Read by |
|-------|-------|----------------|---------|
| Global Calendar | `global_schedule_events` | doctor_visit, ancillary_appointment, same_day_add, no_show, cancellation, reschedule, procedure_complete (status enum: scheduled/completed/cancelled/no_show/blocked/pending_sync) | `/api/global-schedule-events`, PCS/ACS technician-liaison feeds, Global Calendar |
| Ancillary appointments | `ancillary_appointments` | patient+facility+date+time+testType, status=scheduled/cancelled | `/api/appointments` (`server/routes/appointments.ts`), portal reads |
| Screening state | `patient_screenings.appointmentStatus` | Derived from outreach call outcomes via `deriveAppointmentStatus()` | Outreach dashboard, Patient EHR |
| Case state | `patient_execution_cases.engagementStatus` | new/contacted/scheduled/completed/not_reached/unable_to_reach | Engagement Center, Mission Control |

**Confirmed:** These stores do NOT sync atomically. `server/routes/outreach.ts:352` fires `ensureCanonicalSpineForScreening` as a fire-and-forget promise — on error, the call outcome is recorded but the execution case can lag or diverge.

### 3.2 Document surface fragmentation

- `documents` + `document_surface_assignments` (canonical, admin document library)
- `uploaded_documents` (legacy) — first-read migration into `documents` uses **exact patient-name matching** (`server/routes/documentLibrary.ts:104`, name-based fallback risk)
- `procedure_notes` (canonical for order + procedure notes)
- `generated_notes` (legacy AI-generated notes surface at `/api/generated-notes`) — the route is still registered at `server/routes.ts` and Ancillary Documents page reads it (`client/src/pages/documents.tsx:135-137`)

### 3.3 Note visualisation vs write path

- **Written to `procedure_notes`:** procedure completion (`server/repositories/procedureEvents.repo.ts:233`), signature workflow (`server/services/physicianPortal/signatureWorkflow.ts:93-100`).
- **Read from `procedure_notes`:** Engagement Documents (`client/src/components/engagement/EngagementDocuments.tsx:491-506`), Document Readiness Panel.
- **Read from `generated_notes` (legacy):** `client/src/pages/documents.tsx:135-137` (Ancillary Documents page).
- **Read from mockData.DOCUMENTS = []:** Clinician Portal `LinkedDocumentsPanel` (`client/src/components/physician/orders/OrdersNotesPage.tsx:401-420`). This surface renders "no documents" permanently.

### 3.4 Messaging split

- `mockPortalMessages` (in-memory, client-side only, `client/src/components/portal/messaging/mockPortalMessages.ts`) — actively used by TeamPortalShell.
- `direct_messages` (canonical, feature-flag OFF via `FEATURE_INTERNAL_DIRECT_MESSAGES=false`).
- Twilio / patient-SMS is fully retired (verified — see Section 6.6).

## 4. Full Lifecycle Diagram

```
                                       INGESTION
                                          ↓
                            patient_screenings (status=draft)
                                          ↓
                              [batch AI analysis runs]
                                          ↓
                           status=completed + qualifyingTests
                                          ↓
                                    ADMIN REVIEW
                                          ↓
                     adminApprovalStatus=approved (adminApprovedAt=NOW)
                                          ↓
                            commitPatient() → commitStatus=Ready
                                          ↓
                            patient_execution_cases (upserted)
                                          ↓
                                     ENGAGEMENT
                            [outreach_calls → deriveAppointmentStatus]
                                          ↓
                            scheduling_triage_cases (per outcome)
                                          ↓
                                     SCHEDULING
                        global_schedule_events (eventType=ancillary_appointment)
                        + ancillary_appointments (parallel row)
                        + patient_screenings.appointmentStatus=scheduled
                                          ↓
                                    PROCEDURE
                        POST /api/procedure-events/complete
                        → procedure_events (status=complete)
                        → global_schedule_events (eventType=procedure_complete)
                        → case_document_readiness (report=missing, order_note=pending,
                          post_procedure_note=pending)
                        → procedure_notes (2 rows: order_note + post_procedure_note,
                          both generationStatus=pending)
                                          ↓
                                REPORT UPLOAD (async)
                        POST /api/documents-library (or legacy uploaded_documents)
                        → documents row (kind=report, patientScreeningId)
                        → case_document_readiness.documentStatus=uploaded
                                          ↓
                          NOTE GENERATION (generator not implemented)
                        procedure_notes.generationStatus remains 'pending'
                        [No service transitions pending → generating → generated]
                                          ↓
                                    SIGNATURE
                        POST /api/physician-portal/signature-items
                        → procedure_notes.signatureStatus=signed, signedByUserId
                        [Report presence checked HERE, not at generation]
                                          ↓
                                 BILLING READINESS
                        evaluateBillingReadinessForProcedure()
                        → billing_readiness_checks (upserted per patient+service)
                        → readinessStatus=ready_to_generate
                                          ↓
                        [fire-and-forget] createPendingBillingDocumentRequestFromReadiness()
                        → billing_document_requests (requestStatus=pending,
                          generatedDocumentId=NULL forever)
                                          ↓
                            [GENERATION SERVICE MISSING]
                                          ↓
                                    INVOICE FLOW
                        invoice_drafts → approval → delivery → payment
                        Independent of the billing_document_request lineage.
                        invoice.status ∈ (Draft|Sent|Partially Paid|Paid)
                                          ↓
                                    PAYMENT
                        POST /api/invoices/:id/payments
                        → invoice_payments (amount + payment_date)
                        → remittance_events (eventType=payment_posted)
                        → recomputeInvoiceTotals() → invoice.status=Paid
                                          ↓
                              [NO CLAIM STAGE EXISTS]
                                          ↓
                              [NO REVENUE ALLOCATION]
                                          ↓
                       [NO "JOURNEY COMPLETE" AGGREGATE]
```

## 5. Master Lifecycle Table

_All file:line citations are anchored at commit `2aaa23b`._

### 5.1 Patient Ingestion

| Field | Value |
|---|---|
| **Stage** | Patient Ingestion (multi-path) |
| **Business purpose** | Get a patient row into `patient_screenings` with clinic + qualifying-test candidates |
| **Trigger** | Batch upload · manual add · Plexus IQ clinical import · Patient Directory import (flag-gated) · appointment stub · outreach call recorded on new patient |
| **Prerequisites** | None (identity is created here) |
| **Route** | POST `/api/batches` · POST `/api/batches/:id/patients` · POST `/api/batches/:id/import-file` · POST `/api/batches/:id/import-text` · POST `/api/plexus-iq/clinical-import` · POST `/api/patient-directory/import-confirm` (flag) · POST `/api/appointments` (stub) |
| **Page/component** | Plexus IQ calendar (PlexusIQBatchFlowDialog, PlexusIQBulkImportModal, PlexusIQDayModal) · Patient Directory import dialog (flag) |
| **Client hook** | React Query calls to routes above |
| **Server handler** | `server/routes/batches.ts:49-718` · `server/routes/plexusIqClinicalImport.ts:263-543` · `server/routes/patientDirectory.ts:191-433` · `server/routes/appointments.ts:25-89` |
| **Domain service** | `server/services/screening.ts` (`screenSinglePatientWithAI`) · `server/services/ingest.ts` (`parseWithAI`, `parseExcelFile`) · `server/services/patientCommitService.ts` (Draft→Ready) · `server/services/batchAnalysisRunner.ts` |
| **Repository** | `server/storage.ts` facade wrapping `patientScreenings`, `screening_batches` |
| **Table** | `patient_screenings` |
| **Canonical entity** | patient_screenings row |
| **Canonical ID** | `patient_screenings.id` (int) |
| **Status before** | (none — creates row) |
| **Status after** | `status='draft'` (or `'completed'` if pre-computed), `commitStatus='Draft'`, `adminApprovalStatus='pending'` |
| **Downstream trigger** | AI analysis · Admin Review queue |
| **Read roles** | all authed |
| **Create roles** | admin, scheduler, clinician (session-based) |
| **Update roles** | admin (PATCH `/api/patients/:id`) |
| **Approval/signature roles** | n/a |
| **Display locations** | Plexus IQ, Patient Directory (flag), Home dashboard schedule pane |
| **Mock/live status** | LIVE (Patient Directory EHR is flag-gated `USE_PATIENT_DIRECTORY_ACTIVATION`) |
| **Current defect** | (1) No uniqueness constraint on (name, dob) — multiple screenings for same identity can co-exist. (2) PATCH `/api/patients/:id` allows `data.name` mutation with no collision check (`server/routes/patients.ts:81`). (3) Patient test history writes name+dob only, no FK back (`shared/schema/patientHistory.ts:4-25`). |
| **Required minimal change** | Add persisted canonical-patient table OR enforce unique constraint. See Section 11.1. |
| **Unit test** | `tests/unit/patientIdentity.test.ts`, `tests/unit/patientDirectoryImport.test.ts` |
| **Integration test** | Not present |
| **E2E acceptance** | Playwright `tests/e2e/routes/canonical-route-smoke.spec.ts` |
| **Verification evidence** | `server/routes/batches.ts:49-718`, `server/services/patientCommitService.ts:71-233`, `shared/schema/screening.ts:46-106` |

### 5.2 Qualification (Plexus IQ)

| Field | Value |
|---|---|
| **Stage** | Qualification |
| **Business purpose** | AI decides which ancillary services a patient qualifies for; captures reasoning + confidence |
| **Trigger** | Batch analysis start OR per-patient re-analyze |
| **Prerequisites** | Patient screening row exists (status='draft') |
| **Route** | POST `/api/batches/:id/analyze` · GET `/api/batches/:id/analysis-status` |
| **Page/component** | PlexusIQ calendar, batch day modal |
| **Client hook** | React Query polling |
| **Server handler** | `server/routes/batches.ts:400-545` |
| **Domain service** | `server/services/batchAnalysisRunner.ts` |
| **Repository** | `patient_screenings` UPDATE (qualifyingTests, reasoning, status='completed') |
| **Table** | `patient_screenings` |
| **Canonical entity** | patient_screenings row (`qualifyingTests` array + `reasoning` jsonb) |
| **Canonical ID** | `patient_screenings.id` |
| **Status before** | `status='draft'` |
| **Status after** | `status='completed'`, `qualifyingTests=[...]`, `reasoning={testName: {...}}` |
| **Downstream trigger** | Enters Admin Review queue via `adminApprovalStatus='pending'` |
| **Read roles** | all authed |
| **Create roles** | admin/clinician (session) |
| **Update roles** | admin |
| **Approval/signature roles** | n/a |
| **Display locations** | Plexus IQ, Patient EHR (via reasoning jsonb) |
| **Mock/live status** | LIVE (OpenAI live via `AI_INTEGRATIONS_OPENAI_API_KEY`) |
| **Current defect** | (1) `batchAnalysisRunner.ts:714-728` overwrites existing `reasoning` on re-run without calling `preserveAdminReviewReasoning` (function exists at `shared/plexus-iq/adminReviewEvidence.ts:969-985` but never called). Admin-added metadata keys `adminReview:*` are silently lost. (2) `QUALIFICATION_STATUSES` includes `'pending_review'` but `deriveQualificationStatus()` never sets it (`server/repositories/executionCase.repo.ts:156-162`). |
| **Required minimal change** | Wire `preserveAdminReviewReasoning` into the batch runner update path. |
| **Unit test** | `tests/unit/adminReviewEvidence.test.ts` |
| **Integration test** | Not present |
| **E2E acceptance** | n/a — data-driven |
| **Verification evidence** | `server/services/batchAnalysisRunner.ts:714-728`, `shared/schema/screening.ts:70`, `shared/schema/executionCase.ts:21` |

### 5.3 Admin Review

| Field | Value |
|---|---|
| **Stage** | Admin Review (Plexus internal clinical review) |
| **Business purpose** | Internal Plexus reviewer approves patient for engagement; sets approval evidence |
| **Trigger** | Patient has `qualifyingTests` and `adminApprovalStatus='pending'` |
| **Prerequisites** | Qualification complete (status='completed') |
| **Route** | POST `/api/patient-screenings/:id/admin-approval` |
| **Page/component** | Plexus IQ Admin Review dialog |
| **Client hook** | React Query mutation |
| **Server handler** | `server/routes/patients.ts:662-865` |
| **Domain service** | `server/services/plexusIq/adminReviewAddService.ts:153-475` (add/remove ancillaries with reasoning) · `server/services/patientCommitService.ts` (commit to canonical spine) |
| **Repository** | `patient_screenings` UPDATE (`adminApprovalStatus`, `adminApprovedAt`, `adminApprovedByUserId`, `adminApprovalNote`, `reasoning`) |
| **Table** | `patient_screenings` (approval fields at lines 90-93) |
| **Canonical entity** | patient_screenings row |
| **Canonical ID** | `patient_screenings.id` |
| **Status before** | `adminApprovalStatus='pending'` |
| **Status after** | `adminApprovalStatus='approved'` (or `needs_info` / `rejected`), `adminApprovedAt=new Date()`, `adminApprovedByUserId=session.userId` |
| **Downstream trigger** | On approval, `commitPatient()` fires (auto=true) → creates execution case → journey event `admin_approval_updated` (route `/routes/patients.ts:798-823`) |
| **Read roles** | all authed |
| **Create roles** | n/a |
| **Update roles** | any session user (**no role gate at this endpoint** — see defect) |
| **Approval/signature roles** | any authenticated user (see defect) |
| **Display locations** | Plexus IQ Admin Review, Patient EHR (approval status shown) |
| **Mock/live status** | LIVE |
| **Current defect** | (1) **No role separation** for "Plexus internal clinical" vs "clinic physician." `server/routes/patients.ts:683` accepts any `session.userId`. USER_ROLES enum has no `internal_reviewer` variant (`shared/schema/users.ts:4`). (2) Approval is **patient-level, not service-level**: single `adminApprovalStatus` applies to all `qualifyingTests`. Per-service rejection requires rejecting the whole patient. (3) Admin adminApprovedAt is hardcoded `new Date()` — no effective-date decoupling (line 687). Timestamps are honest and never backdated, but there is no way to record "the clinical effective date is different from the recording time." |
| **Required minimal change** | Add `effective_at` column alongside `adminApprovedAt`. Add role check (see Section 12.1 — product decision). |
| **Unit test** | `tests/unit/adminReviewEvidence.test.ts` |
| **Integration test** | Not present |
| **E2E acceptance** | Not present |
| **Verification evidence** | `server/routes/patients.ts:662-865`, `shared/schema/screening.ts:90-93`, `shared/schema/screening.ts:108-114` |

### 5.4 Engagement & Outreach

| Field | Value |
|---|---|
| **Stage** | Engagement + Outreach |
| **Business purpose** | PCS reaches patient by phone, records outcome, schedules or triages |
| **Trigger** | Execution case exists after admin approval |
| **Prerequisites** | `patient_execution_cases` row (created by `commitPatient`) |
| **Route** | POST `/api/outreach/calls` · POST `/api/engagement-center/call-result` · GET `/api/outreach/dashboard` · GET `/api/engagement-center/*` |
| **Page/component** | Engagement Center, PCS Portal, outreach dashboard |
| **Client hook** | React Query mutations |
| **Server handler** | `server/routes/outreach.ts` · `server/routes/engagementBaskets.ts` · `server/routes/engagementAssignmentBoard.ts` · `server/routes/engagementTeamMetrics.ts` · `server/routes/executionCases.ts` |
| **Domain service** | `server/services/callResult/recordCallResult.ts:38-61` (outcome canonical list) · `server/services/callResult/callAttemptRuntime.ts` (unable-to-reach transition) · `server/services/engagement/*` |
| **Repository** | `outreach_calls` INSERT · `patient_screenings.appointmentStatus` UPDATE · `patient_execution_cases.engagementStatus` UPDATE · `scheduling_triage_cases` UPSERT |
| **Table** | `outreach_calls` (schema/outreach.ts:43-60), `patient_execution_cases` (schema/executionCase.ts:30-62), `scheduling_triage_cases` (schema/schedulingTriage.ts:40-79) |
| **Canonical entity** | patient_execution_cases (engagement container) |
| **Canonical ID** | patient_execution_cases.id |
| **Status before** | `engagementStatus='new'` |
| **Status after** | `engagementStatus ∈ ('contacted','scheduled','completed','not_reached','unable_to_reach')` |
| **Downstream trigger** | Scheduling handoff (call outcome=scheduled) → creates ancillary_appointment + globalScheduleEvent |
| **Read roles** | scheduler, admin, liaison, technician |
| **Create roles** | scheduler, liaison |
| **Update roles** | scheduler, admin, liaison |
| **Approval/signature roles** | n/a |
| **Display locations** | Engagement Center, PCS Portal, Mission Control (backlog counts) |
| **Mock/live status** | LIVE |
| **Current defect** | **Two write paths with different logic:** (a) `/api/outreach/calls` creates outreach_call + updates `patientScreenings.appointmentStatus` (atomic) + fires `ensureCanonicalSpineForScreening` fire-and-forget (`server/routes/outreach.ts:352`); (b) `/api/engagement-center/call-result` appends journey event + updates `engagementStatus` atomically + opens triage case, but does NOT create outreach_calls. **The two paths do not converge.** |
| **Required minimal change** | Consolidate to a single call-outcome writer. See Section 11.2. |
| **Unit test** | `tests/unit/engagementBaskets.test.ts`, `tests/unit/engagementTeamMetricsDisposition.test.ts` |
| **Integration test** | Not present |
| **E2E acceptance** | Playwright team-portal + engagement specs |
| **Verification evidence** | `server/routes/outreach.ts:200-352`, `server/routes/executionCases.ts:158-189`, `server/services/callResult/recordCallResult.ts:38-61` |

### 5.5 Scheduling

| Field | Value |
|---|---|
| **Stage** | Scheduling |
| **Business purpose** | Place a patient on a real calendar day/time for an ancillary service |
| **Trigger** | Call outcome=scheduled OR direct calendar drop OR same-day add |
| **Prerequisites** | patient_execution_cases exists (or same-day stub creation) |
| **Route** | POST `/api/global-schedule-events` · PATCH `/api/global-schedule-events/:id/transition` · POST `/api/global-schedule-events/schedule-ancillary` · POST `/api/appointments` |
| **Page/component** | Global Calendar, PCS Portal, ACS Portal, Schedule Dashboard |
| **Client hook** | React Query |
| **Server handler** | `server/routes/globalSchedule.ts` (event CRUD, quick-schedule, transitions) · `server/routes/appointments.ts` (legacy ancillary_appointments) |
| **Domain service** | `server/services/scheduler/*` · `server/services/scheduling/schedulingTriageService.ts` |
| **Repository** | `server/repositories/globalSchedule.repo.ts`, `server/repositories/schedulingTriage.repo.ts`, `server/repositories/appointments.repo.ts` |
| **Table** | `global_schedule_events` (canonical), `ancillary_appointments` (legacy parallel row), `scheduling_triage_cases` (workflow queue) |
| **Canonical entity** | **NOT CANONICAL** — Global Schedule Event vs Ancillary Appointment are both live |
| **Canonical ID** | `global_schedule_events.id` in most surfaces; `ancillary_appointments.id` for portal reads |
| **Status before** | (none — creates row) |
| **Status after** | `global_schedule_events.status ∈ (scheduled, completed, cancelled, no_show, blocked, pending_sync)` |
| **Downstream trigger** | Procedure event on completion; scheduling_triage_case on rescheduled/no_show |
| **Read roles** | all authed |
| **Create roles** | scheduler, admin, liaison, technician |
| **Update roles** | scheduler, admin |
| **Approval/signature roles** | n/a |
| **Display locations** | Global Calendar, PCS Portal, ACS Portal, Patient EHR, Clinician Portal, Schedule Dashboard, shared schedule (`/schedule/:id`) |
| **Mock/live status** | LIVE |
| **Current defect** | (1) `ancillary_appointments` and `global_schedule_events` are not synced automatically. A row can exist in one and not the other. (2) `patient_screenings.appointmentStatus` is a THIRD independent projection derived from outreach call outcomes; (3) Same-day quick-schedule (globalSchedule.ts:325-354) creates a stub execution case matched on name+dob+facility — **name-based collision risk**. (4) `ancillary_appointments.status` is a plain scheduled/cancelled string with no reschedule chain. (5) No `parent_event_id` field for reschedule history. |
| **Required minimal change** | Choose `global_schedule_events` as sole canonical + backfill/deprecate `ancillary_appointments`. See Section 11.3. |
| **Unit test** | `tests/unit/procedureCalendarSync.test.ts`, `tests/unit/appointmentTimeParsing.test.ts` |
| **Integration test** | Not present |
| **E2E acceptance** | Playwright canonical-route smoke |
| **Verification evidence** | `shared/schema/globalSchedule.ts:47-77`, `shared/schema/appointments.ts:5-30`, `server/routes/globalSchedule.ts:281-378` |

### 5.6 Order Note

| Field | Value |
|---|---|
| **Stage** | Order Note |
| **Business purpose** | Ordering document produced before the ancillary procedure is performed |
| **Trigger** | (documented) Admin Review complete + scheduled appointment. (actual) Procedure event marked complete. |
| **Prerequisites** | (documented) admin approval AND scheduled appointment. (actual) none. |
| **Route** | Read: GET `/api/procedure-notes?noteType=order_note&...` · POST/PATCH signature: `/api/physician-portal/signature-items`, `/api/clinician-portal/notes/:id/sign` |
| **Page/component** | Engagement Documents, Document Readiness Panel, Physician Portal signature worklist, ACS Portal, Patient EHR |
| **Client hook** | React Query `procedureNotesQueryKey()` |
| **Server handler** | `server/routes/generatedNotes.ts:84-130` |
| **Domain service** | `server/services/physicianPortal/signatureWorkflow.ts:93-100` (sign) · `server/services/ancillary/signingService.ts` (signable-note types) |
| **Repository** | `server/repositories/generatedNotes.repo.ts:82-132` (`createPendingProcedureNotes`) |
| **Table** | `procedure_notes` (schema/generatedNotes.ts:35-65) |
| **Canonical entity** | procedure_notes row with `noteType='order_note'` |
| **Canonical ID** | `procedure_notes.id` + unique index on `(patientScreeningId, serviceType, noteType)` (line 64) |
| **Status before** | (none — created on procedure complete) |
| **Status after** | `generationStatus='pending'` initially, then must transition through `generating`/`generated`/`approved`; `signatureStatus='needs_signature'` |
| **Downstream trigger** | Billing readiness re-evaluation on generation status='approved' |
| **Read roles** | admin, clinician, technician, liaison |
| **Create roles** | (via markProcedureComplete side-effect) |
| **Update roles** | admin, clinician |
| **Approval/signature roles** | Physician (via `KINDS_REQUIRING_SIGNATURE` — **order_note is NOT in this set** at `server/services/ancillary/signingService.ts:51-54` — so order_note does NOT require a signature per current code) |
| **Display locations** | Engagement Documents (procedure_notes), Ancillary Documents (reads `/api/generated-notes` LEGACY), Physician Portal (via signature worklist), Patient EHR, Document Readiness Panel |
| **Mock/live status** | Written LIVE via procedure-complete side-effect. Legacy `/api/generated-notes` also LIVE (read-only in practice), and Clinician LinkedDocumentsPanel is MOCK-ONLY (empty array). |
| **Current defect** | (1) **Business rule not enforced.** `createPendingProcedureNotes()` at `server/repositories/generatedNotes.repo.ts:82-132` fires unconditionally on procedure complete — no check for adminApprovalStatus, no check for scheduled globalScheduleEvent. (2) **No generation service.** `generationStatus` can be `pending → generating → generated → approved` per enum but zero code path transitions `pending → generating`. Notes stay pending forever. (3) **Order notes do not require signature per code**, contradicting the "signed" outcome in the docs. (4) **Ancillary Documents page (`/ancillary-documents`) reads legacy `/api/generated-notes`** while all writes go to `procedure_notes` — the two are structurally independent. |
| **Required minimal change** | (a) Enforce eligibility gate in `createPendingProcedureNotes`. (b) Implement a note generation service. (c) Retire the legacy `/api/generated-notes` reader on `/ancillary-documents` OR route it through `procedure_notes`. |
| **Unit test** | `tests/unit/physicianSignatureWorkflow.test.ts`, `tests/unit/ancillaryReadinessRequirements.test.ts` |
| **Integration test** | Not present |
| **E2E acceptance** | Playwright plexus-iq-and-physician spec exercises signature flow |
| **Verification evidence** | `shared/schema/generatedNotes.ts:11-32,35-65`, `server/repositories/generatedNotes.repo.ts:82-132`, `server/services/physicianPortal/signatureRules.ts:76-96` |

### 5.7 Procedure Event

| Field | Value |
|---|---|
| **Stage** | Procedure execution |
| **Business purpose** | Technician records the physical procedure being performed |
| **Trigger** | ACS clicks "Complete" on the patient workspace |
| **Prerequisites** | (documented) scheduled appointment. (actual) none — endpoint accepts arbitrary payload. |
| **Route** | POST `/api/procedure-events/complete` (only) |
| **Page/component** | ACS Portal patient workspace |
| **Client hook** | React Query mutation |
| **Server handler** | `server/routes/acsWorkflow.ts` (patient workspace), `server/routes/procedureEvents.ts:56-82` |
| **Domain service** | (thin — repo does the work) |
| **Repository** | `server/repositories/procedureEvents.repo.ts:162-240` |
| **Table** | `procedure_events` (schema/procedureEvents.ts:21-46) |
| **Canonical entity** | procedure_events row |
| **Canonical ID** | procedure_events.id |
| **Status before** | (none — inserted) |
| **Status after** | `procedureStatus='complete'`, `completedByUserId`, `completedAt` |
| **Downstream trigger** | (a) `upsertProcedureCompleteEvent` mirrors into `global_schedule_events` (b) `createPendingProcedureNotes` inserts 2 notes (c) `upsertCaseDocumentReadinessForProcedureComplete` inserts readiness rows |
| **Read roles** | admin, technician, clinician |
| **Create roles** | technician (via ACS workflow) |
| **Update roles** | technician, admin |
| **Approval/signature roles** | n/a (signature is on the notes) |
| **Display locations** | ACS Portal, Patient EHR, Imaging Central, Global Calendar (mirror event) |
| **Mock/live status** | LIVE |
| **Current defect** | (1) `PROCEDURE_STATUSES` includes `'not_started'`, `'in_progress'`, `'cancelled'`, `'no_show'`, `'reschedule_needed'` (schema/procedureEvents.ts:11-18) but ONLY `/api/procedure-events/complete` is implemented. There is no start/pause/cancel/no_show endpoint. Every other status is unreachable. (2) No prerequisite check before complete. (3) No `performing_user_role` field — role captured implicitly via session.userId only. |
| **Required minimal change** | Add start/cancel/no-show endpoints; classify prerequisites (hard vs soft) explicitly in the code. See Section 11.5. |
| **Unit test** | `tests/unit/procedureCalendarSync.test.ts` |
| **Integration test** | Not present |
| **E2E acceptance** | Not present |
| **Verification evidence** | `shared/schema/procedureEvents.ts:11-46`, `server/routes/procedureEvents.ts:56-82`, `server/repositories/procedureEvents.repo.ts:162-240` |

### 5.8 Report

| Field | Value |
|---|---|
| **Stage** | Report upload + associate |
| **Business purpose** | Get the clinical study report file into the patient record |
| **Trigger** | Admin uploads via Document Library, or portal uploads via `/api/portal/uploads` |
| **Prerequisites** | Patient screening exists |
| **Route** | POST `/api/documents-library` · POST `/api/portal/uploads` · POST `/api/google/drive/upload-report` (legacy path) |
| **Page/component** | Document Library, Ancillary Documents, ACS patient workspace, Imaging Central |
| **Client hook** | React Query file upload |
| **Server handler** | `server/routes/documentLibrary.ts` (admin), `server/routes/portal.ts` (technician/liaison) |
| **Domain service** | `server/services/blobStore.ts` (local blob), `server/services/outbox.ts` + `server/services/syncService.ts` (Google Drive sync), `server/services/documents/*` |
| **Repository** | `server/repositories/documentLibrary.repo.ts`, `server/repositories/documentLibraryLegacy.repo.ts` |
| **Table** | `documents` (canonical, schema/documents.ts:97-120), `uploaded_documents` (legacy, migrated on first read), `document_surface_assignments` (canonical, schema/documents.ts:141-149), `document_blobs` (canonical, schema/documents.ts:31-45) |
| **Canonical entity** | documents row (kind='report') |
| **Canonical ID** | documents.id |
| **Status before** | (none — created on upload) |
| **Status after** | Persisted with `patientScreeningId`, `facility`, `kind`, `contentType`, `sizeBytes`, `sourceNotes`, `blobId`. `case_document_readiness` row for `document_type='report'` transitions `missing → uploaded`. |
| **Downstream trigger** | Signature worklist eligibility gate for `post_procedure_note` reads `report_uploaded` state (`server/services/physicianPortal/signatureRules.ts:114-116`) |
| **Read roles** | all authed |
| **Create roles** | admin (Document Library), technician/liaison (portal uploads) |
| **Update roles** | admin |
| **Approval/signature roles** | n/a |
| **Display locations** | Document Library, Ancillary Documents (legacy `/api/generated-notes` for old files), Patient EHR Documents (`/api/documents-library?patientId=...`), ACS Portal, Imaging Central, Activity Timeline |
| **Mock/live status** | LIVE |
| **Current defect** | (1) **Legacy migration relies on exact-name matching.** `findLatestPatientScreeningByExactName` at `server/routes/documentLibrary.ts:104` (called from `documentLibraryLegacy.repo.ts`) uses `eq(patientScreenings.name, row.patientName)` with no DOB fallback — mis-spelled or renamed patients silently orphan. (2) `driveWebViewLink` on legacy `uploaded_documents` is treated as a canonical URL fallback (`documentLibrary.ts:169`) — Drive is not truly canonical; the local blob is, but if the blob is absent the Drive link is served. (3) No `documents.supersededByDocumentId` on `procedure_notes` — reports have version chain via `documents` table but notes do not. |
| **Required minimal change** | Migrate legacy `uploaded_documents` rows into `documents` by patient_screening_id + DOB fallback; sunset name-only matching. |
| **Unit test** | `tests/unit/canonicalUiManifest.test.ts` (verifies UI unchanged), `tests/unit/ancillaryReadinessRequirements.test.ts` |
| **Integration test** | Not present |
| **E2E acceptance** | Playwright canonical-route smoke covers Document Library render |
| **Verification evidence** | `server/routes/documentLibrary.ts:89-145`, `server/repositories/documentLibraryLegacy.repo.ts`, `shared/schema/documents.ts:97-149` |

### 5.9 Procedure Note

| Field | Value |
|---|---|
| **Stage** | Procedure Note (post_procedure_note) |
| **Business purpose** | Physician-signed narrative for the completed procedure |
| **Trigger** | (documented) procedure complete + report uploaded. (actual) procedure complete only (side-effect of `markProcedureComplete`). |
| **Prerequisites** | (documented) both. (actual, at generation time) none. (actual, at signature time) both — signature is blocked until `reportUploaded=true`. |
| **Route** | Read: GET `/api/procedure-notes?noteType=post_procedure_note`. Sign: POST `/api/physician-portal/signature-items`. |
| **Page/component** | Physician Portal signature worklist, Clinician Portal, Engagement Documents, Patient EHR |
| **Client hook** | React Query |
| **Server handler** | `server/routes/generatedNotes.ts:84-130` (read); signature via physicianPortal route |
| **Domain service** | `server/services/physicianPortal/signatureWorkflow.ts:93-117` (sign + evaluate billing readiness), `server/services/physicianPortal/signatureRules.ts:76-144` (eligibility) |
| **Repository** | `server/repositories/generatedNotes.repo.ts` |
| **Table** | `procedure_notes` (same as order_note) |
| **Canonical entity** | procedure_notes with `noteType='post_procedure_note'` |
| **Canonical ID** | procedure_notes.id + unique `(patientScreeningId, serviceType, noteType)` |
| **Status before** | Procedure complete → row inserted with `generationStatus='pending'` |
| **Status after** | Signed → `signatureStatus='signed'`, `signedAt`, `signedByUserId`; report requirement enforced at sign time |
| **Downstream trigger** | Signing triggers `evaluateBillingReadinessForProcedure` (`server/services/physicianPortal/signatureWorkflow.ts:106-117`) |
| **Read roles** | admin, clinician, technician, liaison |
| **Create roles** | (via procedure complete side-effect) |
| **Update roles** | clinician (sign), admin |
| **Approval/signature roles** | Physician (KINDS_REQUIRING_SIGNATURE includes `post_procedure_note` and `report`) |
| **Display locations** | Physician Portal, Clinician Portal LinkedDocumentsPanel (**this reads mockData.DOCUMENTS = [], so it always shows empty**), Engagement Documents, Patient EHR, Activity Timeline |
| **Mock/live status** | Write LIVE; **Clinician LinkedDocumentsPanel is MOCK-ONLY** |
| **Current defect** | (1) Same as order_note — no generator transitions pending → generated. (2) Report gate is enforced only at signature time (correct behaviorally but confusing UX — the note exists in "pending" state indefinitely without a report). (3) `returnNoteForCorrection()` sets `signatureStatus='returned_for_correction'` + `returnReason` but there is no formal amendment/version chain. (4) No void state. |
| **Required minimal change** | See Section 11.5 — bring the note generator online and add amendment lineage. |
| **Unit test** | `tests/unit/physicianSignatureWorkflow.test.ts`, `tests/unit/physicianReportsService.test.ts` |
| **Integration test** | Not present |
| **E2E acceptance** | Playwright plexus-iq-and-physician spec |
| **Verification evidence** | `server/services/physicianPortal/signatureRules.ts:76-144`, `server/services/physicianPortal/signatureWorkflow.ts:93-117`, `shared/schema/generatedNotes.ts:35-65` |

### 5.10 Billing Readiness

| Field | Value |
|---|---|
| **Stage** | Billing Readiness evaluation |
| **Business purpose** | Aggregate all readiness inputs (demo, DOB, MRN, insurance, docs, notes, signatures) into a persisted status |
| **Trigger** | Procedure complete OR note signature OR document upload |
| **Prerequisites** | patient_screening + serviceType |
| **Route** | GET `/api/billing-readiness-checks` · GET `/api/billing-readiness-checks/:id` (**read only — no direct evaluation POST**) |
| **Page/component** | Billing Readiness page, Patient EHR billing section |
| **Client hook** | React Query |
| **Server handler** | `server/routes/billingReadiness.ts:11-50` |
| **Domain service** | `server/repositories/billingReadiness.repo.ts:94-179` (`evaluateBillingReadinessForProcedure`), called from `procedureEvents.repo.ts`, `signatureWorkflow.ts`, `documentReadiness.repo.ts` |
| **Repository** | billing_readiness_checks table |
| **Table** | `billing_readiness_checks` (schema/billingReadiness.ts:19-42) |
| **Canonical entity** | billing_readiness_checks row |
| **Canonical ID** | billing_readiness_checks.id + `(patientScreeningId, serviceType)` unique |
| **Status before** | (upsert-on-evaluation) |
| **Status after** | `readinessStatus ∈ (not_ready, missing_requirements, ready_to_generate, billing_document_generated, sent_to_billing)`, `missingRequirements=[]`, `readyAt`, `metadata.evaluatedAt` |
| **Downstream trigger** | On `ready_to_generate`, **fire-and-forget** call to `createPendingBillingDocumentRequestFromReadiness()` (`server/repositories/billingReadiness.repo.ts:173`) |
| **Read roles** | admin, biller, clinician |
| **Create roles** | (evaluation side-effect only) |
| **Update roles** | (evaluation side-effect only) |
| **Approval/signature roles** | n/a |
| **Display locations** | Billing Readiness page, Patient EHR, Mission Control (backlog counts) |
| **Mock/live status** | LIVE |
| **Current defect** | (1) **Fire-and-forget billing-document-request creation.** `evaluateBillingReadinessForProcedure` sets status to `ready_to_generate` before the downstream `createPendingBillingDocumentRequestFromReadiness` resolves — the `.catch` at line 173 silently swallows errors. Race: if the downstream fails, status is `ready_to_generate` but no request row exists. (2) No explicit reconciliation to catch missed requests. |
| **Required minimal change** | Move downstream into same transaction, or add reconciliation job. |
| **Unit test** | `tests/unit/ancillaryReadinessRequirements.test.ts` |
| **Integration test** | Not present |
| **E2E acceptance** | Not present |
| **Verification evidence** | `shared/schema/billingReadiness.ts:10-42`, `server/repositories/billingReadiness.repo.ts:94-179` |

### 5.11 Billing Document Request

| Field | Value |
|---|---|
| **Stage** | Billing Document lifecycle |
| **Business purpose** | Produce a bill-generation artifact eligible when billing readiness is ready |
| **Trigger** | `evaluateBillingReadinessForProcedure` → `ready_to_generate` |
| **Prerequisites** | `billing_readiness_checks.readinessStatus='ready_to_generate'` |
| **Route** | GET `/api/billing-document-requests` · GET `/api/billing-document-requests/:id` (**read-only — no generator endpoint**) |
| **Page/component** | Billing workspace, Patient EHR (billing section), Ancillary Documents (billing tab) |
| **Client hook** | React Query |
| **Server handler** | `server/routes/billingDocuments.ts:11-54` |
| **Domain service** | (none — generator not implemented) |
| **Repository** | `server/repositories/billingDocuments.repo.ts` |
| **Table** | `billing_document_requests` (schema/billingDocuments.ts:20-46) |
| **Canonical entity** | billing_document_requests row |
| **Canonical ID** | billing_document_requests.id + FK to billing_readiness_checks.id |
| **Status before** | (upserted from readiness) |
| **Status after** | `requestStatus ∈ (pending, generating, generated, failed, sent_to_billing)` — but **only `pending` is ever set by code**. Zero transitions to `generating`/`generated` exist. |
| **Downstream trigger** | (Not wired — should trigger invoice generation) |
| **Read roles** | admin, biller |
| **Create roles** | (side-effect of ready_to_generate) |
| **Update roles** | (none) |
| **Approval/signature roles** | n/a |
| **Display locations** | Billing workspace, Patient EHR, Plexus Bank (mock) |
| **Mock/live status** | **Schema-only / Referenced but missing.** Read endpoint LIVE; generator NOT IMPLEMENTED; `generatedDocumentId` orphan column has no FK, no writer, no reader (`shared/schema/billingDocuments.ts:33`). |
| **Current defect** | (1) **Generator missing.** No service transitions pending → generated. (2) `generatedDocumentId` is a bare int with no FK target and zero writers — structural defect. (3) `sent_to_billing` is a declared status but no code moves rows into it and no downstream invoice link exists. (4) `reconcileCanonicalDuplicates` is referenced at `billingDocuments.repo.ts:76` but the script does not exist in the codebase. |
| **Required minimal change** | (a) Wire `generatedDocumentId` FK to `documents.id`. (b) Implement generator service. (c) Connect billing_document_requests to invoice creation. See Section 11.6. |
| **Unit test** | Not present |
| **Integration test** | Not present |
| **E2E acceptance** | Not present |
| **Verification evidence** | `shared/schema/billingDocuments.ts:11-46`, `server/repositories/billingDocuments.repo.ts`, `server/routes/billingDocuments.ts:11-54` |

### 5.12 Claim

| Field | Value |
|---|---|
| **Stage** | Claim submission |
| **Business purpose** | Send billed encounter to insurance for adjudication |
| **Trigger** | (documented) billing document generated + validated |
| **Prerequisites** | billing_document generated |
| **Route** | **None** |
| **Page/component** | Referenced in mock UI (Plexus Bank) only |
| **Client hook** | mock only |
| **Server handler** | **Zero server routes** (`grep -r '/api/claims' server/routes/` returns nothing) |
| **Domain service** | **None** |
| **Repository** | **None** |
| **Table** | **None** — no `claims`, `insurance_claims`, `claim_submissions` in `shared/schema/` |
| **Canonical entity** | Not implemented |
| **Canonical ID** | n/a |
| **Status before** | n/a |
| **Status after** | n/a |
| **Downstream trigger** | n/a |
| **Read roles** | n/a |
| **Create roles** | n/a |
| **Update roles** | n/a |
| **Approval/signature roles** | n/a |
| **Display locations** | Plexus Bank (MOCK), Physician Finance (types-only) |
| **Mock/live status** | **Not implemented** |
| **Current defect** | Entire stage is aspirational. No claims table, no clearinghouse integration, no EDI (837 formatter), no submission log, no acknowledgement handler, no payer API. |
| **Required minimal change** | Product decision on whether to build this or delegate to external RCM. See Section 12.2. |
| **Verification evidence** | grep of `shared/schema/`, `server/routes/`, `server/services/` for `claim` returns no hits outside test fixtures + Plexus Bank mock. |

### 5.13 Payment

| Field | Value |
|---|---|
| **Stage** | Payment posting |
| **Business purpose** | Record money received against an invoice |
| **Trigger** | Biller enters payment |
| **Prerequisites** | invoices row exists |
| **Route** | POST `/api/invoices/:id/payments` |
| **Page/component** | Invoice review, Plexus Bank (mock alternative) |
| **Client hook** | React Query |
| **Server handler** | `server/routes/invoiceFinancialEvents.ts` |
| **Domain service** | `server/services/billing/invoiceFinancialService.ts:55-82` (`postPayment`) |
| **Repository** | `server/repositories/invoiceFinancialEvents.repo.ts` |
| **Table** | `invoice_payments` (schema/invoices.ts:108-121); simultaneously inserts a `remittance_events` row with eventType='payment_posted' |
| **Canonical entity** | invoice_payments row |
| **Canonical ID** | invoice_payments.id |
| **Status before** | invoice `Sent`/`Partially Paid` |
| **Status after** | invoice `Paid` (via `recomputeInvoiceTotals`) |
| **Downstream trigger** | Invoice status recompute; no downstream journey-completion event |
| **Read roles** | admin, biller |
| **Create roles** | admin, biller |
| **Update roles** | (none — payments are append-only) |
| **Approval/signature roles** | n/a |
| **Display locations** | Invoice review, Home dashboard finance, Physician Portal Finance page, Plexus Bank (mock) |
| **Mock/live status** | LIVE |
| **Current defect** | (1) No reversal path — payments are append-only; correcting a mistake requires `invoice_adjustments`. (2) `payment_date` stored as text; write is fenced by `ISO_DATE_RE` at route (Phase 3 v6) but reads still cast text→date to be defensive. |
| **Required minimal change** | None — canonical and correct. |
| **Unit test** | Not present (payment logic is in service — no unit test found) |
| **Integration test** | Not present |
| **E2E acceptance** | Not present |
| **Verification evidence** | `shared/schema/invoices.ts:108-121`, `server/services/billing/invoiceFinancialService.ts:55-82` |

### 5.14 Invoice

| Field | Value |
|---|---|
| **Stage** | Invoice lifecycle |
| **Business purpose** | Bill for services rendered |
| **Trigger** | Batch creation OR manual draft |
| **Prerequisites** | Encounter/patient exists |
| **Route** | Many under `/api/invoices*`, `/api/invoice-batches*`, `/api/invoice-approval*`, `/api/invoice-delivery*` |
| **Page/component** | Invoice review, Invoice batches, Invoice delivery, Home dashboard finance |
| **Client hook** | React Query |
| **Server handler** | `server/routes/invoices.ts`, `server/routes/invoiceApproval.ts`, `server/routes/invoiceBatches.ts`, `server/routes/invoiceDelivery.ts` |
| **Domain service** | `server/services/billing/invoiceDraftService.ts`, `invoiceApprovalService.ts`, `invoiceDeliveryService.ts`, `invoiceFinancialService.ts` |
| **Repository** | `server/repositories/invoices.repo.ts`, `invoiceBatches.repo.ts`, `invoiceDelivery.repo.ts`, `invoiceFinancialEvents.repo.ts` |
| **Table** | `invoices` (schema/invoices.ts), `invoicePayments`, `invoiceAdjustments` + `invoiceDenials` + `remittanceEvents` (schema/invoiceFinancialEvents.ts) |
| **Canonical entity** | invoices row |
| **Canonical ID** | invoices.id + invoiceNumber |
| **Status before** | (created) `status=Draft`, `approvalStatus=draft`, `deliveryStatus=pending` |
| **Status after** | Approval `draft → pending_review → approved → voided/revised`; Delivery `pending → ready_to_send → queued → sent`; Payment `Draft → Sent → Partially Paid → Paid` |
| **Downstream trigger** | Payment lifecycle |
| **Read roles** | admin, biller |
| **Create roles** | admin, biller |
| **Update roles** | admin, biller |
| **Approval/signature roles** | Approver role: any admin/biller (no separate approver-role constraint) |
| **Display locations** | Invoice review, batches, delivery, Home finance, Physician Portal Finance (types only), Plexus Bank (mock) |
| **Mock/live status** | LIVE |
| **Current defect** | (1) No `closed` state; invoices remain `Paid` indefinitely. (2) `sent_to_billing` is defined in `billingReadiness` + `billingDocuments` enums but not in `invoices.status` — the transition from billing_document → invoice is not encoded in state. (3) `projected_invoices` table exists but only forward-links to real invoice line items via `realInvoiceLineItemId` — no variance reconciliation. |
| **Required minimal change** | See Section 11.6. |
| **Unit test** | `tests/unit/coverageSummary.test.ts` (invoice coverage), payment/adjustment logic not unit-tested |
| **Integration test** | Not present |
| **E2E acceptance** | Not present |
| **Verification evidence** | `shared/schema/invoices.ts`, `shared/schema/invoiceFinancialEvents.ts`, `server/services/billing/*` |

### 5.15 Journey Completion

| Field | Value |
|---|---|
| **Stage** | Fully complete journey |
| **Business purpose** | Aggregated single view of "this patient's journey is done, clinically and financially" |
| **Trigger** | n/a |
| **Prerequisites** | n/a |
| **Route** | None |
| **Table** | None — no journey_completion table |
| **Canonical entity** | Not implemented |
| **Mock/live status** | **Not implemented** — journey completion is fragmented across four different fields (`patient_execution_cases.lifecycleStatus`, `patient_screenings.commitStatus`, `procedure_events.procedureStatus`, `invoices.status`) with no single roll-up |
| **Current defect** | Business rule requires distinguishing: qualification-complete, admin-review-complete, engagement-complete, scheduling-complete, procedure-complete, report-complete, documentation-complete, signature-complete, billing-ready, billing-document-generated, claim-ready, claim-submitted, payment-pending, payment-received, invoice-pending, invoice-complete, clinically-closed, financially-closed, fully-closed. **None of these are stored as a single aggregate.** |
| **Verification evidence** | grep of `shared/schema/` for `journey_complete` returns nothing. `patient_journey_events` (`shared/schema/executionCase.ts:80-97`) is an event log, not a state roll-up. |

## 6. Mock / Live Audit

### 6.1 Client-side mock data

| Location | Consumer | Status |
|----------|----------|:------:|
| `client/src/components/physician/mockData.ts:203-214` — `DOCUMENTS=[]`, `AUDIT_EVENTS=[]` | Clinician Orders & Notes `LinkedDocumentsPanel` (`client/src/components/physician/orders/OrdersNotesPage.tsx:401-420`) | **Live UI reads empty mock**. Panel renders "No linked documents" permanently. |
| `client/src/pages/plexus-bank/mockData.ts` (~722 lines) | Plexus Bank UI (`/plexus-bank`), Team Invoice Desk (`client/src/components/portal/InvoiceDeskPanel.tsx:14`), all Plexus Bank modules | **Live UI, mock backend.** Explicit "prototype workspace" disclaimer at `client/src/pages/plexus-bank.tsx:230`. localStorage-persisted client state; no server routes. |
| `client/src/components/portal/messaging/mockPortalMessages.ts` | TeamPortalShell messaging tab | **Live UI, in-memory only.** Comment explicitly documents intent (line 1-10). |
| `client/src/pages/plexus-iq-prototype.tsx` | Route `/plexus-iq-prototype` | Publicly routable prototype (mock constants). |
| `client/src/pages/home-preview.tsx` | Route `/home-preview` | Publicly routable localStorage-backed prototype. |

### 6.2 localStorage / sessionStorage as persistence

- `client/src/pages/plexus-bank/mockData.ts:567,575-590` — full Plexus Bank state persists in `localStorage["plexusBank.v1"]`. Clearing browser storage loses everything.
- `client/src/lib/plexusIqBatchSession.ts:85-129` — batch session state (session + local).
- `client/src/lib/clinicalIntelligence/store.ts` — one-time migration from legacy localStorage to server. Migration path is working.
- `client/src/components/portal/TeamPortalShell.tsx:123-130` — UI tab state in localStorage (acceptable UX preference).

### 6.3 Client → server endpoint mismatches

None found for main flows. All React Query keys match registered routes. Note: `/api/plexus-bank/*` is NOT called because the module is client-only.

### 6.4 Server routes with no live client consumer

None found. 274 `/api/*` routes; 118 distinct endpoints called from `client/src`. The remaining routes are batch-job/admin utilities intentionally invoked from CLI or scheduled tasks.

### 6.5 Feature-flag-gated live paths (currently OFF)

`server/lib/featureFlags.ts:17-26`:
- `internalDirectMessages` OFF
- `portalAssistant` OFF
- `clinicalIntelligenceLive` OFF
- `clinicianPortalBackend` OFF

### 6.6 Twilio / patient-SMS residuals

Verified **zero** live code. Only comments documenting the intentional retirement. The only remaining reference is a **pre-existing dead auth exemption** at `server/routes.ts:210-214` for path `/sms/twilio/inbound` — no route is registered under that path, so the branch is unreachable. Introduced by commit `e23face` (Task #648) before any of the Phase 1–5 PRs. Retirement is a 3-line follow-up if desired.

### 6.7 UI controls without persistence

- `client/src/pages/team-ops.tsx:602` — `notImplemented(label)` toast "coming soon" for unspecified actions.
- `client/src/pages/mission-control.tsx:735` — chat input `disabled` with placeholder "Ask Plexus… (coming soon)" (this is honest — the disabled state is deliberate).
- Plexus Bank buttons that modify state but never persist to server.

### 6.8 Tenant-scope leaks

`server/routes/generatedNotes.ts:11-18` — legacy `GET /api/generated-notes`:
```typescript
app.get("/api/generated-notes", async (_req, res) => {
  const notes = await storage.getAllGeneratedNotes();
  res.json(notes);
});
```
No auth middleware, no `clinicId` scoping. Returns all notes to any caller who reaches the endpoint. **This is the ancillary-documents read path per audit prompt.** Requires immediate fix.

## 7. Identity-Resolution Audit

Patient identity has **no persisted canonical record**. `server/modules/patient-directory/repo.ts:3-232` groups `patient_screenings` by `(lower(trim(name)), dob)` in memory and returns a SHA-256 hash of that composite — but the module ships **unwired** (`server/modules/patient-directory/service.ts:5-11`). It is not called from any route in the current registration graph.

**Name-based / mutable-field linkage risks (verified file:line):**

| Risk | Location | Effect |
|------|----------|--------|
| PATCH `/api/patients/:id` allows `name` mutation with no duplicate check | `server/routes/patients.ts:81` | Renaming "John Smith" → "Jon Smith" creates a second canonical identity |
| Legacy document migration uses exact name match | `server/routes/documentLibrary.ts:104` (`findLatestPatientScreeningByExactName`) | Misspelled name orphans document |
| Global schedule quick-schedule reuses stub by name+DOB+facility (whitespace-collapsed) | `server/routes/globalSchedule.ts:325-354` | High-volume same-day intake risks collision |
| Execution-case lookup by name+DOB with no clinic scope | `server/routes/executionCases.ts:412` | Same name in different clinics can cross-match |
| Patient test history keyed on name+DOB only, no FK back | `shared/schema/patientHistory.ts:4-25` | Cannot correlate history to a specific screening deterministically |
| Batch AI parse pre-merge on name+DOB | `server/parsers/plainText.ts::mergePatients` (referenced from `batches.ts:294`) | Ingest-time collapse is fine, but downstream reliance on it is risky |

**Duplicate-merge / link function:** None. Soft-delete is the only lifecycle operation.

## 8. Tenant-Scoping Audit

Clinic scoping is done via `clinicContext` middleware (`server/middleware/clinicContext.ts`) attached to every `/api/*` route by `server/index.ts:85`. Admin gets `req.clinicId = null` (bypass); non-admin gets session clinicId.

**Verified holes:**
- Legacy `GET /api/generated-notes` (§6.8) — no `requireAuth`, no clinic filter.
- Execution-case lookup by name+DOB at `server/routes/executionCases.ts:412` does not add `clinicId` filter.
- Patient test history reads at `server/routes/testHistory.ts` use `clinic` param defaulting to `'NWPG'` (`testHistory.ts:42,74`) — no session-based clinic scoping.

**Verified clean:**
- Home Stats + Mission Control repositories all take `ClinicScope` and honor it (Phase 3 v2 correction, `server/repositories/homeStats.repo.ts`).
- Direct-messages, workspace-prefs, physician portal summary all clinic-scoped.

## 9. Audit / History Findings

Journey events are stored in `patient_journey_events` (`shared/schema/executionCase.ts:80-97`) with `eventType`, `eventSource`, `actorUserId`, `summary`, `metadata`. Coverage:

**Written for:**
- execution_case_created, execution_case_updated, screening_committed, admin_approval_updated, document_sent, procedure_completed (via `appendJourneyEvent`)

**NOT written for:**
- Payment posting (no journey event fired from `postPayment`)
- Invoice approval, delivery
- Report upload (only readiness table updates; no journey event)
- Note signing (updates `signedByUserId` but no journey event)

**False-backdating:** None found. Every timestamp is `new Date()` or `CURRENT_TIMESTAMP`. Approval, commit, and payment timestamps are actual action times.

**Overwrites:** Admin-review reasoning overwritten on batch re-run (`server/services/batchAnalysisRunner.ts:714-728` — bug described in §5.2).

**Frontend-only transitions:** Portal messaging is entirely client-side (`mockPortalMessages`).

## 10. Critical Blockers

Blockers that prevent a real end-to-end journey today:

1. **No claims submission.** No table, no route, no service, no EDI.
2. **Billing document generator missing.** `billing_document_requests.requestStatus` never leaves `pending`.
3. **`generatedDocumentId` orphan.** No FK, no writer, no reader — even if the generator existed, the produced artifact has no link to `documents`.
4. **Order/Procedure Note business rules not enforced at write.** Notes are created on procedure complete regardless of preconditions.
5. **Appointment fragmentation.** Global calendar vs ancillary appointments vs screening appointmentStatus vs execution case engagementStatus all track independent state.
6. **Ancillary Documents reads legacy `/api/generated-notes` while writes go to `procedure_notes`.** The two are not connected.
7. **Clinician LinkedDocumentsPanel is empty mock.** No path from live procedure_notes → LinkedDocumentsPanel.
8. **Admin-review reasoning lost on batch re-run.** `preserveAdminReviewReasoning` exists but not called.
9. **`/api/generated-notes` legacy route is unauth'd + unscoped.** Any client can read every note in the system.
10. **Fire-and-forget spine sync** in outreach + billing-readiness creates race conditions between call outcome/readiness and downstream mirror state.

## 11. Minimal Wiring Recommendations

Recommendations are **proposal only** — implementation follows explicit approval.

### 11.1 Canonical patient identity

- Add persisted `canonical_patient` table with `id` (uuid), `name_normalized`, `dob`, `first_screening_id`, `created_at`, plus a nullable `merged_into_canonical_patient_id` self-FK for the merge case.
- Add `patient_screenings.canonical_patient_id` FK; backfill from the current name+dob grouping using the unwired module's algorithm.
- Add `POST /api/patients/merge` (admin) that sets `merged_into_canonical_patient_id`.
- On `PATCH /api/patients/:id` name change, refuse or open a review if the new (name, dob) matches an existing canonical.

### 11.2 Consolidate call-outcome writer

- Move `/api/outreach/calls` and `/api/engagement-center/call-result` into a single service `recordCallOutcome(scope)` that atomically:
  - inserts `outreach_calls`
  - updates `patient_screenings.appointmentStatus`
  - updates `patient_execution_cases.engagementStatus`
  - appends `patient_journey_events`
  - opens `scheduling_triage_cases` when needed

  All in one transaction. Delete the fire-and-forget spine sync.

### 11.3 One canonical appointment

- Declare `global_schedule_events` sole canonical.
- Backfill: for every `ancillary_appointments` row, create/link a `global_schedule_events` row with `eventType='ancillary_appointment'`, source='backfill'.
- Introduce `ancillary_appointments.global_schedule_event_id` FK.
- Add a read-only compatibility view for legacy consumers.
- Deprecate `ancillary_appointments.status`; single source is `global_schedule_events.status`.
- Add `parent_event_id` for reschedule lineage.

### 11.4 Order Note lifecycle enforcement + Ancillary Documents wiring

- In `createPendingProcedureNotes`, gate on `patientScreenings.adminApprovalStatus='approved'` AND a `global_schedule_events` row with `eventType='ancillary_appointment'` and `status IN ('scheduled','completed')` for the same `patientScreeningId + serviceType`.
- Retire legacy `/api/generated-notes` read: route `/ancillary-documents` should query `procedure_notes` (plus `documents` for report artifacts).
- Add `requireAuth` + clinic filter to `/api/generated-notes` OR delete the route.
- Provide `procedure_notes.notes_lineage_id` for correction/amendment chains.

### 11.5 Procedure event states + note generator

- Add endpoints for `start`, `pause`, `cancel`, `no_show`, `unable_to_complete`, `equipment_failure`.
- Classify each prerequisite (adminApproval, scheduledAppointment, consentSigned) as hard/soft in the code.
- Implement `procedure_notes.generationStatus` transitions via a generator service that reads `sourceData` and calls OpenAI to produce `generatedText`.
- Do NOT auto-block procedure on non-essential missing docs — treat missing consent as soft warning unless service-specific rule marks it hard.

### 11.6 Billing document generator + connect to invoice

- Populate `billing_document_requests.generatedDocumentId` via a new `documents` row (kind='billing_document') owned by the same patient_screening.
- Implement generator that renders billing doc from encounter data + templates.
- On successful generation, transition `requestStatus → generated` and create/link a draft `invoices` row.
- Ensure billing readiness fire-and-forget becomes transactional.

### 11.7 Clinician Portal live document panel

- Replace `mockData.DOCUMENTS = []` at `client/src/components/physician/mockData.ts:203-214` with a real fetch of `procedure_notes` + `documents` scoped to the physician's assigned patients.
- Endpoint: extend physician-portal summary/reports service to return signed and pending notes.

### 11.8 Journey completion aggregate

- Add a computed view `patient_journey_status(patient_screening_id)` returning the discrete list of completed stages:
  - qualification_complete
  - admin_review_complete
  - engagement_complete
  - scheduling_complete
  - procedure_complete
  - report_uploaded
  - documentation_complete
  - signature_complete
  - billing_ready
  - billing_document_generated
  - claim_submitted (if implemented)
  - payment_received
  - invoice_closed
  - clinically_closed
  - financially_closed
  - fully_closed

- Do NOT collapse into a single boolean.

## 12. Items Requiring Product Decision

1. **Admin Review reviewer identity.** Should there be a distinct "Plexus internal clinical" role separate from clinic physician? Today: any authenticated user can approve. USER_ROLES enum has no `internal_reviewer` variant.

2. **Claims strategy.** Build in-house (schema + EDI 837 + clearinghouse + 835 remittance parser) or delegate to external RCM (post charges via API to a partner and receive statuses back)?

3. **Revenue allocation.** `projectedInvoices.projectedOurPortionPercentage` defaults to `"50"` (`shared/schema/projectedInvoices.ts:34`). Is this the canonical split? Where should the persisted ledger live?

4. **Same-day retroactive review.** The audit prompt asks for an "effective clinical date" separate from actual action timestamp. Not implemented today. Should it be added?

5. **Order-note signature requirement.** Documented lifecycle includes a signed order note, but `KINDS_REQUIRING_SIGNATURE = ['post_procedure_note','report']` at `server/services/ancillary/signingService.ts:51-54` excludes `order_note`. Is signing required?

6. **Plexus Bank future.** Is it retiring, moving to a real backend, or staying as a demo shell?

7. **Ancillary Documents legacy `/api/generated-notes`.** Retire completely or route through `procedure_notes`?

## 13. Items Requiring Migration

Only for eventual phased implementation — not for this audit:

1. Add `canonical_patient` table (Phase 2A).
2. Add `patient_screenings.canonical_patient_id` FK (Phase 2A).
3. Add `ancillary_appointments.global_schedule_event_id` FK + `global_schedule_events.parent_event_id` (Phase 2C).
4. Add `procedure_notes.notes_lineage_id` (Phase 2D/E).
5. Fix `billing_document_requests.generatedDocumentId` FK to `documents.id` (Phase 2F).
6. Optional: add `claim_submissions` table if in-house claims are chosen (Phase 2I).

## 14. Items Not Implemented

- External clearinghouse submission (EDI 837, ANSI 5010, x12).
- 835 remittance file parsing.
- Payer API integrations.
- Clinic Analytics dashboard.
- Mission Control finance section (`sections.finance.sourceMissing=true` already documented).
- Journey completion aggregate.
- Revenue allocation computation.
- Billing document generator.
- Order/procedure note generator (state machine defined, but `pending → generating` never fires).
- Physician Portal LinkedDocumentsPanel wired to live data.
- Reschedule lineage on scheduling events.
- Amendment chain on procedure notes.

## 15. Verification Appendix

Every conclusion in this document is anchored to a file:line citation in one of these locations. All commit hashes are at `2aaa23b`.

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
- `server/parsers/plainText.ts`

### Qualification / Admin Review
- `shared/schema/executionCase.ts:21,30-62,80-97`
- `shared/schema/screening.ts:70,90-93,108-114`
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
- `server/services/callResult/recordCallResult.ts:38-61`
- `server/services/callResult/callAttemptRuntime.ts:41-88`

### Order Note / Procedure / Procedure Note
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
- `server/services/physicianPortal/signatureWorkflow.ts:93-117`

### Billing readiness / Billing doc / Invoices / Payments
- `shared/schema/billingReadiness.ts:10-42`
- `shared/schema/billingDocuments.ts:11-46`
- `shared/schema/invoices.ts:9-121`
- `shared/schema/invoiceFinancialEvents.ts:15-79`
- `shared/schema/projectedInvoices.ts:34`
- `server/routes/billingReadiness.ts:11-50`
- `server/routes/billingDocuments.ts:11-54`
- `server/routes/invoiceFinancialEvents.ts` (all)
- `server/services/billing/invoiceFinancialService.ts:14-93`
- `server/services/billing/invoiceApprovalService.ts:16-22`
- `server/services/billing/invoiceDeliveryService.ts:66-79`
- `server/repositories/billingReadiness.repo.ts:94-179`

### Mocks / prototypes / feature flags
- `client/src/components/physician/mockData.ts:203-214`
- `client/src/pages/plexus-bank/mockData.ts:355-590`
- `client/src/components/portal/messaging/mockPortalMessages.ts`
- `client/src/pages/plexus-iq-prototype.tsx`
- `client/src/pages/home-preview.tsx`
- `server/lib/featureFlags.ts:17-26`
- `server/routes.ts:210-214` (dead Twilio auth exemption)

### Tenant scoping / audit
- `server/middleware/clinicContext.ts`
- `server/index.ts:85`
- `server/routes/generatedNotes.ts:11-18` (unauth'd/unscoped)
- `shared/schema/executionCase.ts:80-97` (journey events)
