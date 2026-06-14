# Phase 4 — Billing auditor worklist (PR 4.7)

Read-only aggregation across the canonical Phase 4 tables.

## Queues

`WORKLIST_QUEUE_IDS` (14 queues):

- `ready_to_invoice`
- `blocked_missing_report`, `blocked_missing_order_note`, `blocked_missing_procedure_note`
- `physician_signature_pending`, `insurance_verification_pending`
- `missing_price`, `missing_recipient`
- `invoice_draft_needs_review`, `invoice_approved_ready_to_send`, `invoice_delivery_failed`
- `payment_overdue`
- `denial_open`
- `reminder_due`

## Service

`server/services/billing/billingAuditorWorklistService.ts`:

- `getWorklistSummary(facilityId?)` returns counts per queue.
- `getWorklistItems(queueId, facilityId?, limit)` returns items
  shaped for the auditor table.

Readiness-driven queues map blockers from
`invoice_readiness_snapshots` to a `WorklistQueueId`. Approval /
delivery queues read `invoices.approvalStatus +
invoices.deliveryStatus`. `denial_open` reads `invoice_denials`
with status = open. `payment_overdue` and `reminder_due` use
`invoices.dueDate`, `invoices.lastRemindedAt`.

## Routes

- `GET /api/billing-auditor/summary?facilityId=`
- `GET /api/billing-auditor/worklist?queueId=&facilityId=&limit=`

Admin/biller-gated.

## UI

`/billing/auditor` (admin-gated). Tab strip per queue with counts.
Click a tab → table of items. Read-only — actions link back to the
canonical surfaces (invoice review, delivery, remittance).

## Anti-patterns guarded by QA

- The worklist service must not insert / update / delete invoice,
  readiness, batch, denial, or remittance rows.
- The page must read only canonical fields — no client-derived
  "ready" badge that disagrees with the readiness engine.
