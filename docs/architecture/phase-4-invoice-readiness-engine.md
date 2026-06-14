# Phase 4 — Invoice readiness engine (PR 4.2)

## Decision

Added a new dedicated `invoice_readiness_snapshots` table rather
than extending `billing_readiness_checks`. The existing checks table
is a Phase 1 per-procedure scaffold; the Phase 4 snapshot is a
per-(case, testType, policy snapshot) decision that needs a unique
index on `(execution_case_id, service_type)` for upsert idempotency
and a JSON blockers + policy + price payload.

## Schema

Migration `0034_phase4_invoice_readiness_snapshots.sql`. Columns:

- `execution_case_id`, `patient_screening_id`, `procedure_event_id`
  (FKs, cascade rules safe)
- `facility_id`, `service_type` (required), `patient_name`, `patient_dob`
- `readiness_status` — `not_ready|blocked|ready_to_invoice|invoice_draft_created|invoiced|excluded`
- `blockers` (jsonb array of canonical codes; see
  `INVOICE_READINESS_BLOCKERS`)
- `unit_price`, `price_snapshot`, `policy_snapshot`, `metadata` (jsonb)
- `evaluated_at`, `invoice_id` (set when drafted by PR 4.3+)

Unique index `(execution_case_id, service_type)` enforces one row
per (case, testType).

## Engine

`server/services/billing/invoiceReadinessEngine.ts`:

`evaluateInvoiceReadiness({ executionCaseId, serviceType })`:

1. Load execution case + facility.
2. Pull the effective billing policy via PR 4.1's
   `getEffectiveBillingPolicy({ facilityId, testType })`.
3. Pull document readiness rows, billing readiness checks,
   procedure events, schedule events for the case + service.
4. Compute blockers:
   - `missing_price` when both `perTestPrice` AND `bundledPrice`
     are null in the policy snapshot.
   - `missing_recipient` when no primary email AND fallback to
     facility contact disabled.
   - `missing_<doc>` when the policy says to hold + the
     `case_document_readiness` row is missing or its status isn't
     in the present set (`completed/uploaded/...`).
   - `physician_signature_pending` when no
     `physician_signed_order` row is signed.
   - `billing_readiness_pending` when policy says hold + not all
     `billing_readiness_checks` are `ready`.
   - `procedure_not_complete` when no procedure event has
     `procedureStatus = completed`.
   - `cancelled` / `no_show_not_billable` from the next ancillary
     schedule events.
   - `already_invoiced` when a prior snapshot for this (case,
     service) carries a non-null `invoice_id`.
5. Status:
   - `excluded` if cancelled-excluded or no-show-not-billable.
   - `ready_to_invoice` if blockers is empty.
   - `blocked` otherwise.
6. Return a structured evaluation; the route layer upserts via the
   repo helper.

The engine is **read-only** with respect to invoices. It does not
create drafts. It does not mutate billing readiness checks. The
batch builder (PR 4.3) and draft service (PR 4.4) own those
side-effects.

## Routes

- `GET /api/invoice-readiness` — list with filters (facility,
  serviceType, readinessStatus, blockersIncludeAny).
- `GET /api/invoice-readiness/:id`
- `POST /api/invoice-readiness/evaluate` — single (case, service).
- `POST /api/invoice-readiness/evaluate-facility` — facility sweep
  (capped at `maxCases` ≤ 500).

Read is authenticated; write is admin/biller.

## UI

`/billing/readiness` (admin-gated). Filters by facility, testType,
status, and blocker. Shows count chips per status. Renders blocker
codes as labeled chips using `BLOCKER_LABELS`. A "Evaluate facility"
button runs the sweep.

## Anti-patterns guarded by QA

- No engine path that emits `ready_to_invoice` when any policy-hold
  rule is satisfied.
- No fake `excluded` / `ready` status without a policy-derived
  reason.
- No write to `invoices` / `invoice_line_items` from this engine.
