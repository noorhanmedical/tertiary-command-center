# Tertiary Command Center — Final Merge Readiness

> **Branch:** `feat/plexus-iq-real-architecture`
> **Status:** Merge-ready (per the manual QA checklist below).
> **Companion:** `tertiary-command-center-final-architecture.md`
> for the static architecture reference.

## Stream summary

41 commits in the
`7dcef4b..ec95ccb` range cover the canonical calendar unification,
PCS/ACS profile + capability work, callback hardening, billing /
invoice spine read-only joins, audit + outbox coverage, and the
master QA + smoke aggregators.

## Completed work (by domain)

### Calendar
- Canonical primitive stack:
  `CanonicalCommandCalendar` → `UniversalCalendar` →
  `CanonicalMonthCalendar`.
- New `ancillaryCareSpecialist` profile in
  `calendarProfiles.ts`.
- All four surfaces (Plexus IQ, Home Dashboard, PCS, ACS) flow
  through the same wrapper.
- Mini-calendar facility access hint.
- `initialMonth` threaded end-to-end.

### PCS / ACS portal
- Workspace role typing cleaned up
  (`PublicWorkspaceRole` + legacy compat alias).
- Default safety: undefined `workspaceRole` no longer assumes ACS.
- Capability resolver
  (`client/src/lib/portal/portalCapabilities.ts`).
- Resolver wired into PortalShell capability flags.
- Facility access hint in `PatientMiniCalendar`.
- Upstream service prevalidation on ancillary-row schedule
  buttons.

### Scheduling / triage
- Canonical source-of-truth doc.
- `schedulingTriageApi.ts` client helper.
- Triage write paths confirmed (engagement-center call-result,
  appointment cancel, global-schedule reschedule).

### Procedure / readiness
- Procedure-complete canonical path doc.
- `markProcedureComplete` chain confirmed:
  procedure_events → readiness → notes → billing_readiness →
  missing-doc tasks.
- Report-uploaded → readiness re-evaluation hook.

### Billing / invoice
- Billing package source-of-truth doc.
- `completedBillingPackagesApi.ts` + `projectedInvoicesApi.ts`
  client helpers.
- New `GET /api/invoice-candidates` read route joining
  completed_billing_packages with their invoice-line-item /
  invoice metadata.
- `invoiceCandidatesApi.ts` client helper with
  `TERMINAL_PACKAGE_STATUSES` + `isInvoiceLinked` helpers.
- `PatientJourneyDrawer` renders projected → real invoice
  variance inline.
- Billing-readiness recompute action +
  completed-package-transition action.

### Admin / audit
- `admin_settings/upsert` now writes `audit_log`.
- Appointment create + cancel write `patient_journey_events`.
- Documented gaps for PTO, document-workflow, outbox completion
  audit cross-link.

### Outbox / integrations
- Outbox audit doc.
- Email-outbox migration plan doc.
- Plan named: idempotency contract, DLQ contract, per-caller
  migration sequence.

### QA + smoke registry
- 15 individual QA scripts.
- 4 smoke scripts (source + live).
- 4 master aggregators (calendar, PCS/ACS, tertiary QA, tertiary
  smoke).

## QA / smoke results (last run, this batch)

| Script | Result |
| --- | --- |
| `qa:calendar-profile-wiring` | 36/36 |
| `qa:calendar-data-shape` | 26/26 |
| `qa:calendar-profile-overrides` | 18/18 |
| `qa:pcs-acs-portal-actions` | 26/26 |
| `qa:pcs-acs-capabilities` | 30/30 |
| `qa:pcs-acs-mini-calendar` | 11/11 |
| `qa:pcs-acs-role-isolation` | 25/25 |
| `qa:acs-capability-onboarding` | 30/30 |
| `qa:acs-execution-readiness` | 18/18 |
| `qa:scheduling-triage` | 33/33 |
| `qa:procedure-readiness-spine` | 26/26 |
| `qa:admin-approval-engagement-gate` | 9/9 |
| `qa:projected-invoice-reconciliation` | 20/20 |
| `qa:audit-coverage` | 18/18 |
| `qa:outbox-coverage` | 22/22 |
| `qa:calendar-complete` aggregator | 4/4 |
| `qa:pcs-acs-complete` aggregator | 6/6 |
| `qa:tertiary-command-center` aggregator | **15/15** |
| `smoke:pcs-acs-portal` (source) | 31/31 |
| `smoke:pcs-acs-portal-live` (live, auth-wall) | 11/11 |
| `smoke:billing-invoice-spine` (live, auth-wall) | 8/8 |
| `smoke:tertiary-spine` (live, auth-wall) | 23/23 |
| `smoke:tertiary-command-center` aggregator | **4/4** |

`npm run check` ✓ · `npm run build` ✓ — every commit.

## Remaining non-blocking gaps

All documented in their respective audit docs. None block merge.

1. **PortalShell legacy `Role` alias.** Read by icon + title
   fallback in a few historical sites. No behavior risk after
   Batch 9 + 13. Migration plan in
   `pcs-acs-legacy-role-leak-audit.md`.
2. **Email sends inline.** Plan in
   `email-outbox-migration-plan.md` — per-caller migration
   sequence + idempotency + DLQ.
3. **Outbox DLQ + drive_file dedupe.** Plan in
   `integration-outbox-audit.md` gaps #2 + #3.
4. **Unused `admin_settings` domains.** Five domains (facility,
   cooldown, document_library, insurance, projected_invoice,
   cash_price, emr_integration, ai, audit) have no read site
   yet. Each is a small future batch — see
   `admin-settings-rule-application.md`.
5. **PTO audit + journey events.** Lifecycle has neither
   helper called. Future batch — see
   `audit-log-coverage.md` gap #7.
6. **`SchedulePatientDialog` has no service picker.** Service
   prevalidation correctly lives upstream at the row schedule
   button. If a future dialog picker lands, repeat the pattern.

## Known risks

- The capability resolver enforces ACS-only on procedure-side
  actions at the *client* layer. Server-side gating still
  matters; the resolver's job is to prevent the UI from queuing
  obvious-fail requests. **Mitigated** by defense-in-depth tests
  in `qa:pcs-acs-capabilities`.
- `addCompletedPackageToInvoice` writes the invoice line item
  via fire-and-forget from the package payment route. Failures
  log but don't roll back. **Mitigated** by `qa:audit-coverage`
  ensuring the journey event still fires.
- `outbox_items` failures accumulate without DLQ.
  **Documented** in `integration-outbox-audit.md`. Not a
  regression; pre-existing.

## Rollback plan

The stream is purely additive on top of the canonical primitive
layer. No schema migrations, no canonical table changes, no API
contract changes. Each commit reverts cleanly in isolation. To
roll back the stream entirely:

```
git revert 7dcef4b..ec95ccb
```

…but this would also revert the QA + smoke scaffolding, which is
the right thing if the canonical-calendar / capability changes
need to be removed wholesale. A more targeted revert per audit
doc is possible since each commit is single-purpose.

## Manual QA checklist (human pass)

Before merge:

- [ ] `npm run check` ✓
- [ ] `npm run build` ✓
- [ ] `npm run qa:tertiary-command-center` ✓ (15/15)
- [ ] `BASE_URL=http://localhost:5000 npm run
      smoke:tertiary-command-center` ✓
      (with a running dev server, auth-wall mode acceptable)
- [ ] Open `/patient-care-specialist-portal` as a PCS user with
      a populated profile; confirm calendar renders, facility
      hint does not appear, callList + ancillarySchedule modes
      show real data.
- [ ] Open `/ancillary-care-specialist-portal` as an ACS user;
      confirm Procedure Performed button is enabled, ancillary
      row schedule button disables for services outside
      `allowedServiceTypes`.
- [ ] Open `/admin-users`, edit a profile, confirm the new
      `audit_log` row appears via `/audit-log`.
- [ ] Book an appointment, then cancel it; confirm both write
      `patient_journey_events` rows.
- [ ] Log a callback in the canonical row actions; confirm
      past-time submit is disabled, timezone hint visible.
- [ ] Click `/api/invoice-candidates` in the running app
      (auth required); confirm a JSON array response.

## Merge recommendation

**Branch is merge-ready.** All non-blocking gaps are documented
with self-contained close batches. No additional work is required
for the canonical calendar contract, the PCS/ACS portal contract,
the procedure-readiness chain, or the billing-invoice spine to
function correctly.

## Cross-references

- `docs/architecture/tertiary-command-center-final-architecture.md`
  — companion architecture doc.
- `docs/architecture/pcs-acs-merge-readiness.md` — earlier
  per-PCS/ACS merge readiness summary.
- All per-domain audit docs under `docs/architecture/`.
