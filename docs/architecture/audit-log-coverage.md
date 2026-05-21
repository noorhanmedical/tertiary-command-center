# Audit Log — Coverage Audit

> **Scope:** Where mutations write to the audit log (or
> `patient_journey_events`, the canonical patient-bound audit trail)
> versus where they don't. This document is an inventory, not a
> remediation batch — no mutations land from this audit.
>
> The audit log has two distinct readers:
> - **`audit_log`** (`logAudit(req, ...)` →
>   `server/services/auditService.ts`) — system-wide actor + action
>   log surfaced by `client/src/pages/audit-log.tsx`.
> - **`patient_journey_events`**
>   (`appendPatientJourneyEvent(...)` →
>   `server/repositories/executionCase.repo.ts`) — patient-bound
>   audit trail surfaced by `PatientJourneyDrawer` +
>   portal command center.
>
> Both live in parallel by design: `audit_log` is for "what did the
> human do", `patient_journey_events` is for "what state moved on
> this patient". Most critical mutations should hit *both*. This
> doc names which already do and which only hit one.

## Helper reference

- `logAudit(req, action, entityType, entityId, changes)` — writes a
  row to `audit_log`. Best-effort: errors are caught + logged but
  never block the calling mutation.
- `appendPatientJourneyEvent({ patientName, eventType,
  eventSource, ... })` — writes a row to `patient_journey_events`.
  Required `patientName` (text). Returns the appended row.

## Coverage today (write sites)

### Routes hitting `audit_log` (via `logAudit`)

| Route | Action | Entity | Notes |
| --- | --- | --- | --- |
| `batches.ts` | create / update / delete | `batch` | batch lifecycle |
| `batches.ts` | create | `patient` | bulk patient creation |
| `patients.ts` | update / delete / restore / commit / recall | `patient` | per-patient lifecycle |
| `invoices.ts` | create / update / send / delete | `invoice` + `invoice_payment` | full invoice lifecycle |
| `appointments.ts` | create / cancel | `appointment` | per-appointment lifecycle |
| `billing.ts` | create / update / delete | `billing_record` | billing record lifecycle |
| `plexusIqClinicalImport.ts` | create | `patient_screenings_bulk` | import bulk |

### Routes hitting `patient_journey_events` (via `appendPatientJourneyEvent`)

| Route | Event types | Notes |
| --- | --- | --- |
| `executionCases.ts` | engagement bucket / lifecycle transitions, triage events | engagement audit |
| `documentReadiness.ts` | `document_completed` · `report_uploaded` | per-doc readiness |
| `documentLibrary.ts` | document item reviews | per-doc lifecycle |
| `globalSchedule.ts` | schedule events | per-event audit |
| `ancillaryDocumentRequests.ts` | `document_generation_requested` | order / procedure / billing doc requests |
| `completedBillingPackages.ts` | `billing_payment_updated` · `added_to_invoice` · `billing_package_transitioned` | per-package lifecycle |
| `billingReadiness.ts` | `billing_readiness_recomputed` | readiness recompute |
| `plexusTasks.ts` | task state changes | per-task lifecycle |
| `patients.ts` | `admin_approval_updated` (admin approval gate) | per-patient approval |

### Routes hitting *both* logs

- Patient lifecycle (`patients.ts`) writes to `audit_log` AND emits
  `admin_approval_updated` journey events.
- Invoices (`invoices.ts`) writes to `audit_log` AND, when paired
  with a `completedBillingPackages` payment, emits
  `added_to_invoice` journey events from the package side.
- Appointments (`appointments.ts`) writes to `audit_log` only —
  per-patient journey is not appended for appointment create/cancel.
  *(Gap below.)*

## Named gaps

These mutations land state but currently audit-log-only or
journey-only, not both. Each is a candidate close-up batch.

1. **Appointment create / cancel** — `appointments.ts` writes
   `audit_log` but no `patient_journey_events`. Adding
   `eventType: "appointment_created"` / `"appointment_cancelled"`
   would let the patient timeline reflect schedule changes.

2. **Billing record updates** — `billing.ts` writes `audit_log`
   but not journey events. A `billing_record_updated` journey row
   keyed on the linked patient would close the loop.

3. **Outreach call results** — `outreach.ts` writes
   `outreach_calls` rows and updates `patient_communications`,
   but only emits a journey event through the
   `patient_communications` repository (when present). Audit log
   coverage of *who* logged the call is partial.

4. **Outbox completions** — `outbox.ts` drains complete with
   `documents.driveFileId` updates, but no journey event fires
   when a Drive upload lands. See
   `docs/architecture/integration-outbox-audit.md` gap #5.

5. **Admin settings upsert** —
   `POST /api/admin-settings/upsert` (admin-only) does not
   currently `logAudit`. Settings changes are a high-trust
   surface and should always be in `audit_log`.

6. **Document workflow status flips** — `documentLibrary.ts`
   item-review actions emit journey events but no `audit_log`
   row; the actor user is recorded via `eventSource` /
   `actorUserId` on the journey row, but the system-wide
   audit-log view doesn't surface these without a manual cross-walk.

7. **PTO requests** — `pto.ts` lifecycle (request → approve /
   reject) writes its own table but neither helper is called.

## Apply-where-safe (intentionally none)

This batch is documentation-only. No `logAudit` calls or
`appendPatientJourneyEvent` calls were added. The reason is the
two helpers carry slightly different reliability contracts (one
swallows errors, one returns the row) — wiring them blindly into
every mutation in a single batch would change the shape of every
listed route in ways that need per-route review.

## Recommended close order (smallest first)

1. **Admin settings upsert** — single endpoint, single
   `logAudit` line. Highest ROI for trust.
2. **Appointment create/cancel** journey-event append.
3. **Billing record update** journey-event append.
4. **PTO lifecycle** audit + journey appends.
5. **Outbox completion** journey-event append (depends on outbox
   audit doc gap #5).
6. **Document workflow status flips** add complementary `logAudit`
   row alongside the existing journey event.

## Cross-references

- `server/services/auditService.ts` — `logAudit` helper.
- `server/repositories/executionCase.repo.ts` — `appendPatientJourneyEvent`.
- `client/src/pages/audit-log.tsx` — admin audit dashboard.
- `client/src/components/patient/PatientJourneyDrawer.tsx` —
  per-patient journey UI.
- `docs/architecture/tertiary-command-center-canonical-spine.md` —
  canonical spine reference.
- `docs/architecture/integration-outbox-audit.md` — outbox
  cross-references gap #5.
