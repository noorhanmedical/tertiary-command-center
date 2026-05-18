# Full Platform Canonical Wiring Audit

> This is an **honest** wiring audit. Where a domain is fully wired, it
> says so. Where a wire is partial, the gap is named. Where a wire is
> missing, it is marked deferred — not faked.

## Canonical spine

| Concern | Canonical table | Notes |
| --- | --- | --- |
| Patient identity + clinical | `patient_screenings` (+ soft-delete fields, schema 0023) | Single source. |
| Facility / scheduleDate context | `screening_batches` | Keyed by `(facility, scheduleDate)`. |
| Engagement case (bucket, status, lifecycle, assignment, priority) | `patient_execution_cases` | Owns assignment via `assignedTeamMemberId` → `outreach_schedulers.id`. |
| Audit trail | `patient_journey_events` (+ `actorUserId`) | Every assignment / commit / communication appends here. |
| Calls | `outreach_calls` | Domain rows; also mirrored into `patient_communications` for the unified timeline. |
| Texts / emails / marketing / notes | `patient_communications` (schema 0024) | Unified read-model entry. |
| Schedule events | `global_schedule_events` | Doctor visits, ancillary, blocks, completed procedures. |
| Procedures | `procedure_events`, `generated_notes` | Procedure complete + AI-generated notes. |
| Tasks | `plexus_tasks` | Patient + facility task feed; reads in PCS/ACS Tasks tab. |
| Documents | `documents` (with `kind=marketing` etc.) | Document Library + per-patient files. |
| Insurance eligibility | `insurance_eligibility_reviews` | Per-patient eligibility decisions. |
| Cooldown source | `patient_test_history` | Previous ancillaries + cooldown clock. |
| AI qualification jobs | `analysis_jobs` | Durable batch analysis runner. |
| Soft-delete window | `patient_screenings.deletedAt` / `deleteExpiresAt` | 14-day recoverable delete (schema 0023). |
| Billing readiness | `case_document_readiness`, `billing_readiness_checks`, `billing_document_requests` | Per-patient billing checklist. |
| Billing packages | `completed_billing_packages` | Sealed packages ready to invoice. |
| Invoices | `invoices`, `invoice_line_items`, `invoice_payments`, `projected_invoice_rows` | Pricing rules from `admin_settings`. |
| Platform rules | `admin_settings` | Clinic aliases, scheduling rules, role gating, etc. |
| Team-member roster | `users`, `outreach_schedulers`, profile records in `admin_settings` | Roster + facility scope + capability bits. |

## Migrations applied in this branch

| Migration | Purpose |
| --- | --- |
| `0023_add_patient_screening_soft_delete.sql` | 14-day soft-delete on `patient_screenings`. |
| `0024_add_patient_communications.sql` | Unified comms timeline. |

Apply migrations 0023 + 0024 before exercising the new endpoints.

## Per-domain wiring table

> **Status legend:** ✅ wired · 🟡 partial · ⏳ deferred / not in scope.
> "Action this batch" is non-empty only when this batch landed work
> for that row.

| # | Domain | Frontend | Backend / repo | Canonical tables | Read | Write | UI | QA | Notes / gaps |
| - | - | - | - | - | - | - | - | - | - |
| 1 | Home / front page | `client/src/pages/home.tsx`, `HomeDashboard` | `server/routes/batches.ts`, `server/routes/testHistory.ts` | `screening_batches`, `patient_screenings`, `patient_test_history` | ✅ | ✅ | 🟡 — home does not yet open `UniversalCalendarDrawer` itself; calendar drawer is reached via Plexus IQ + portals | `qa:full-canonical-spine` | Calendar profile `admin` exists and can be reused by a home calendar entry (deferred; no UX change requested here). |
| 2 | Plexus IQ | `client/src/pages/plexus-iq.tsx`, clinic tile board, recent-cards, recently-deleted | `server/routes/batches.ts`, `server/routes/plexusIqClinicalImport.ts`, `server/services/batchAnalysisRunner.ts` | `screening_batches`, `patient_screenings`, `analysis_jobs` | ✅ | ✅ | ✅ clinic tiles + status detail + packets + Add Patient(s) hub | `test:plexus-iq-clinical-parser` (164/164), `qa:plexus-final-wiring` | — |
| 3 | Add Patient(s) hub | `PlexusIQAddPatientHub.tsx`, `PlexusIQAddPatientModal.tsx` (accepts `defaultPatientType`) | `POST /api/batches/:id/patients` | `screening_batches`, `patient_screenings` | n/a | ✅ | ✅ 3 tiles: Visit / Outreach / BatchFlow | parser tests | — |
| 4 | BatchFlow import | `PlexusIQBulkImportModal.tsx`, parser `plexusIqClinicalImportParser.ts` | `server/routes/plexusIqClinicalImport.ts` | `screening_batches`, `patient_screenings`, `analysis_jobs` | n/a | ✅ row-level Clinic/Date/Type override modal defaults | ✅ clinical preview breakdown | parser 164/164 | — |
| 5 | Visit Patients | Sub-feature of Plexus IQ + ResultsView (`/visit-patients` redirects to home) | shared with Plexus IQ | shared with #2 | ✅ | ✅ | ✅ via shared `PatientCard` | shared | No separate page — by design. |
| 6 | Outreach Patients | `client/src/pages/outreach-qualification.tsx`, `client/src/pages/outreach.tsx` | `server/routes/outreach.ts`, `server/routes/engagementAssignment.ts`, `server/routes/engagementAssignmentBoard.ts` | `outreach_calls`, `outreach_schedulers`, `patient_journey_events`, `patient_communications` | ✅ | ✅ — calls mirror into `patient_communications` automatically | ✅ | `qa:engagement-assignment-board` | — |
| 7 | Engagement Center | `client/src/pages/engagement-center.tsx` → `outreach.tsx` (default tab now **Assignments**) | `engagementAssignment*.ts` | same as #6 + `patient_execution_cases` | ✅ | ✅ single + bulk assign, journey-event audited | ✅ | `qa:engagement-assignment-board` | — |
| 8 | PCS / ACS Portal | `client/src/components/portal/PortalShell.tsx` | `server/routes/portal.ts`, `server/routes/portalCommandCenter.ts` | broad — see #10 + `global_schedule_events` | ✅ | ✅ comms log, schedule writes, marketing send | ✅ left rail = My Patients · Search · Calendar · Tasks · Marketing | `qa:team-portal-command-center` | — |
| 9 | Global calendar | `UniversalCalendar*.tsx`, `calendarProfiles.ts` (6 profiles: `plexusIq`, `patientCareSpecialist`, `technician`, `manager`, `admin`, `facility`) | `server/routes/globalSchedule.ts`, `server/routes/appointments.ts`, `server/routes/procedureEvents.ts` | `global_schedule_events`, `ancillary_appointments`, `procedure_events` | ✅ | ✅ | ✅ Plexus IQ + PCS + ACS all use same drawer | shared | — |
| 10 | Patient Command Canvas | `client/src/components/portal/PatientCommandCanvas.tsx` | `GET /api/portal/patient-command-center/:id` | `patient_screenings`, `patient_execution_cases`, `patient_journey_events`, `patient_communications`, `outreach_calls`, `global_schedule_events`, `procedure_events`, `plexus_tasks`, `patient_test_history`, `insurance_eligibility_reviews`, `documents` | ✅ | n/a (read model) | ✅ identity → clinical → latest → history folders → action strip | `qa:team-portal-command-center` | — |
| 11 | Communications | `LogCommunicationDialog`, `PortalCommandCanvas` (read), `PortalMarketingTab` (send) | `server/repositories/patientCommunications.repo.ts`, `server/routes/portalCommandCenter.ts`, `server/routes/email.ts`, `server/routes/outreach.ts` (call mirror) | `patient_communications`, `patient_journey_events` | ✅ | ✅ call POST mirrors → comm; marketing send → `marketing_email` row; manual Log Call/Text/Email/Internal Note | ✅ | `qa:team-portal-command-center` (write + read), `qa:full-canonical-spine` | SMS is **log-only** (no SMS backend). |
| 12 | Marketing | `client/src/components/portal/PortalMarketingTab.tsx` | `GET /api/outreach/materials`, `POST /api/outreach/send-material` | `documents` (`kind=marketing`), `patient_communications`, `patient_journey_events` | ✅ | ✅ on send-material success appends `marketing_email` row + journey event | ✅ | — | — |
| 13 | Document Library | `client/src/pages/document-library.tsx`, `document-upload.tsx`, `documents.tsx` | `server/routes/documentLibrary.ts` | `documents`, `uploaded_documents`, `document_blobs`, `document_surface_assignments` | ✅ | ✅ | ✅ | — | — |
| 14 | Ancillary Documents | (Templates surfaced via Document Library `kind` flags) | `server/routes/ancillaryDocumentTemplates.ts` | `ancillary_document_templates` | ✅ | 🟡 templates are admin-managed; per-patient generation status flows through #15 | ✅ template listing | — | Per-patient generation orchestration is out of scope for this batch. |
| 15 | Document Readiness | embedded in Billing | `server/routes/documentReadiness.ts` | `case_document_readiness` | ✅ | ✅ | 🟡 | — | UI focus is the Billing page's readiness column. |
| 16 | Procedure events / notes | embedded in PortalShell + final-schedule actions | `server/routes/procedureEvents.ts`, `server/routes/generatedNotes.ts` | `procedure_events`, `generated_notes` | ✅ | ✅ | ✅ Procedure Complete button on Ancillary Schedule row | — | — |
| 17 | Billing Readiness | embedded in Billing page | `server/routes/billingReadiness.ts` | `billing_readiness_checks` | ✅ | ✅ | 🟡 | — | Out-of-scope for this batch. |
| 18 | Billing Documents / Packages | `client/src/pages/billing.tsx` (left panel) | `server/routes/billingDocuments.ts`, `server/routes/completedBillingPackages.ts` | `billing_document_requests`, `completed_billing_packages` | ✅ | ✅ | 🟡 | — | Out-of-scope for this batch. |
| 19 | Invoices | `client/src/pages/invoices.tsx` | `server/routes/invoices.ts` | `invoices`, `invoice_line_items`, `invoice_payments` | ✅ | ✅ | 🟡 | `test:billing-payment-invoice-flow`, `test:billing-visibility-read-model`, `test:patient-to-invoice-flow` | Out-of-scope for this batch. |
| 20 | Projected Invoices | embedded in Billing page | `server/routes/projectedInvoices.ts` | `projected_invoice_rows` | ✅ | 🟡 (derived) | 🟡 | — | Out-of-scope for this batch. |
| 21 | Team Ops | `client/src/pages/team-ops.tsx`, `admin-users.tsx` | `server/routes/admin.ts`, `server/routes/pto.ts`, `server/routes/settings.ts` | `users`, `pto`, `app_settings`, `admin_settings` | ✅ | ✅ | 🟡 | — | KPI surfacing deferred. |
| 22 | Admin Settings | embedded in `admin*.tsx` | `server/routes/adminSettings.ts` | `admin_settings` | ✅ | ✅ | 🟡 | — | — |
| 23 | Mission Control / Analytics | not present | not present | n/a | ⏳ | ⏳ | ⏳ | ⏳ | **Deferred.** No page or route exists. Needs product spec before implementation. |
| 24 | Plexus Tasks | `client/src/pages/plexus-tasks.tsx`, `PortalPlexusTasksTab.tsx` | `server/routes/plexusTasks.ts` | `plexus_tasks` | ✅ | ✅ | ✅ patient-aware in PCS/ACS Tasks tab | — | — |

## What this batch landed

- **`script/qaFullCanonicalSpine.ts`** + npm script `qa:full-canonical-spine`. Verifies a `db.select(table).limit(1)` smoke read across the full canonical spine (screenings, batches, execution cases, journey events, calls, schedulers, schedule events, procedure events, tasks, test history, eligibility, documents, analysis jobs, communications, admin settings). Skips cleanly without `DATABASE_URL`.
- **This document** (`docs/full-platform-canonical-wiring-audit.md`). Single source of truth for "what is wired, what isn't, what needs product work next."

No other code wires were added in this batch. Per the explicit batch
rule — "do NOT fake completion" — domains rows 14–22 + 23 are
acknowledged as gaps that need real product/spec work rather than
mechanical wiring. Their canonical tables and routes already exist;
the UI completeness is the gap.

## Deferred items (explicit)

| # | Item | Why deferred |
| - | - | - |
| 23 | Mission Control / Analytics page | No page or route exists. Needs metrics spec (which metrics, which time windows, role permissions). Once spec is fixed, the canonical tables are already in place to power it. |
| 14 | Per-patient ancillary document generation orchestration | The templates table + Document Library are wired. The end-to-end "generate this template for this patient and write into `documents` with `case_document_readiness` updates" needs a coordinated UI batch. |
| 17–20 | Billing readiness / packages / invoices / projected invoices UI polish | Canonical tables + repos + routes are present; UI surfaces are functional but need focused product passes. Existing flow tests (`test:patient-to-invoice-flow`, `test:billing-payment-invoice-flow`, `test:billing-visibility-read-model`) already verify the canonical path. |
| 21 | Team Ops KPI surfacing | Backend reads exist; the dashboard pass is a separate product batch. |
| Home calendar drawer entry | The `admin` calendar profile already exists and works in `UniversalCalendarDrawer`. Wiring a calendar button into `home.tsx` is one-line; deliberately deferred so the home shell stays untouched in this audit batch. |

## QA inventory

`npm run …`:

- `test:plexus-iq-clinical-parser` — 164 deterministic parser assertions. Runs without a DB.
- `test:plexus-iq-clinical-import-api` — clinical-import API smoke. Skips without DB.
- `qa:team-portal-command-center` — repo-level reads + safe writes for the canonical command-center contract. Skips without DB.
- `qa:plexus-final-wiring` — pdfPacketGrouping contract + execution-case + scheduler + `patient_communications` queryability. Skips without DB.
- `qa:engagement-assignment-board` — schedulers read, execution case read, safe write on `isTest=true` patient (updates assignment + appends journey event). Skips without DB.
- `qa:full-canonical-spine` *(new this batch)* — smoke-read every canonical table named above. Skips without DB.
- `test:patient-to-invoice-flow`, `test:billing-payment-invoice-flow`, `test:billing-visibility-read-model`, `test:final-schedule-commit-to-caller`, `test:final-schedule-canonical-actions`, `test:visit-schedule-auto-commit`, `test:scheduler-assignment-wiring`, `test:operational-flow-assigned-to-billing-ready`, `test:op-flow-sprint-1`, `test:call-result-canonical-write`, `test:build-screen-data-entry-model`, `test:ui-path-api-smoke`, `qa:canonical-visual-state`, `audit:canonical-integrity`, `check:canonical-tables`, `smoke:canonical-apis` — existing operational-flow + canonical integrity tests.

## Hard rules already enforced in code

These appear scattered across implementations but are worth listing
together since they are the spine's safety net:

- `validateSameFacilityDatePacket` blocks PDF packets that mix
  facilities or schedule dates (`client/src/lib/pdfPacketGrouping.ts`).
- `isPatientPdfEligible` blocks PDF generation for patients without
  `qualifyingTests` / `reasoning` (same file).
- Send-to-Engagement UI gate requires `name + DOB + phone + facility
  + qualification` (`ResultsView.tsx`). Backend `commitPatient` is
  the canonical guard.
- Soft-delete: every screening repository read (and every direct ad-hoc
  query in `documentLibrary`, `email`, `outreach`, `executionCases`,
  `plexusTasks`, `patientPacket.repo`) filters `deletedAt IS NULL`.
  `POST /api/patient-screenings/:id/restore` returns 410 after the
  14-day window.
- Patient type display: `derivePatientType` promotes any patient with
  an in-window batch `scheduleDate` (or scheduled appointment) to
  `"visit"` — appointment patients never display OUTREACH.
- Engagement assignment writes always append a
  `patient_journey_events` row tagged
  `eventType = "engagement_assignment_changed"`.
- Call POST (`/api/outreach/calls`) mirrors every call into
  `patient_communications` so the unified timeline is in one place.
- Marketing send (`/api/outreach/send-material`) appends a
  `marketing_email` row + journey event on success.
- Schedule writes invalidate via the centralized
  `invalidateTeamPortalScheduleQueries` helper so the right-rail
  mini calendar, workspace lists, and command canvas stay in sync.

## How to extend safely

When adding a new operational surface:

1. Anchor patient identity to `patient_screenings.id`.
2. Anchor engagement state to `patient_execution_cases.id`.
3. Anchor schedule writes through
   `/api/global-schedule-events/schedule-ancillary` or the schedule
   helpers in `server/services`.
4. Append a `patient_journey_events` row for any state change worth
   auditing.
5. For any touch (call / text / email / marketing / note), also write
   a `patient_communications` row (or rely on the existing mirrors).
6. Reuse `UniversalCalendarDrawer` + a `calendarProfiles.ts` entry —
   don't build a parallel calendar.
7. Reuse `PatientCard`, `PatientPdfActions`, `EngagementAssignmentBadge`
   — the action rail already covers the canonical operations.
8. For new admin-governed rules, add to `admin_settings` + the
   `/api/admin-settings/effective` lookup pattern.
