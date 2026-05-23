# Tertiary Command Center — Final Architecture

> **Scope:** Definitive architecture reference at the end of the
> `feat/plexus-iq-real-architecture` stream. Read in tandem with
> the per-domain audit docs under `docs/architecture/`.

## One-line spine

```
patient_screenings → patient_execution_cases → procedure_events
  → case_document_readiness → documents (document_library_items)
  → billing_readiness_checks → billing_document_requests
  → completed_billing_packages → invoice_line_items → invoices
  → projected_invoice_rows
  ↘ patient_communications / outreach_calls / global_schedule_events
    / scheduling_triage_cases / plexus_tasks
  ↘ admin_settings · audit_log · outbox_items · patient_journey_events
```

`patient_journey_events` is the per-patient audit trail; `audit_log`
is the system-wide actor + action log. Both are written at every
canonical state transition.

## Canonical UI surfaces

| Page | Role | Canonical source |
| --- | --- | --- |
| `/home` (Home Dashboard) | All roles | Aggregated dashboard + shared canonical calendar (`profileId="admin"`) |
| `/plexus-iq` | Qualification | Plexus IQ workspace + shared canonical calendar (`profileId="plexusIq"`) |
| `/patient-care-specialist-portal` | PCS | PortalShell with `role="patientCareSpecialist"` |
| `/ancillary-care-specialist-portal` | ACS | PortalShell with `role="ancillaryCareSpecialist"` |
| `/engagement-center` | Engagement | engagement assignment board |
| `/billing` | Biller | billing rows + readiness + completed packages |
| `/invoices` | Biller | invoices + line items + projected rows |
| `/documents` / `/document-library` | All | document library + readiness checklist |
| `/audit-log` | Admin | system-wide audit log |
| `/admin-outbox` | Admin | outbox dashboard |
| `/admin-users` | Admin | team member profile editor |

All calendar surfaces flow through one component:
`client/src/components/calendar/CanonicalCommandCalendar.tsx`.

## Calendar profile registry

`client/src/calendar/calendarProfiles.ts`:

`plexusIq` · `patientCareSpecialist` · **`ancillaryCareSpecialist`** ·
`technician` · `manager` · `admin` · `facility`

Profile selection map:

- PCS → `patientCareSpecialist`
- ACS → `ancillaryCareSpecialist` (legacy `technician` / `liaison`
  workspace strings also map to ACS via the compatibility
  classifier)
- Plexus IQ → `plexusIq`
- Home Dashboard → `admin`

`admin_settings` rows under
`(settingDomain="global_schedule", settingKey="calendar_profiles")`
override profile defaults with the precedence
global → user → facility → user+facility.

## Capability resolver

`client/src/lib/portal/portalCapabilities.ts` exposes
`resolvePortalCapabilities()` + `defaultSafePortalCapabilities()`.

Resolves the ten canonical capabilities from the user's resolved
team-member profile while enforcing defense-in-depth: procedure-side
capabilities require an ACS-typed workspace at runtime, regardless
of the profile bit. The resolver is the gate for every
`workspaceCan*` flag in PortalShell.

## Canonical write actions

| Action | Endpoint | Canonical side-effects |
| --- | --- | --- |
| Mark Procedure Performed | `POST /api/procedure-events/complete` | upserts readiness · queues notes · re-evaluates billing · opens missing-doc tasks |
| Document complete | `POST /api/case-document-readiness/complete` | upserts readiness · re-evaluates billing · closes matching missing-doc task |
| Report uploaded | `POST /api/case-document-readiness/report-uploaded` | same evaluator + dedicated journey event |
| Billing readiness recompute | `POST /api/billing-readiness-checks/recompute` | manual re-evaluation + journey event |
| Package payment | `POST /api/billing/complete-package-payment` | finalizes package + line item + invoice |
| Package transition | `POST /api/completed-billing-packages/:id/transition` | draft → ready → completed → invoiced |
| Engagement call result | `POST /api/engagement-center/call-result` | creates triage row + journey + communication |
| Appointment book | `POST /api/appointments` | creates appointment + journey + audit_log |
| Appointment cancel | `PATCH /api/appointments/:id` | cancels + journey + audit_log |
| Admin settings upsert | `POST /api/admin-settings/upsert` | persists row + audit_log |

Every action above writes to `patient_journey_events` and/or
`audit_log`. Coverage is enforced by `qa:audit-coverage`.

## Canonical read API

| Domain | Endpoint | Client helper |
| --- | --- | --- |
| Schedule | `/api/global-schedule-events` | `globalScheduleApi.ts` |
| Scheduling triage | `/api/scheduling-triage-cases` | `schedulingTriageApi.ts` |
| Document readiness | `/api/case-document-readiness` | `documentReadinessApi.ts` |
| Document library | `/api/document-library/items` | `documentLibraryApi.ts` |
| Billing readiness | `/api/billing-readiness-checks` | (via evaluator) |
| Completed packages | `/api/completed-billing-packages` | `completedBillingPackagesApi.ts` |
| Invoice candidates | `/api/invoice-candidates` | `invoiceCandidatesApi.ts` |
| Projected invoices | `/api/projected-invoice-rows` | `projectedInvoicesApi.ts` |
| Admin settings | `/api/admin-settings` + `/effective` | `adminSettingsApi.ts` |
| Outbox | `/api/outbox` | (admin-only) |
| Audit log | `/api/audit-log` | (admin-only) |

## QA + smoke coverage

| Aggregator | Children |
| --- | --- |
| `qa:calendar-complete` | wiring · data-shape · overrides · mini-calendar |
| `qa:pcs-acs-complete` | actions · capabilities · mini · role-isolation · onboarding · execution-readiness |
| `qa:tertiary-command-center` | calendar + PCS/ACS + triage + procedure/readiness + admin-approval + projected-invoice + audit + outbox |
| `smoke:pcs-acs-portal` | source-level contract (no server) |
| `smoke:tertiary-command-center` | source-level smoke + live smokes when BASE_URL is set |
| `smoke:pcs-acs-portal-live` | live PCS/ACS routes (auth-wall mode without COOKIE) |
| `smoke:billing-invoice-spine` | live billing/invoice routes |
| `smoke:tertiary-spine` | live full-spine smoke |

`npm run qa:tertiary-command-center` runs 15 child scripts to
green. `npm run smoke:tertiary-command-center` runs 4 smoke scripts
when `BASE_URL` is set.

## Architecture docs in this stream

- `docs/architecture/tertiary-command-center-canonical-spine.md`
- `docs/architecture/calendar-source-of-truth.md`
- `docs/architecture/scheduling-triage-source-of-truth.md`
- `docs/architecture/procedure-complete-canonical-path.md`
- `docs/architecture/billing-package-source-of-truth.md`
- `docs/architecture/pcs-acs-portal-solidness-audit.md`
- `docs/architecture/pcs-acs-legacy-role-leak-audit.md`
- `docs/architecture/pcs-acs-service-prevalidation-audit.md`
- `docs/architecture/pcs-callback-action-audit.md`
- `docs/architecture/acs-capability-onboarding-audit.md`
- `docs/architecture/admin-settings-rule-application.md`
- `docs/architecture/integration-outbox-audit.md`
- `docs/architecture/audit-log-coverage.md`
- `docs/architecture/email-outbox-migration-plan.md`
- `docs/architecture/pcs-acs-merge-readiness.md`
- `docs/architecture/tertiary-command-center-final-architecture.md`
  *(this doc)*
- `docs/architecture/tertiary-command-center-final-merge-readiness.md`
  *(next batch)*

## Non-blocking gaps (named in audits)

1. PortalShell `Role = "technician" | "liaison"` legacy alias is
   read by historical compat sites — see
   `pcs-acs-legacy-role-leak-audit.md`.
2. Email sends inline (no outbox kind yet) — see
   `email-outbox-migration-plan.md`.
3. Outbox has no DLQ + no `drive_file` content-hash dedupe — see
   `integration-outbox-audit.md`.
4. `admin_settings.{facility,cooldown,document_library,insurance,
   projected_invoice,cash_price,emr_integration,ai,audit}` have
   no read sites yet — see `admin-settings-rule-application.md`.
5. PTO lifecycle has neither `logAudit` nor journey events — see
   `audit-log-coverage.md`.
6. `SchedulePatientDialog` has no service picker — see
   `pcs-acs-service-prevalidation-audit.md`.

Each gap has a self-contained close-batch plan in its audit doc.

## Cross-references

- `README.md` for product overview.
- `package.json` for the full QA + smoke script registry.
- `client/src/components/calendar/CanonicalCommandCalendar.tsx`
  for the single canonical calendar entry point.
- `client/src/lib/portal/portalCapabilities.ts` for the capability
  resolver.
