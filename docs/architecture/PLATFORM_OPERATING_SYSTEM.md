# Platform Operating System

> **Scope:** This document describes the operating model present on `main`
> as of `88c0a1d`. Findings from the in-progress
> `phase-3-ai-exception-intelligence` branch are explicitly marked
> **branch-only** and are NOT part of the operating model today.
>
> Source: approved platform audit (2026-06-17) + main-branch verification.

## 1. Repo shape (on main)

| Area | Path | Count on main |
| --- | --- | --- |
| Schemas | `shared/schema/` | 38 files |
| Backend routes | `server/routes/` | 55 files |
| Backend services | `server/services/` | ~100 files |
| Repositories | `server/repositories/` | 42 files (`*.repo.ts`) |
| Dormant modules | `server/modules/` | 10 dirs (see §5) |
| Migrations | `migrations/` | 39 files (`0000`–`0038`) |
| Frontend pages | `client/src/pages/` | 48 files |
| Architecture docs | `docs/architecture/` | 100+ files |

Top-level: `client/`, `server/`, `shared/`, `migrations/`, `docs/`,
`scripts/` (QA / parity), `script/` (one-shot ts), `storage/`,
`tests/`, plus configs (`drizzle.config.ts`, `vite.config.ts`,
`tsconfig.json`, `package.json`).

## 2. Routes registration entry point

`server/routes.ts` registers every route family on startup. Notable
registrations include patient, batch, engagement, scheduler, portal,
billing, document, calendar, and admin routes. The same file also runs
a stuck-batch reset on boot (`server/routes.ts:75-103`) which marks any
analysis job stuck in `processing` back to `draft` and fails the
corresponding `analysis_jobs` row via `storage.failRunningAnalysisJobs`.

## 3. Discovered product domains

Each domain below was verified against `main`.

| Domain | Route(s) / Page | Primary schema | Service(s) | State |
| --- | --- | --- | --- | --- |
| Home | `/home` (`client/src/pages/home.tsx:59`) | none (composes screening + dashboard) | n/a | complete |
| Plexus IQ (qualification) | `/plexus-iq` + `client/src/components/plexus-iq/PlexusIQWorkspace.tsx` | `screening_batches`, `patient_screenings`, `analysis_jobs` | `server/services/batchAnalysisRunner.ts`, `screening.ts`, `plexusIq/adminReview*.ts` | complete |
| Patient Intake (visit + outreach build) | `/patient-intake`, `/visit-patients`, `/outreach-patients` (`client/src/App.tsx:153-172`) | `patient_screenings` | `server/services/patientCommitService.ts:61` | complete |
| Admin Review | embedded modal (`AdminReviewDialog.tsx`, `AdminApprovalControl.tsx`) | `patient_screenings.adminApprovalStatus*` (`shared/schema/screening.ts:73-76,91-97`) | `commitPatient` + `schedulerSettings.ts`; route `POST /api/patient-screenings/:id/admin-approval` (`server/routes/patients.ts:599`) | complete |
| Patient Directory / Patient Database | `/patient-directory` → `PatientDatabasePage` (`client/src/App.tsx:122-128`) | aggregates over `patient_screenings`; canonical service GATED | live: `server/routes/patientDatabase.ts`; gated canonical: `server/routes/patientDirectory.ts:37-43` | **partial / gated** — see [PATIENT_DIRECTORY_SOURCE_OF_TRUTH.md](./PATIENT_DIRECTORY_SOURCE_OF_TRUTH.md) |
| Engagement Center | `/engagement-center` | `patient_execution_cases`, `patient_journey_events`, `outreach_schedulers`, `patient_screenings` | `server/routes/engagementAssignmentBoard.ts`, `executionCases.ts` | complete (canonical engagement call-list READ is flag-gated, default 404 — `executionCases.ts:260-263`) |
| Scheduler Portal / Outreach | `/scheduler-portal`, `/outreach/scheduler/:id` | `outreach_schedulers`, `outreach_calls`, `scheduler_assignments` (`shared/schema/outreach.ts:8,36,75`) | `outreachService.ts`, `callListEngine.ts`, `schedulerAutoAssign.ts`, `recordCallResultOutreachExecutor.ts` | complete |
| Technician Portal | `/technician-portal` | `/api/portal/*` | `server/routes/portal.ts:196-936` | complete (legacy `PortalShell`) |
| Liaison Portal | `/liaison-technician-portal` | same | same | complete (legacy shell) |
| Patient Care Specialist (PCS) | `/patient-care-specialist-portal` → `ClinicWorkflowPortal role="patientCareSpecialist"` → `TeamPortalShell role="liaison"` | composes execution cases, ancillary appointments, global schedule events, patient notes, outreach calls | `/api/portal/*`, `/api/scheduler-portal/cases`, workspace feeds via `lib/workflow/teamMemberWorkspaceApi.ts` | complete shell, partial wiring |
| Ancillary Care Specialist (ACS) | `/ancillary-care-specialist-portal` → `role="ancillaryCareSpecialist"` → `TeamPortalShell role="technician"` | + `procedure_events`, `case_document_readiness`, `billing_readiness_checks` | `/api/portal/*`, `/api/acs-workflow/:executionCaseId` (`server/routes/acsWorkflow.ts:10`) | complete shell; readiness writes incomplete (see backlog) |
| Team Member Portals (selector) | `/team-member-portals` | n/a | n/a | wrapper page |
| Engagement / Outreach (legacy aggregator) | `/outreach`→`/scheduler-portal`, `/outreach-center`→`/scheduler-portal` (`client/src/App.tsx:140-146`) | outreach dashboard | `GET /api/outreach/dashboard` → `outreachService.ts buildOutreachDashboard` | complete |
| Calendar (global) | `/schedule`, `/dashboard`, `/schedule/:id` | `global_schedule_events`, `ancillary_appointments` | `server/routes/globalSchedule.ts:98-415`, `appointments.ts` | complete |
| Plexus Tasks | `/plexus-tasks` | `plexus_tasks` | `server/routes/plexusTasks.ts` | complete |
| Billing (legacy) | `/billing` | `billing_records` (`shared/schema/billing.ts:4-40`) | `billingRecordsService.ts` | complete |
| Billing Readiness | `/billing/readiness` | `billing_readiness_checks`, `case_document_readiness` | `billingReadinessAggregator.ts` | partial / scaffold + live writes |
| Invoice Readiness + Batches + Approval + Delivery + Financial | `/billing/invoice-batches`, `invoice-review`, `invoice-delivery`, `remittance` | `invoices`, `invoice_line_items`, `invoice_payments`, `invoice_readiness_snapshots`, `invoice_batches`, `invoice_delivery_events`, `invoice_financial_events`, `invoice_denials` | `invoiceApprovalService.ts`, `invoiceBatchBuilder.ts`, `invoiceDeliveryService.ts`, `invoiceDraftService.ts`, `invoiceFinancialService.ts`, `invoiceReadinessEngine.ts` | complete (Phase 4) |
| Billing Auditor + Reports | `/billing/auditor`, `/billing/reports` | reads above | `billingAuditorWorklistService.ts`, `billingReportService.ts` | complete |
| Cash Pricing / Billing Policy / Projected Invoices | admin-settings | `cash_pricing`, `billing_policies`, `projected_invoices` | `cashPricing.ts`, `billingPolicy.ts`, `projectedInvoices.ts` | complete |
| Admin | `/admin`, `/admin/users`, `/admin/settings-center`, `/admin/billing-settings`, `/admin/stovetop-heat-settings`, `/admin/analysis-jobs`, `/admin/outbox`, `/admin-ops` | `admin_settings`, `app_settings`, `audit_log`, `analysis_jobs`, `outbox`, `pto_requests` | `adminSettingsEffectiveService.ts`, `outbox.ts`, `platformSettingsService.ts` | complete |
| Audit Log | `/audit-log` | `audit_log`, `patient_journey_events` | `auditService.ts`, `appendJourneyEvent.ts`; route at `server/routes.ts:202-216` | complete |
| Drive / Document Library | `/drive`, `/document-library`, `/document-upload`, `/ancillary-documents` | `documents`, `document_surface_assignments`, `outbox` | `blobStore.ts`, `documents/documentWorkflowRuntime.ts`, `patientTestAttachmentService.ts` | complete |
| Marketing materials | left-rail Team Portal tool | `marketing_materials` | `server/services/marketingMaterials.ts` | complete |
| Settings / Stovetop heat | `/settings`, `/admin/stovetop-heat-settings` | `app_settings` | `server/routes/settings.ts`, `testFixture.ts` | complete |
| Login | `/login` | `users`, `session` | `/api/auth/*` in `server/routes.ts:120-151,374-388` | complete |
| Command Center (in-progress) | `client/src/features/command-center/components/CommandCenterShell.tsx` | n/a yet | local providers (`manualPhoneProvider.ts`, `ringCentralProvider.ts`) | partial / dormant scaffold (PR #278 surface — do not touch) |

### Branch-only domains (NOT on main)

- **Exception Intelligence (Phase 3)** — pages `/exceptions`,
  `/admin/exception-settings`, `/admin/ai-recommendations`,
  `/admin/operational-summary`, `/call-priority`; schemas
  `exception_snapshots`, `exception_reviews`, `ai_recommendation_logs`;
  routes `server/routes/{exceptions,aiRecommendations,callPriority,exceptionSettings,operationalSummary}.ts`;
  services under `server/services/exceptionIntelligence/`; migrations
  `0039`/`0040`/`0041`. All only on
  `phase-3-ai-exception-intelligence` branch.

## 4. Naming inconsistencies on main

- `/patient-database` redirects to `/patient-directory`
  (`client/src/App.tsx:126`), the page component is
  `PatientDatabasePage`, and the canonical service module is
  `patient-directory`. **Three names for one concept.**
- `screening_batches` + `patient_screenings` table names predate the
  "Plexus IQ" UI rename. The UI refers to them as "qualifications",
  "patients", "screenings".
- "Engagement Center", "Outreach Center", "Scheduler Portal" coexist
  with `/outreach`, `/outreach-center`, `/scheduler-portal`,
  `/engagement-center` (engagement-center is the manager view;
  scheduler-portal is the per-scheduler call queue; outreach* redirect
  to scheduler-portal).
- PCS/ACS public role names map to internal `liaison`/`technician`
  (`client/src/components/workflow/ClinicWorkflowPortal.tsx:28-33`).
- `qualification` ↔ `patient-intake` are aliased redirects
  (`client/src/App.tsx:153-156`).

## 5. Dormant / gated infrastructure on main

These exist in code but are intentionally not consumed by any UI yet.
See [PLATFORM_HARDENING_BACKLOG.md](./PLATFORM_HARDENING_BACKLOG.md)
for the activation sequence.

| Surface | File | Activation gate | Default |
| --- | --- | --- | --- |
| Canonical Patient Directory routes | `server/routes/patientDirectory.ts:37-43` | `USE_PATIENT_DIRECTORY_ACTIVATION=1` | OFF |
| Operational queue read | `server/routes/operationalQueue.ts:78` | additive — no consumer UI | unused |
| Canonical Engagement call list READ | `server/routes/executionCases.ts:260-315` | `isEngagementCanonicalCallListReadEnabled` | 404 by default |
| `recordCallResult` canonical planner | `server/services/callResult/recordCallResult.ts:365-412` | per-route delegate flags | OFF |
| Engagement → Call-list bridge | `server/modules/operational-queue/bridge.ts` | `ENGAGEMENT_TO_CALL_LIST_BRIDGE` | OFF |
| Portal call history read | `server/routes/portal.ts:870` | `USE_PORTAL_CALL_HISTORY_READ` | OFF (404) |
| Billing Readiness Aggregator V2 | `server/services/billingReadiness/billingReadinessAggregator.ts:55-80` | `USE_BILLING_READINESS_AGGREGATOR_V2` | OFF |
| Engagement Board V2 composer | `server/modules/engagement-board/service.ts` | no route wired | OFF |
| Background jobs module | `server/modules/background-jobs/contracts.ts` | no concrete runner | dormant by design |
| Command Center premium UI (PR #278) | `client/src/features/command-center/*` | only mounted via Home tile | scaffold — do not touch |

## 6. Background services (in-process intervals)

- `server/services/morningRebuildScheduler.ts:26` — rebuilds
  `scheduler_assignments` daily.
- `server/services/absenceWatcher.ts:42-44` — PTO / absence
  redistribution.

## 7. Cross-doc index

- [PATIENT_DIRECTORY_SOURCE_OF_TRUTH.md](./PATIENT_DIRECTORY_SOURCE_OF_TRUTH.md) — canonical patient row, person-identity gap.
- [OPERATIONAL_FLOW_MAP.md](./OPERATIONAL_FLOW_MAP.md) — end-to-end transitions.
- [QUEUE_AND_ASSIGNMENT_MODEL.md](./QUEUE_AND_ASSIGNMENT_MODEL.md) — 14 queues on main + ownership / nextAction model.
- [CALL_WORKFLOW_MODEL.md](./CALL_WORKFLOW_MODEL.md) — disposition outcomes and side-effect planner.
- [PLATFORM_HARDENING_BACKLOG.md](./PLATFORM_HARDENING_BACKLOG.md) — PR-sized fix sequence.
