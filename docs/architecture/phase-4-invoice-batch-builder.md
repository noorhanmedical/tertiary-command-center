# Phase 4 — Invoice batch builder (PR 4.3)

## Decision

Two new tables, not extensions of existing ones:

- `invoice_batches` — one row per "preview" for a facility +
  period + cutoff.
- `invoice_batch_items` — one row per `(case, testType)` that the
  preview considered (included OR blocked OR excluded — the
  preview is a complete audit of WHAT could have invoiced and why
  it didn't).

This lets PR 4.4 reference a batch when drafting invoices, and PR
4.7 (auditor worklist) link from a blocker chip back to the
specific batch row that surfaced it.

## Schema

Migration `0035_phase4_invoice_batches.sql`.

`invoice_batches`:
- `facility_id`, `invoice_period_start`, `invoice_period_end`, `cutoff_at`
- `batch_status` — `draft_preview|ready_for_review|invoice_drafts_created|voided`
- `policy_snapshot`, `recipient_snapshot`, `totals` (jsonb)
- `item_count`, `blocked_count`
- `created_by_user_id`, `metadata`, timestamps

`invoice_batch_items`:
- FK to `invoice_batches.id` (cascade delete).
- FK to `invoice_readiness_snapshots.id` (set null on delete) —
  the audit pointer back to the source snapshot.
- `execution_case_id`, `patient_screening_id`, `procedure_event_id`,
  `facility_id`, `test_type`, `patient_name`, `date_of_service`
- `price`, `revenue_split` (jsonb)
- `line_status` — `included|excluded|blocked|duplicate`
- `blockers` (jsonb), `metadata`

## Builder

`buildInvoiceBatchPreview({ facilityId, invoicePeriodStart?, invoicePeriodEnd?, cutoffAt?, createdByUserId? })`:

1. Pulls effective policy for the facility.
2. Derives a period from the policy (`monthly` → calendar month;
   `weekly|biweekly` → Sun..Sat; daily/custom → today).
3. Pulls readiness snapshots for the facility with status in
   `ready_to_invoice|blocked|not_ready`.
4. De-dupes by `(executionCaseId, serviceType)` keeping the newest.
5. Inserts the `invoice_batches` row + one `invoice_batch_items`
   row per snapshot:
   - `included` when `ready_to_invoice` AND unit price available.
   - `blocked` when readinessStatus is `blocked`.
   - `excluded` otherwise.
6. Rolls up totals + counts on the batch row.

The builder does NOT create invoice drafts. PR 4.4 owns that.

## API

- `GET /api/invoice-batches?facilityId=&batchStatus=`
- `GET /api/invoice-batches/:id` → `{ batch, items }`
- `POST /api/invoice-batches/preview` — single facility.
- `POST /api/invoice-batches/generate-due` — `facilityIds[]` body;
  runs the builder for each.
- `POST /api/invoice-batches/:id/refresh` — emits a NEW preview row;
  leaves prior batch intact for audit.
- `POST /api/invoice-batches/:id/void` — sets batchStatus = voided.

Writes are admin/biller-gated.

## UI

`/billing/invoice-batches` (admin-gated). Filter by facility,
build a preview, void a batch, click a row to see its items
(included / blocked / excluded with blocker chips). No "send"
action — that's PR 4.5.

## Anti-patterns guarded by QA

- The builder must not insert `invoices` / `invoice_line_items`
  rows.
- A preview must record blockers verbatim from the snapshot; no
  invented blocker codes.
- `policy_snapshot` and `recipient_snapshot` must be captured at
  preview time so PR 4.4 / PR 4.5 read the snapshot, not the live
  policy at draft time.
