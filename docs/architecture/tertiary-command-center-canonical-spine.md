# Tertiary Command Center — Canonical Spine

> **Scope:** This document is the architecture map for the
> Tertiary Command Center repo. It is the *actual* canonical spine as
> wired today, not an aspirational diagram. Read alongside
> `docs/full-platform-canonical-wiring-audit.md` which carries the
> per-batch landing notes; this doc is the static reference.
>
> When a domain wire is fully landed, it says so. When a wire is
> partial, the gap is named. Where a wire is missing or honestly
> deferred, it is marked accordingly — never faked.

## Canonical flow (one line per hop)

```
patient_screenings
  → patient_execution_cases           (canonical engagement spine)
  → patient_journey_events            (audit trail across the whole flow)
  → outreach_calls / outreach_schedulers / outreach_tasks
  → global_schedule_events            (single calendar source of truth)
  → scheduling_triage_cases           (reschedule / callback / no-show)
  → procedure_events                  (canonical procedure-performed row)
  → procedure_notes / generated_notes (order_note · post_procedure_note)
  → case_document_readiness           (per-doc readiness rows)
  → documents (document_library_items)
  → patient_communications            (call · sms · email · marketing · note)
  → billing_readiness_checks          (per-procedure readiness evaluation)
  → billing_document_requests         (pending billing doc requests)
  → completed_billing_packages        (draft → ready → completed)
  → invoice_line_items                (canonical invoice line)
  → invoices                          (canonical invoice header)
  → invoice_payments                  (payment records)
  → projected_invoice_rows            (projected vs real linkage)
  → admin_settings                    (rules + percentages + facility scopes)
  → audit_log / outbox                (mutation logging + external write queue)
```

## Schema domains (what lives where)

| Domain | Canonical table | File |
| --- | --- | --- |
| Patient identity | `patient_screenings` | `shared/schema/screening.ts` |
| Engagement spine | `patient_execution_cases` | `shared/schema/executionCase.ts` |
| Journey audit trail | `patient_journey_events` | `shared/schema/executionCase.ts` |
| Outreach calls | `outreach_calls` | `shared/schema/outreach.ts` |
| Outreach assignment | `outreach_schedulers` | `shared/schema/outreach.ts` |
| Outreach tasks | `outreach_tasks` | `shared/schema/outreach.ts` |
| Global schedule | `global_schedule_events` | `shared/schema/globalSchedule.ts` |
| Scheduling triage | `scheduling_triage_cases` | `shared/schema/schedulingTriage.ts` |
| Procedure performance | `procedure_events` | `shared/schema/procedureEvents.ts` |
| Procedure notes | `procedure_notes` | `shared/schema/generatedNotes.ts` |
| Document readiness | `case_document_readiness` | `shared/schema/documentReadiness.ts` |
| Document library | `documents` | `shared/schema/documents.ts` |
| Patient communications | `patient_communications` | `shared/schema/patientCommunications.ts` |
| Billing readiness | `billing_readiness_checks` | `shared/schema/billingReadiness.ts` |
| Billing doc requests | `billing_document_requests` | `shared/schema/billingDocuments.ts` |
| Completed packages | `completed_billing_packages` | `shared/schema/completedBillingPackages.ts` |
| Invoices | `invoices` + `invoice_line_items` + `invoice_payments` | `shared/schema/invoices.ts` |
| Projected invoices | `projected_invoice_rows` | `shared/schema/projectedInvoices.ts` |
| Admin settings | `admin_settings` | `shared/schema/adminSettings.ts` |
| Audit log | wired via `auditLog` / `patient_journey_events` | `server/routes.ts` + repos |
| Outbox | `integration_outbox` (route at `/api/outbox`) | `server/routes/outbox.ts` |

## UI surfaces (where the user lives)

| Page | Source of truth | Notes |
| --- | --- | --- |
| `home.tsx` | aggregated dashboard | Calendar drawer uses `UniversalCalendarDrawer` with `admin` profile |
| `SchedulePage.tsx` / `schedule-dashboard.tsx` / `shared-schedule.tsx` | `global_schedule_events` | Single canonical calendar |
| `outreach.tsx` / `outreach-scheduler-portal.tsx` | `outreach_calls` + `outreach_schedulers` + `outreach_tasks` + `scheduling_triage_cases` | Reschedule/callback queue surfaces triage |
| `patient-care-specialist-portal.tsx` / `ancillary-care-specialist-portal.tsx` / `team-member-portals.tsx` | `portalCommandCenter` aggregate | Reads `documentReadiness`, `billingReadinessChecks`, `tasks`, `documents`, `journey` |
| `technician-portal.tsx` / `liaison-portal.tsx` | `global_schedule_events` + `procedure_events` | Marks Procedure Performed |
| `documents.tsx` / `document-library.tsx` / `document-upload.tsx` | `documents` + `case_document_readiness` | Library + per-case readiness |
| `billing.tsx` | `billing_readiness_checks` + `billing_document_requests` + `completed_billing_packages` | Per-row readiness, transition action |
| `invoices.tsx` | `invoices` + `invoice_line_items` + `invoice_payments` + `projected_invoice_rows` | Invoice canvas + projected variance |
| `engagement-center.tsx` | `patient_execution_cases` + assignment board | Engagement bucket workflow |
| `plexus-iq.tsx` / `plexus-tasks.tsx` | qualification workspace | AI batch analysis spine |
| `qualification.tsx` / `outreach-qualification.tsx` | `screening_batches` + `patient_screenings` | Build/qualify before send to engagement |
| `audit-log.tsx` | `/api/audit-log` | Read-only audit surface |
| `admin-outbox.tsx` | `/api/outbox` | Admin outbox dashboard |
| `admin.tsx` / `admin-ops.tsx` / `admin-users.tsx` / `admin-analysis-jobs.tsx` | `admin_settings` + ops surfaces | Settings + ops control |

## Source-of-truth per domain (read sites)

- **Schedule:** Every schedule read site (Home, Schedule page, portals) reads via `/api/global-schedule-events` (canonical) or
  `globalScheduleEvents` via `storage.ts`. Per-portal calendar profiles
  filter to the relevant `eventType`s. The `UniversalCalendarDrawer`
  + `calendarProfiles.ts` enforce this.
- **Procedure performance:** `procedure_events.procedureStatus`
  (`not_started | in_progress | complete | cancelled | no_show |
  reschedule_needed`). Performed = `complete`. Report upload, document
  completion, and billing readiness are *separate* hops on the spine.
- **Document readiness:** `case_document_readiness` rows are upserted
  by `POST /api/case-document-readiness/complete` and
  `/report-uploaded`. The evaluator
  (`evaluateBillingReadinessForProcedure`) drives
  `billing_readiness_checks`.
- **Billing readiness:** Recompute via
  `POST /api/billing-readiness-checks/recompute`. Uses only existing
  enum values (`not_ready | missing_requirements | ready_to_generate |
  billing_document_generated | sent_to_billing`).
- **Completed package transitions:**
  `POST /api/completed-billing-packages/:id/transition`. Accepts the
  canonical `PACKAGE_STATUSES` enum (plus `draft|ready|completed`
  aliases). Terminal transitions require readiness satisfied or
  `adminOverride=true`.
- **Invoices:** `invoices` + `invoice_line_items` are the canonical
  invoice surface. `projected_invoice_rows.realInvoiceLineItemId`
  links projected rows to real lines; `varianceAmount` records the
  delta.
- **Outreach:** `outreach_calls` is the per-call source, but
  unified communications also flow through `patient_communications`
  (Type: `call` / `sms` / `email` / `marketing_email` / `marketing_sms`
  / `internal_note` / `system_note`).
- **Admin approval:** `patient_screenings.adminApprovalStatus`
  (`pending | approved | needs_info | rejected`). Gates manual Send
  to Engagement. Auto-commits from AI batch analysis bypass the gate.

## Legacy / local / demo data sources (none are canonical)

The following exist for development convenience and **are not** the
source of truth. They are explicitly named so future wiring batches
don't accidentally promote them:

- `client/src/pages/clinic-workflow-demo.tsx` — demo-only fixture, not
  read by canonical surfaces.
- Seed scripts (`script/seed*.ts`) — write canonical tables for dev
  fixtures. Do not source production reads from these.
- `script/testFixture.ts` (server-side fixture endpoints) — gated
  behind `NODE_ENV !== "production"`.

If any production surface starts reading from one of these, that is
a regression to flag in the next audit.

## Recommended wiring order (when adding new domains)

1. Schema first — add table + insert schema + types to `shared/schema/*`.
2. Repository helper — add `server/repositories/<domain>.repo.ts`
   with idempotent reads and explicit upserts.
3. Route file — `server/routes/<domain>.ts` with a `register*Routes`
   exported function. Add to `server/routes.ts`.
4. Client helper — `client/src/lib/workflow/<domain>Api.ts` for the
   read paths and any narrowly-scoped action paths.
5. UI surface — wire the page to the helper. Preserve the existing
   layout; do not redesign in the same batch.
6. Journey event — append a `patient_journey_events` row on every
   meaningful state change. The event's `eventType` and `eventSource`
   are the audit primary key for retrospective replay.
7. Audit + outbox — if the change is externally visible or
   integration-bound, enqueue an outbox row instead of inlining
   the side effect.
8. QA — add a smoke/QA script under `script/qa*` that covers the
   canonical enum/values + at least one DB-optional path.

## Cross-references

- `docs/full-platform-canonical-wiring-audit.md` — per-batch
  landing notes (admin approval gate, operational platform batches,
  premium admin review workflow, etc.).
- `docs/calendar-architecture.md` — schedule surface canonical wiring.
- `docs/clinic-workflow-spine.md` — clinic + workflow integration.
- `docs/billing-invoicing-architecture.md` — billing + invoice flow.
- `docs/ancillary-documents-architecture.md` — document spine.
- `docs/engagement-center-architecture.md` — engagement bucket + assignment.
- `docs/team-member-portals-architecture.md` — portal command center.
- `docs/plexus-iq-workspace-organization.md` — qualification spine.
