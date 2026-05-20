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

## Max-safe-implementation batch landing

Per the explicit "do NOT fake completion" rule, this batch landed the
stages that could be implemented safely without product UX decisions
and explicitly deferred the ones that could not.

### Landed

- **Stage 1 — PatientCard / action rail UX fix.** `PatientPdfActions`
  now supports an `iconOnly` mode that renders two small circular
  icon buttons (Plexus PDF / Clinician PDF) instead of full-width
  text pills. The shared `PatientCard` uses `iconOnly`, so every
  surface that renders `PatientCard` (Visit, Outreach, Plexus IQ
  clinic detail, recent qualification cards, ResultsView, Engagement
  cards) inherits the compact action rail. The diagonal cut and the
  Engagement assignment badge are preserved. Text mode is still
  available for clinic-detail packet headers.
- **Stage 2 — Home calendar drawer.** `HomeDashboard` now exposes a
  Calendar icon button in the sticky header that opens the canonical
  `UniversalCalendarDrawer` with `profileId="admin"`. Cells are
  aggregated client-side from the existing
  `ScheduleDashboardResponse.clinicTabs[].monthCells` data — no new
  backend route is introduced. Selecting a date stores
  `homeSelectedCalendarDate` and closes the drawer; the existing
  dashboard's `selectedDate` state is untouched so existing
  read-paths still drive the rest of the home page.
- **Stage 10 — PTO-aware assignment ranking.** The
  `GET /api/patients/:id/engagement-assignment/options` route now
  joins `pto_requests` (status `approved`, `startDate <= today <=
  endDate`) against `outreach_schedulers.userId`. Schedulers on PTO
  today are flagged with `onPtoToday: true` and demoted to the
  bottom of the ranking. The frontend
  `ChangeEngagementAssignmentDialog` surfaces an "on PTO today"
  badge next to those schedulers. They are not removed — the operator
  may still need to assign them — but they sort last.

### Deferred (with reasons)

- **Stage 3 — Procedure staged workflow.** The existing schema's
  `procedureStatus` enum already supports `not_started / in_progress
  / complete / cancelled / no_show / reschedule_needed`. The
  user-facing button still says "Procedure Complete". Exposing the
  staged states requires UX placement decisions (which surfaces show
  which transitions, who can advance them, how a status change
  fans out to readiness) that can't responsibly happen inside a
  wiring batch.
- **Stage 4 — Report-upload → readiness side-effect.** A canonical
  endpoint already exists:
  `POST /api/case-document-readiness/complete` upserts the readiness
  row given an `executionCaseId`/`patientScreeningId` +
  `serviceType` + `documentType`. The frontend Document Library
  upload route doesn't currently call it after a `kind=report` save.
  This wire is a small focused integration that needs the upload UX
  flow described before landing.
- **Stages 5–9 — missing-doc tasks, readiness panel UI, billing
  recompute route, package transition route, projected/real invoice
  variance UI.** Each is real product work that needs the previous
  stages first.
- **Stage 11 — technician availability/qualification schema.**
  Already documented honestly in
  `docs/technician-central-architecture.md` with recommended shape.
  Half-baked tables would violate the no-faking rule.

### Verification

`npm run check` ✓, `npm run build` ✓, parser **164/164** ✓.

## Admin Approval gate batch landing

Migration `0025_add_patient_screening_admin_approval.sql` adds:

- `admin_approval_status text NOT NULL DEFAULT 'pending'`
- `admin_approved_at timestamp`
- `admin_approved_by_user_id varchar REFERENCES users(id)`
- `admin_approval_note text`
- `idx_patient_screenings_admin_approval_status`

### Canonical gate (now)

Send to Engagement requires **all** of:

1. `name`
2. `dob`
3. `phoneNumber`
4. `facility`
5. Non-empty `qualifyingTests` (qualification complete)
6. `adminApprovalStatus === "approved"` *(new gate)*

Backend enforces 1-3 + 6 in `commitPatient(..., { auto: false })`.
Auto-commits from AI batch analysis still skip the gate — the batch
is the implicit approval path.

### Routes added

- `POST /api/patient-screenings/:id/admin-approval` — sets
  `adminApprovalStatus` + `adminApprovedAt` + `adminApprovedByUserId`
  + `adminApprovalNote`. Appends a `patient_journey_events` row
  tagged `eventType = "admin_approval_updated"`.

### Frontend wires

- New `AdminApprovalControl` chip + dialog (`client/src/components/qualification/AdminApprovalControl.tsx`). Shows current status (`Pending review` / `Approved` / `Needs info` / `Rejected`) with status-specific tone. Clicking opens a 4-option dialog + optional note.
- Wired into the shared `PatientCard` next to the existing PDF / assignment badges. Only renders when the patient is PDF-eligible (qualification has run).
- `ResultsView` Send to Engagement gate now includes `admin approval` in its `missing[]` reason list.

### Qualification is NOT gated by contact info

The AI analyze button + batch analysis runner do not consult
`adminApprovalStatus` or missing DOB / phone. Qualification can run
on every patient that has enough clinical data — the gate only
exists in front of the canonical commit / Send to Engagement path.

### QA

- New `script/qaAdminApprovalEngagementGate.ts` + `qa:admin-approval-engagement-gate`. Verifies:
  - Parser still accepts rows with missing DOB / phone as warnings.
  - The mirrored gate predicate blocks every missing piece and unblocks when complete + approved.
  - With `DATABASE_URL`, performs a safe write on an `isTest=true` patient and appends a journey event tagged `qa_admin_approval_engagement_gate`, then restores the previous status.
- Currently passing **9/9** assertions (without DB).

### Verification

`npm run check` ✓, `npm run build` ✓, parser **164/164** ✓, `qa:admin-approval-engagement-gate` **9/9** ✓.

Apply migration `0025_add_patient_screening_admin_approval.sql` before exercising the new endpoint.

## Operational platform batches landing (post-admin-approval)

### Clean patient card layout

`PatientCard` is now split into four logical bands separated by clear
spacing instead of one jammed action row:

1. **Identity banner** — name + VISIT/OUTREACH + time + status pill (unchanged).
2. **Meta line** — DOB · age · insurance · phone (unchanged).
3. **Qualification chips** — readable text+count chips
   (`BrainWave · 2` / `VitalWave · 1` / `Ultrasound · 2`) using the
   shared `categoryStyles` palette. No more overlapping icons with
   floating count badges.
4. **Status chips row** — missing-info chip + admin approval chip +
   engagement assignment badge, dedicated to *state*.
5. **Action row** (separated by a hairline rule) — left: PDFs (icon-only)
   + a `More` dropdown that hides the destructive Remove patient
   action; right: the primary Generate / Re-generate pill.

Visit appointment time still renders in the banner and does not
push the layout. Same component is rendered by Visit + Outreach
builders, recent-qualifications cards, and Plexus IQ surfaces.

### Procedure staged workflow (copy distinction)

The user-facing action is now **"Procedure Performed"**. The action
only marks performance of the procedure and explicitly does **not**
imply report-uploaded / documents-complete / billing-ready. Backend
route name and `procedureEvents.procedureStatus = "complete"` enum
value stay — only the UI copy changed:

- `ProcedureCompleteButton` label + toast + tooltip.
- `PatientCommandCanvas` disabled-button copy + tooltip.
- `CalendarAddActionButton` and `calendarFilters.procedureCompleted`
  label updated to "Procedure Performed".

### Report-uploaded readiness endpoint

`POST /api/case-document-readiness/report-uploaded` (in
`server/routes/documentReadiness.ts`) is a thin wrapper around the
report-side path of `/complete`. It:

- Resolves the execution case + serviceType from
  `procedureEventId | executionCaseId | patientScreeningId`.
- Upserts the `case_document_readiness` row for
  `documentType = report` with status `uploaded`.
- Appends `patient_journey_events.eventType = "report_uploaded"`
  (`eventSource = "document_readiness"`) — explicitly distinct from
  the `procedure_performed` event.
- Re-evaluates billing readiness via the existing
  `evaluateBillingReadinessForProcedure` helper.
- Closes the matching open `Missing Report for …` Plexus task if one
  exists.

### Missing-document tasks

New helper module `server/repositories/missingDocumentTasks.repo.ts`
exposes `ensureMissingDocumentTask` + `resolveMissingDocumentTask`
keyed by `(patientScreeningId, documentType)` with title prefix
`Missing <Label>` so re-firing is idempotent. Plexus task statuses
use the existing `open` / `done` / `closed` convention.

Wires:

- `markProcedureComplete` (procedureEvents repo) opens an idempotent
  task per blocking doc type when a procedure is performed.
- `/complete` and `/report-uploaded` routes call
  `resolveMissingDocumentTask` for the doc they just satisfied.

The full doc-type set the helper covers is:
`informed_consent`, `screening_form`, `report`, `order_note`,
`post_procedure_note`, `billing_document`.

### Patient document readiness panel

`portalCommandCenter` now returns `documentReadiness[]` and
`billingReadinessChecks[]` alongside the existing read model. The
`PatientCommandCanvas` renders a new `DocumentReadinessPanel` card
between *Latest activity* and *Full history* with a 6-row checklist
(Consent / Screening Form / Report / Order Note / Procedure Note /
Billing Document). Each row shows Present/Missing, blocks-billing
flag, the linked document id when present, and a matching open
Plexus task id when one exists.

### Document generation routes

New route file `server/routes/ancillaryDocumentRequests.ts` with:

- `POST /api/ancillary-documents/:patientScreeningId/generate-order-note`
- `POST /api/ancillary-documents/:patientScreeningId/generate-procedure-note`
- `POST /api/ancillary-documents/:patientScreeningId/generate-billing-document`

Each route resolves the patient + execution case + serviceType,
upserts a `procedure_notes` row (`generationStatus: "pending"`) for
the note variants or a `billing_document_requests` row
(`requestStatus: "pending"`) for the billing variant. There is **no
fake generated document** — the route returns `{ requestStatus:
"pending" }` until a real generator pipeline lands. A
`document_generation_requested` patient journey event is appended.

### Billing readiness recompute

`POST /api/billing-readiness-checks/recompute` (added in
`billingReadiness.ts`) accepts
`{ patientScreeningId?, executionCaseId?, procedureEventId?, serviceType? }`,
resolves the execution case + serviceType (falling back to the most
recent procedure event for the patient), calls the existing
`evaluateBillingReadinessForProcedure` evaluator, and appends a
`billing_readiness_recomputed` journey event. Uses only existing
`BILLING_READINESS_STATUSES` enum values — never invents a new
status.

### Completed package transition

`POST /api/completed-billing-packages/:id/transition` accepts
`{ packageStatus, reason?, adminOverride? }` where `packageStatus`
is a canonical `PACKAGE_STATUSES` value
(`pending_payment | payment_updated | completed_package | added_to_invoice | invoiced | closed`)
or one of the shorthand aliases (`draft | ready | completed`).

Guard: moving to a terminal status
(`completed_package`/`added_to_invoice`/`invoiced`/`closed`) requires
the matching `billing_readiness_check` to be at
`ready_to_generate` / `billing_document_generated` / `sent_to_billing`,
unless `adminOverride=true`. Payment recording stays on the existing
`/payment` and `/api/billing/complete-package-payment` routes —
this route does not touch fullAmountPaid / paymentDate /
paymentStatus.

A `billing_package_transitioned` journey event is appended when the
patient/case is linked.

### Invoice projected/variance visibility

`PatientJourneyDrawer` now renders projected invoice rows inline in
the Invoices section: per-row `serviceType`, `projectedStatus`,
`realInvoiceLineItemId` (linkage), `projectedOurPortionAmount`, and
`varianceAmount` (colored green/red based on sign). When
`realInvoiceLineItemId` is null the row shows `not yet linked`.

### Technician central schema (deferred — exact blocker)

**Not landed in this batch.** Spec asked for new
`technician_availability` + `technician_qualifications` tables plus
enforcement on the scheduling routes. The deferral is intentional:

- `global_schedule_events` already carries `team_availability` event
  rows (used by `calendarFilters.ts` and the PTO routes).
- `outreach_schedulers` already maps users → facilities.
- Adding new dedicated tables without a product decision on how they
  coexist with or supersede the existing event-based availability
  + scheduler mapping would create the kind of parallel canonical
  system the platform spec explicitly forbids.

Next batch dedicated to this should answer: should
`team_availability` events stay as the source-of-truth, with new
qualifications joined by user id; or should the new tables replace
the event-based shape and the events become a derived view? Until
that decision, no half-baked schema lands.

### QA + verification

- New `script/qaProcedureReadinessSpine.ts` (`qa:procedure-readiness-spine`).
  Verifies the canonical enums the new routes rely on
  (`PROCEDURE_STATUSES`, `BILLING_READINESS_STATUSES`,
  `PACKAGE_STATUSES`) plus the transition route's shorthand alias map,
  and exercises the idempotent ensure/resolve helpers when
  `DATABASE_URL` is set on an `isTest=true` patient (then deletes the
  smoke task). 26/26 assertions passing without DB.
- `npm run check` ✓ · `npm run build` ✓ · parser **164/164** ✓ ·
  `qa:admin-approval-engagement-gate` **9/9** ✓ ·
  `qa:procedure-readiness-spine` **26/26** ✓.

## Premium Admin Review card workflow

The admin approval surface is now a first-class, premium experience —
no more chasing a tiny "Pending review" chip to make a decision.

### Lavender = ready for admin review

`client/src/lib/adminReviewStatus.ts` exposes `computeAdminReview()`
as the single source of truth used by both the card and the dialog.
A patient is **ready for admin review** when:

1. `name`, `dob`, `phoneNumber`, `facility` are present.
2. `qualifyingTests` has at least one entry (qualification ran).
3. `adminApprovalStatus` is `pending` or `needs_info`.
4. `commitStatus === "Draft"` (not yet sent to Engagement).

When all four hold, the `PatientCard` banner shifts from sky/navy to
a soft lavender gradient (`from-violet-50 via-violet-100 to-indigo-50`)
with a matching status pill reading **Ready for Admin Review**. The
old chip-as-primary-click-target is gone — the *banner itself* is
the signal.

Send to Engagement is unchanged: it still requires
`adminApprovalStatus === "approved"` regardless of lavender state.
Qualification generation is unchanged: missing DOB / phone still
parses as warnings only and never blocks the AI run.

### Premium category icons + tiles

The card front shows BrainWave / VitalWave / Ultrasound as small
rounded tiles (icon-in-circle + ALL-CAPS label + count) using the
shared `categoryStyles` palette. No overlapping count badges, no
plain text chips. Clicking any tile opens the unified
`AdminReviewDialog` — not three separate per-category popups.

### One unified Admin Review dialog

`client/src/components/qualification/AdminReviewDialog.tsx` is a wide
(`max-w-6xl`) dialog with three side-by-side columns
(BrainWave / VitalWave / Ultrasound). For each qualifying test the
column shows the canonical AI reasoning (clinician understanding,
patient talking points, qualifying factors, ICD-10, pearls — same
content the previous per-category popup displayed) plus a per-test
**Admin Justification** block with Add / Edit / Save.

- Per-test justification persists through the canonical
  `patient_screenings.reasoning` jsonb column under the existing
  `testReasoningSchema` shape — two new optional fields
  `admin_justification` + `admin_justification_updated_at` extend the
  schema additively. No parallel justification store, no DB
  migration required.
- Delete buttons next to each test call the same `onRemoveTest`
  bridge `PatientEditDialog` already uses; the helper falls back to
  a canonical `qualifyingTests` filter+update when no removal
  callback is provided. The matching reasoning entry is dropped at
  the same time so future re-generations don't inherit an orphan
  admin justification.
- The footer is the *primary* approval surface:
  **Approve · Needs Info · Reject · Reset to Pending · Close**.
  All flow through the existing
  `POST /api/patient-screenings/:id/admin-approval` endpoint added
  in the prior admin-approval batch.
- Save invalidates `/api/screening-batches` and the matching
  command-center query so the card lavender state updates instantly.

### PatientEditDialog "Admin Review" section

Inside the existing patient edit modal, immediately below the
**Qualifying Tests** chip row, a new **Admin Review** section
renders a single premium button. The button label + tone reflect
the current `computeAdminReview()` state:

- Pending + ready → violet "Ready for Admin Review" CTA.
- `approved` → emerald "Approved · Open Admin Review".
- `rejected` → rose "Rejected · Open Admin Review".
- `needs_info` → "Needs Info · Open Admin Review".

Clicking opens the same `AdminReviewDialog`. PatientEditDialog
otherwise keeps every existing affordance.

### QA

- New `script/qaAdminReviewCardFlow.ts` (`qa:admin-review-card-flow`)
  covers:
  - `computeAdminReview()` ready / incomplete / approved / rejected /
    needs_info / sent-to-engagement transitions.
  - Parser still accepts missing-DOB / missing-phone rows as warnings
    (qualification stays unblocked).
  - `getAncillaryCategory` grouping matches the card-front tile row.
  - Canonical delete flow shrinks `qualifyingTests` correctly.
  - 31/31 assertions passing without DB.

### Verification

`npm run check` ✓ · `npm run build` ✓ · parser **164/164** ✓ ·
`qa:admin-approval-engagement-gate` **9/9** ✓ ·
`qa:admin-review-card-flow` **31/31** ✓.
