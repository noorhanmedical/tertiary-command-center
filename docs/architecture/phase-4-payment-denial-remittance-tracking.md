# Phase 4 — Payment / denial / remittance tracking (PR 4.6)

## Schema (migration 0038)

Three new tables that ride alongside the existing `invoice_payments`
table (kept unchanged):

- `invoice_adjustments` — `adjustment_type` ∈ `write_off|contractual|correction|discount|dispute_hold|manual` + amount + reason + actor.
- `invoice_denials` — denial codes/reasons/payer/status + next-action timestamp.
- `remittance_events` — typed event log spanning all four entry kinds
  (`remittance_received|denial_received|payment_posted|adjustment_posted`).

## Service

`server/services/billing/invoiceFinancialService.ts`:

- `postPayment` — inserts a payment row, logs `payment_posted`,
  recomputes invoice totals.
- `postAdjustment` — inserts an adjustment row, logs
  `adjustment_posted`, recomputes invoice totals.
- `postDenial` — inserts a denial row, logs `denial_received`.
  Denials do NOT change the invoice balance directly; PR 4.7's
  worklist picks them up for follow-up.
- `postRemittanceEvent` — generic `remittance_received` audit entry.
- `patchDenialStatus` — moves a denial through
  `open → appealed → overturned|upheld → closed`.
- `recomputeInvoiceTotals` — sums payments + adjustments, sets
  `totalPaid` and `totalBalance` on the invoice. Status becomes
  `Paid` only when `totalBalance ≤ 0`; `Partially Paid` when there
  is any payment/adjustment but balance > 0; otherwise the legacy
  status is preserved.

## Routes (admin/biller-gated writes)

- `POST /api/invoices/:id/payments`
- `POST /api/invoices/:id/adjustments`
- `POST /api/invoices/:id/denials`
- `POST /api/invoices/:id/remittance-events`
- `GET  /api/invoices/:id/financial-events`
- `PATCH /api/denials/:id/status`

## UI

- `InvoiceFinancialPanel` (`client/src/components/billing/InvoiceFinancialPanel.tsx`):
  forms to post payment/adjustment/denial/remittance + history
  summary across the four entry kinds. Inline denial-status select.
- `/billing/remittance` (admin-gated): invoice-id picker + the
  panel.

## Honesty guarantees

- "Paid" is only set when `totalBalance ≤ 0` after recomputation.
- Denials do NOT modify the balance — they are a separate audit
  log that the worklist follows up on.
- Adjustments require a non-zero amount.
- Payments require `amount > 0`.
