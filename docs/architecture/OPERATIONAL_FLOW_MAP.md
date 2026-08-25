# Operational Flow Map

> **Scope:** Patient lifecycle on `main` (`88c0a1d`) derived from the
> approved platform audit + main-branch verification. The Phase 3
> Exception Intelligence stage is **branch-only** and called out
> separately; it is NOT part of the operating flow on `main`.

## 1. End-to-end flow (on main)

```
┌──────────────────────────────────────────────────────────┐
│  IMPORT (paste / CSV / Excel / PDF)                      │
│  → POST /api/batches + add patients                      │
│  → INSERT screening_batches + patient_screenings         │
│     status='pending', commitStatus='Draft',              │
│     adminApprovalStatus='pending'                        │
└──────────────────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│  AI QUALIFICATION                                        │
│  POST /api/batches/:id/analyze →                         │
│    server/services/batchAnalysisRunner.ts:47             │
│      → analysis_jobs row + background runAnalysisLoop    │
│        (concurrency: BATCH_ANALYSIS_CONCURRENCY, def 5)  │
│    For each patient: screenSinglePatientWithAI → write   │
│      qualifyingTests + reasoning, status='completed'     │
│    Then commitPatient(auto:true)                         │
└──────────────────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│  ADMIN REVIEW (per patient inside Plexus IQ)             │
│  AdminReviewDialog → POST /api/patient-screenings/:id    │
│                       /admin-approval                    │
│    server/routes/patients.ts:599                         │
│  approve  → adminApprovalStatus='approved'               │
│          + commitPatient(auto:true) (if Draft)           │
│          + journey event "admin_approval_updated"        │
│  reject   → 'rejected' only; no commit                   │
│  needs_info → 'needs_info' only; no commit               │
└──────────────────────────────────────────────────────────┘
                       │ (approve only)
                       ▼
┌─────────────────────────────────────────────────────────┐
│  commitPatient (patientCommitService.ts:61)             │
│  patient_screenings.commitStatus: Draft → Ready         │
│  fire-and-forget pipeline (lines 97-182):               │
│   1. createOrUpdateExecutionCaseFromScreening           │
│        → patient_execution_cases                        │
│   2. createGlobalScheduleEventFromScreeningCommit       │
│        → global_schedule_events (visits only,           │
│          NOT outreach)                                  │
│   3. createOrUpdateInsuranceEligibilityReviewFromScreen │
│   4. createOrUpdateCooldownRecordsFromScreening         │
│   5. appendPatientJourneyEvent                          │
│        screening_committed + execution_case_*           │
│   6. autoAssignSchedulerForExecutionCase                │
│        → scheduler_assignments                          │
└─────────────────────────────────────────────────────────┘
                       │
       ┌───────────────┴───────────────┐
       ▼                               ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│  ENGAGEMENT CENTER       │  │  SCHEDULER PORTAL        │
│  /engagement-center      │  │  /scheduler-portal       │
│  /api/engagement/        │  │  /api/outreach/dashboard │
│   assignment-board       │  │  per-scheduler call queue│
│  filter: lifecycleStatus │  │  source: scheduler_      │
│   ='active' AND          │  │   assignments +          │
│   engagementStatus NOT   │  │   outreach_schedulers    │
│   IN (archived,closed,   │  │   mapped by userId       │
│   cancelled,completed)   │  │  call disposition writes │
│  bulk assign POSTs to    │  │   via POST /api/outreach/│
│   /assignment-board/     │  │   calls (outreach.ts:191)│
│   assign → updates       │  │   + POST /api/engagement-│
│   assignedTeamMemberId   │  │   center/call-result     │
│   + journey event        │  │   (executionCases.ts:317)│
│  bulk cancel → lifecycle │  │                          │
│   =cancelled,            │  │                          │
│   engagementStatus=      │  │                          │
│   cancelled,             │  │                          │
│   journey event          │  │                          │
└──────────────────────────┘  └──────────────────────────┘
       │                               │
       │  (engagement→call-list        │
       │   bridge — flag-gated         │
       │   ENGAGEMENT_TO_CALL_LIST_    │
       │   BRIDGE, default OFF)        │
       ▼                               ▼
┌─────────────────────────────────────────────────────────┐
│  TEAM PORTALS                                           │
│  PCS /patient-care-specialist-portal                    │
│      (default mode: callList)                           │
│  ACS /ancillary-care-specialist-portal                  │
│      (default mode: clinicSchedule)                     │
│  shared TeamPortalShell.tsx; data:                      │
│   - call list:                                          │
│       fetchWorkspaceCallList →                          │
│       /api/scheduler-portal/cases?workspace=pcs|acs     │
│       (executionCases.ts:958)                           │
│   - clinic schedule:                                    │
│       fetchWorkspaceClinicSchedule →                    │
│       /api/portal/today-schedule +                      │
│       /api/global-schedule-events                       │
│   - ancillary schedule:                                 │
│       fetchWorkspaceAncillarySchedule                   │
│   - tasks: /api/portal/my-tasks                         │
│   - documents: /api/portal/patient-documents/:id        │
│   - ACS workflow:                                       │
│       /api/acs-workflow/:executionCaseId                │
│       (acsWorkflowRuntime.ts:86, read-only derivation)  │
│  Capabilities driven by team_member_profile             │
│  Procedure complete → POST /api/procedure-events        │
│  Consent capture → POST /api/portal/sign-consent        │
│       (portal.ts:716)                                   │
│  Report upload → POST /api/portal/uploads               │
│       (portal.ts:656) — kind='other'                    │
└─────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  READINESS + BILLING (Phase 4 — on main)                │
│  case_document_readiness ← procedure complete +         │
│       uploads + signatures                              │
│  billing_readiness_checks ← per-(case, serviceType)     │
│  invoice_readiness_snapshots ← engine                   │
│       (invoiceReadinessEngine.ts)                       │
│  invoice_batches → invoice_approval                     │
│       (draft→pending_review→approved/voided)            │
│  invoices.status (Draft|Sent|Partially Paid|Paid)       │
│  invoices.approvalStatus + invoices.deliveryStatus      │
│  invoice_delivery_events + invoice_financial_events +   │
│       invoice_denials                                   │
└─────────────────────────────────────────────────────────┘

Background services (in-process intervals):
  morningRebuildScheduler.ts:26  — rebuilds scheduler_assignments daily
  absenceWatcher.ts:42-44        — PTO/absence redistribution
```

## 2. Stage-by-stage detail

### 2.1 Import

- Entry: `POST /api/batches` then `POST /api/batches/:id/patients`.
- Parsers: `server/parsers/{csv,excel,pdf,plainText}.ts`.
- Inserts `screening_batches` and `patient_screenings` rows. Initial
  state: `status='pending'`, `commitStatus='Draft'`,
  `adminApprovalStatus='pending'`.

### 2.2 AI qualification

- Entry: `POST /api/batches/:id/analyze` →
  `server/services/batchAnalysisRunner.ts:47` → background
  `runAnalysisLoop`.
- Iterates **every** patient in the batch via `batchProcess` (no
  status filter on the loop; `batchAnalysisRunner.ts:95-271`).
- Per-patient errors stored in `reasoning.__analysisError`
  (`batchAnalysisRunner.ts:201-221`).
- Progress: `analysis_jobs.completedPatients` / `totalPatients`.
- Resume on restart: `server/routes.ts:75-103` resets stuck rows to
  `draft` and fails the running `analysis_jobs` row.

### 2.3 Admin Review

- Surfaces: `client/src/components/PatientCard.tsx:600`,
  `AdminReviewDialog.tsx`, `AdminApprovalControl.tsx`,
  `PatientListRow.tsx:284`, `PatientEditDialog.tsx:420`.
- Status values: `ADMIN_APPROVAL_STATUSES =
  ["pending","approved","needs_info","rejected"]`
  (`shared/schema/screening.ts:91-97`).
- Route handler: `server/routes/patients.ts:599-790`.
- On `approved` + `commitStatus='Draft'` →
  `commitPatient(id, userId, {auto:true})` (`patients.ts:670-690`).
  On failure → `commitFailed` + `commitError` returned and stored on
  the journey event.
- On `rejected` / `needs_info` / `pending` — only the screening row
  columns + journey event change. **No commit, no execution case
  write, no engagement assignment write.**
- Routing on approve: `lookupSchedulerFromSettings(facility)`
  (`patients.ts:658-668`); scheduler name surfaced as
  `routedSchedulerName`.

### 2.4 commitPatient fan-out

- `server/services/patientCommitService.ts:61` flips
  `patient_screenings.commitStatus` from `Draft` to `Ready`.
- Lines 97–182 launch six fire-and-forget sub-pipelines:
  1. execution case create/update
  2. global schedule event create (visits only, NOT outreach)
  3. insurance eligibility review
  4. cooldown records (per qualifying test)
  5. journey events (`screening_committed`, `execution_case_*`)
  6. scheduler auto-assign → `scheduler_assignments`
- Each runs inside its own `void (async () => { ... })()` — errors
  logged but **do not propagate** to the admin-approval response.

### 2.5 Engagement Center

- Filter on read (`server/routes/engagementAssignmentBoard.ts:166-176`):
  `lifecycleStatus='active'` AND
  `engagementStatus NOT IN (archived, closed, cancelled, completed)`.
- Assign: `POST /api/engagement/assignment-board/assign`
  (`engagementAssignmentBoard.ts:413-597`) updates
  `assignedTeamMemberId`, transitions
  `new|ready|assigned|not_reached → assigned`
  (`engagementAssignmentBoard.ts:489-494`), appends journey event.
- Cancel-many: `engagementAssignmentBoard.ts:607-700` —
  `engagementStatus='cancelled'`, `lifecycleStatus='cancelled'`, clears
  `assignedTeamMemberId`. Does NOT delete `patient_screenings`.
- Engagement → call-list bridge is flag-gated
  (`ENGAGEMENT_TO_CALL_LIST_BRIDGE`,
  `engagementAssignmentBoard.ts:547-569`). When OFF, the next morning
  rebuild does the work.

### 2.6 Scheduler Portal disposition

- `POST /api/outreach/calls` writes
  `outreach_calls` and updates
  `patient_screenings.appointmentStatus`
  (`server/routes/outreach.ts:191`).
- `POST /api/engagement-center/call-result` writes
  engagement-side side effects (triage, journey events, tasks)
  (`server/routes/executionCases.ts:317-942`).
- See [CALL_WORKFLOW_MODEL.md](./CALL_WORKFLOW_MODEL.md) for the
  outcome-by-outcome side-effect table.

### 2.7 Team Portal (PCS / ACS) writes

- Procedure complete: `POST /api/procedure-events` → `procedure_events`
  row.
- Consent capture: `POST /api/portal/sign-consent` (`portal.ts:716`) →
  creates a `documents` row + surface assignment.
- Report upload: `POST /api/portal/uploads` (`portal.ts:656`) → creates
  a `documents` row + surface assignment.
- Quick note: `POST /api/patient-notes` → `patient_notes` row.

**Gaps on main** (tracked in
[PLATFORM_HARDENING_BACKLOG.md](./PLATFORM_HARDENING_BACKLOG.md)):

- `POST /api/portal/uploads` and `POST /api/portal/sign-consent`
  do NOT append a `patient_journey_events` row, and they do NOT
  trigger `case_document_readiness` recompute. Result: ACS workflow
  snapshot can show "report_needed" after a successful upload, and
  the patient timeline has no record of consent or report.

### 2.8 Readiness + billing (Phase 4)

- `case_document_readiness` and `billing_readiness_checks` are read by
  the ACS workflow snapshot and the billing readiness scaffold.
- `invoice_readiness_snapshots` evaluated by
  `server/services/billing/invoiceReadinessEngine.ts` against 17 blocker
  codes (`shared/schema/invoiceReadiness.ts:27-45`).
- Invoice lifecycle: `invoice_batches → invoices.approvalStatus
  (draft|pending_review|approved|voided|revised)
  → invoices.deliveryStatus (8 values)
  → invoices.status (Draft|Sent|Partially Paid|Paid)`.
  Three parallel state machines on `invoices` (`shared/schema/invoices.ts:14,35-37`).

## 3. Branch-only stage — NOT on main

The audit also captured a Phase 3 Exception Intelligence box on the
`phase-3-ai-exception-intelligence` branch:

```
POST /api/exceptions/evaluate(-all|-recommend)
  → exception_snapshots upserts via exceptionSnapshotEngine
  → ai_recommendation_logs via recommendationEngine
  → human review via exception_reviews
```

This entire stage is on the `phase-3-ai-exception-intelligence` branch
only. It is NOT mounted on `main` and is NOT part of the operating
flow today.

## 4. Cross-cutting silent-failure surfaces

These are real on `main` today; details and remediations in
[PLATFORM_HARDENING_BACKLOG.md](./PLATFORM_HARDENING_BACKLOG.md):

- **Portal upload + sign-consent** do not refresh readiness or write
  timeline events (`portal.ts:656-827`).
- **`commitPatient` post-commit pipeline is fire-and-forget**
  (`patientCommitService.ts:97-182`).
- **Callbacks are invisible on the global calendar** — `callback`
  outcomes only write `scheduling_triage_cases` and update
  `executionCase.nextActionAt`; no `global_schedule_events` row is
  created.
- **Engagement-side `no_show` triggered by call outcome** does not
  insert a `global_schedule_events` row; only calendar-originated
  no-shows update the existing event.
- **Engagement Center and Team Portal use slightly different filters
  on the same execution case set** — divergence is possible between
  manager and team-member views.
