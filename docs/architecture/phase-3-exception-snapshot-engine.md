# Phase 3 — Exception snapshot engine (PR 3.2)

## Schema (migration 0039)

`exception_snapshots`:
- `exception_key` (unique) — engine de-dupes by key.
- `exception_type`, `entity_type`, `entity_id`
- patient/case/invoice/facility/testType FKs (nullable)
- `severity`, `status`, `title`, `explanation`, `recommended_owner_role`
- review fields (filled in by PR 3.3): `assigned_to_user_id`,
  `assigned_role`, `acknowledged_at`, `acknowledged_by_user_id`,
  `resolution_reason`, `dismissed_reason`
- lifecycle: `detected_at`, `last_seen_at`, `resolved_at`,
  `superseded_by_engine`
- `source_snapshot`, `policy_snapshot`, `metadata` (jsonb)

Unique index on `exception_key` makes upsert idempotent.

## Engine

`server/services/exceptionIntelligence/exceptionSnapshotEngine.ts`:

- Loads the effective policy via PR 3.1 service.
- Runs PR 3.2 detectors:
  - `callback_overdue` (per execution case)
  - `payment_overdue` (per invoice with dueDate past + status != Paid)
  - `invoice_delivery_failed` (per invoice in deliveryStatus = failed)
  - `invoice_readiness_blocked` (per blocked snapshot past threshold)
  - `physician_signature_pending` (order_note present + no signed_order)
  - `denial_followup_due` (per open denial older than threshold)
- For each detector, `emit(...)` upserts an `exception_snapshots`
  row keyed by a deterministic `exceptionKey`.
- After all detectors run, **supersedes** open snapshots whose
  keys are no longer emitted (engine-driven cleanup). Only
  supersedes types that PR 3.2 covers; PR 3.6 / 3.7 add the rest.
- Records `detectorVersion = "3.2.0"` and a `policySnapshot` per row
  for audit reproducibility.

## API

- `GET /api/exceptions` (status / severity / type / facility /
  ownerRole / executionCaseId / invoiceId filters)
- `GET /api/exceptions/:id`
- `POST /api/exceptions/evaluate` (per facility/testType)
- `POST /api/exceptions/evaluate-facility` (alias)
- `POST /api/exceptions/evaluate-all-safe`

Writes are admin/biller-gated. Reads require auth.

## UI

`/exceptions` (admin-gated). Severity tab strip + facility / owner
filters. Click a row → `ExceptionReviewPanel` shows explanation +
source snapshot + policy snapshot.

## Honesty guarantees

- Engine **never** mutates patient, billing, scheduling, or invoice
  state. Only writes exception snapshots.
- `superseded` transition fires only when the source condition is
  gone — recorded with `superseded_by_engine = 1` for audit.
- Source snapshot is verbatim from the source row so a human
  reviewer can reconstruct the decision.
- `detectorVersion` tags every emission so a future detector
  change doesn't silently rewrite history.
