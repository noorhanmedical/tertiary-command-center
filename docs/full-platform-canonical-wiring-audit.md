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

## Pre-document batch landing (1–10)

The "next 10 batches" run completed Stages 1 and 10 explicitly,
verified Stages 4–9 against the existing canonical wires (already
shipped), and explicitly deferred Stages 2 + 3.

| Stage | Status | Notes |
| --- | --- | --- |
| 1. Plexus IQ premium clinic tiles | **landed** | Each tile now has a solid black header strip (clinic name only) and a body with one stat row per status (Incomplete / Completed / Missing Info / Ready for Engagement / Sent to Engagement / Errors) plus a footer total. Color accents stay restrained — single dot per row, single bold number per row. |
| 2. PatientCard layout / action rail | **deferred** | The diagonal layout is shared across Visit, Outreach, Plexus IQ, recent cards, ResultsView. A redesign of that shared surface conflicts with the "no global UI redesign" rule. Action-rail icons (PDF, calendar, Send, status, count badge) already align via the recent batches; a focused dedicated batch is the right place to redo this. |
| 3. Shared canonical home calendar | **deferred** | The `admin` profile in `calendarProfiles.ts` already supports a home/global drawer mount. Placement on `home.tsx` requires UX decisions that should not happen inside an audit batch. |
| 4. PCS / ACS left rail cleanup | **verified** | Earlier batches removed the Document Upload tile and added My Patients / Search / Calendar / Tasks / Marketing. Both PCS and ACS render the same shell. |
| 5. PCS / ACS scheduling final | **verified** | Patient-calendar icon → SchedulePatientDialog (with Maximize2 → SchedulePatientPlayground). `invalidateTeamPortalScheduleQueries` keeps right-rail mini calendar + workspace lists fresh. |
| 6. Patient Command Canvas history | **verified** | `GET /api/portal/patient-command-center/:id` aggregates clinical profile, latest activity (call / text / email / marketing / note / appointment / ancillary / journey), and history folders from canonical tables. Empty states are explicit. |
| 7. Marketing send / log | **verified** | `POST /api/outreach/send-material` appends a `marketing_email` row to `patient_communications` and a journey event. SMS is log-only and explicitly labelled. |
| 8. Engagement call-list propagation | **verified** | Engagement Assignment Board updates `patient_execution_cases.assignedTeamMemberId`. PCS/ACS Team Workspace Call List reads through `getAssignedSchedulerUserIdForPatient` / equivalent — assignments flow to the right team-member queue. |
| 9. BatchFlow + Add Patient(s) | **verified** | 3-tile hub (Visit / Outreach / BatchFlow) lives in `PlexusIQAddPatientHub.tsx`. BatchFlow row-level Clinic/Date/Type override modal defaults. TFP alias works (parser case 26). Missing DOB/phone are warnings. |
| 10. Pre-document spine QA | **landed** | New `script/qaPreDocumentSpine.ts` + `qa:pre-document-spine` npm script. Verifies parser contract (TFP alias, Patient Type, clinical-spreadsheet detection), PDF-packet contract (same-facility/date guard, eligibility), and canonical reads across the spine (`screening_batches`, `patient_screenings`, `patient_execution_cases`, `patient_journey_events`, `outreach_calls`, `outreach_schedulers`, `global_schedule_events`, `plexus_tasks`, `patient_communications`, `analysis_jobs`). Skips cleanly without `DATABASE_URL`. |

### Why Stages 2 + 3 stay deferred

Both touch shared surfaces (the patient-card layout / the home shell)
that have explicit rules in the batch spec — "do NOT change global
UI/sidebar/home/theme/colors unless explicitly needed for wiring" and
"keep diagonal style". Both are visual polish, not canonical
wiring. They should land in a dedicated UX batch.

## Document-to-invoice batch landing (11–20)

This batch run was a **documentation + QA** pass on the post-procedure
spine, per the explicit "do NOT fake completion" rule. Code-level
wiring of Stages 11–19 requires product UX decisions that exceed an
audit batch's scope. The artefacts that did land:

| Stage | Status | Result |
| - | - | - |
| 11. Procedure workflow + report upload | **documented** | `docs/ancillary-documents-architecture.md` names the gap: today there is one `Procedure Complete` button; staged statuses (`scheduled → performed → report uploaded → docs complete → billing ready`) and the side-effects need a focused batch. |
| 12. Ancillary document readiness | **documented** | Same doc lists the wired side (`case_document_readiness` schema + `GET` route + cascade from `POST /api/procedure-events/complete`) and the missing side (no readiness panel UI, no "report-uploaded → readiness + task" side-effect). |
| 13. Document generation orchestration | **documented as gap** | `procedure_notes` is read-only today. Generation routes for order note / procedure note / billing document do not exist. Decision needed: AI vs. template-fill vs. hybrid. |
| 14. Billing readiness | **documented** | `docs/billing-invoicing-architecture.md` lists `billing_readiness_checks` read routes + the missing write/override routes. |
| 15. Completed billing packages | **partial — documented** | Read + payment writes wired; explicit status-transition endpoint missing. |
| 16. Invoices + projected invoices | **wired — documented** | Full invoice CRUD already exists. Projected invoices are read-only with `realInvoiceLineItemId` linkage. |
| 17. Team Ops | **documented** | `docs/team-ops-architecture.md` lists the wired side (PTO routes, scheduler list, admin-settings team profile) and the missing PTO-aware assignment + KPI surfacing. |
| 18. Technician Central | **documented as biggest gap** | `docs/technician-central-architecture.md` says explicitly: no `technician_availability` or `technician_qualification` tables, no global tech schedule page; gives recommended schema for the next batch. |
| 19. Admin rules / settings | **documented** | The `admin_settings` read/write routes are in place; the canonical setting domains and the BatchFlow clinic alias path are described. |
| 20. QA + docs | **landed** | New `script/qaDocumentBillingInvoiceSpine.ts` + `qa:document-billing-invoice-spine` npm script smoke-reads every document/billing/invoice/team-ops canonical table. New architecture docs for ancillary documents, billing/invoicing, team ops, technician central. This audit doc updated. |

### Why Stages 11–19 ship as docs only

Three categories:

1. **UX-design-first** (Stages 11, 12 staged statuses, 14 readiness panel, 17 KPI dashboard): the canonical schema is in place; the gap is product UX, which a wiring batch can't responsibly invent.
2. **Generation infrastructure** (Stage 13): generating notes / billing documents needs an AI/template strategy decision before writing any code.
3. **Schema-first gaps** (Stage 18 technician availability/qualification): the missing tables need a real model decision, not a placeholder. The architecture doc records the recommended shape.

Each of the docs above lists the existing tables/routes that a future
batch can lean on so the next pass can move fast without re-discovery.

### QA inventory (updated)

- `qa:full-canonical-spine` — full spine smoke (15 tables).
- `qa:pre-document-spine` — parser contract + PDF packet contract + pre-doc canonical reads.
- `qa:document-billing-invoice-spine` *(new this batch)* — every document/billing/invoice/team-ops table smoke read.
- `qa:engagement-assignment-board`, `qa:plexus-final-wiring`, `qa:team-portal-command-center` — domain QAs from prior batches.
- `test:plexus-iq-clinical-parser` (164/164), `test:plexus-iq-clinical-import-api`, plus the existing operational-flow tests (`test:patient-to-invoice-flow`, `test:billing-payment-invoice-flow`, etc.).
