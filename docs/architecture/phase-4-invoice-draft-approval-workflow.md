# Phase 4 — Invoice draft + approval workflow (PR 4.4)

## Schema additions to `invoices`

Migration `0036_phase4_invoice_approval_workflow.sql` adds:

- `invoice_batch_id` (FK to `invoice_batches`, nullable)
- `approval_status` — `draft|pending_review|approved|voided|revised`
- `approved_by_user_id`, `approved_at`
- `voided_at`, `void_reason`
- `policy_snapshot`, `recipient_snapshot` (jsonb captured at draft time)
- `delivery_status` — `pending|ready_to_send|queued|sent|failed|download_only|blocked_missing_recipient|blocked_not_approved`
- `due_date`, `payment_terms`

The legacy `status` text column is **untouched**. Existing billing
pages continue to read it. The approval workflow uses
`approval_status` as the canonical state, with `delivery_status`
tracking the send-side independently (PR 4.5 owns delivery
transitions).

## Draft service

`createDraftsFromBatch(batchId, actorUserId)`:

1. Loads the batch + its `included` items.
2. Guards against double-drafting (returns `already_drafted` when
   the batch is already in `invoice_drafts_created`).
3. Computes invoice number from policy `numbering` settings:
   `<facility prefix>-<YYYYMM>-B<batchId>`.
4. Computes due date from payment terms in the policy snapshot.
5. Inserts one `invoices` row (status legacy=`Draft`, approval=`pending_review`,
   delivery=`pending`) + one `invoice_line_items` row per included
   batch item.
6. Marks each linked readiness snapshot as
   `readiness_status = invoice_draft_created` + sets `invoice_id`.
7. Transitions the batch to `invoice_drafts_created`.

The created invoice carries the batch's `policy_snapshot` and
`recipient_snapshot` so PR 4.5 (delivery) reads from the captured
snapshot, not the live policy.

## Approval state machine

```
draft ──submit_for_review─▶ pending_review ──approve─▶ approved
                          ├─revise──────▶ revised ──submit_for_review─▶ pending_review
                          └─void(reason)─▶ voided

approved ──void(reason)─▶ voided
revised ──void(reason)─▶ voided
draft   ──void(reason)─▶ voided
```

Illegal transitions return HTTP 409 with the from-status in the
message. `void` requires a reason (HTTP 400 when missing).

## API

- `POST /api/invoice-batches/:id/create-drafts`
- `POST /api/invoices/:id/submit-for-review`
- `POST /api/invoices/:id/approve`
- `POST /api/invoices/:id/void` (body: `{ reason }`)
- `POST /api/invoices/:id/revise`
- `GET  /api/invoices/:id/audit` (approval + delivery audit snapshot)

Writes are admin/biller-gated.

## UI

`/billing/invoice-review` (admin-gated). Lists invoices with
approval / delivery / due chips. Inline actions:
Submit (draft), Approve / Revise (pending_review), Void (any
non-voided). Void requires a typed reason.

## Anti-patterns guarded by QA

- A "sent" toast is forbidden until PR 4.5 actually delivers.
- A status of `approved` requires `approved_at` + `approved_by_user_id`
  to be non-null in the same update.
- Void requires a reason.
- The draft service must not write `invoices` rows when the batch
  has no `included` items.
