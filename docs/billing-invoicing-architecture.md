# Billing + Invoicing Architecture

> Honest map of the billing readiness → completed package → invoice
> spine. "Wired" claims trace to existing routes/tables. Gaps are
> named explicitly.

## Lifecycle

```
Procedure complete (procedure_events)
  ↓
Documents ready (case_document_readiness all satisfied)
  ↓
Billing readiness check (billing_readiness_checks.readinessStatus)
  ↓
Billing document request (billing_document_requests → generated document)
  ↓
Completed billing package (completed_billing_packages.packageStatus + paymentStatus)
  ↓
Real invoice line item (invoice_line_items, linked to completed_billing_packages.id)
  ↓
Invoice (invoices, with payments + aging)

In parallel:
Performed but unpaid procedures → projected_invoice_rows (forecast)
```

## Canonical tables

| Concern | Table | Notes |
| --- | --- | --- |
| Per-case billing readiness | `billing_readiness_checks` | `readinessStatus`, `missingRequirements`. |
| Billing document requests | `billing_document_requests` | Created when readiness needs a billing doc; eventually points at `generatedDocumentId`. |
| Sealed packages | `completed_billing_packages` | `packageStatus`, `paymentStatus`, `paymentDate`, links to procedure + readiness. |
| Invoices | `invoices`, `invoice_line_items`, `invoice_payments` | Full CRUD with aging analysis. |
| Projected (forecast) | `projected_invoice_rows` | Forecast of expected revenue per procedure; links `realInvoiceLineItemId` when realized. |
| Pricing | `cash_price_settings` | `(serviceType, facilityId, payerType) → cashPrice, projectedPrice`. |
| Audit | `patient_journey_events` | Appended on payment recorded, package completed, etc. |

## Routes (wired today)

### Billing readiness — read-only
- `GET /api/billing-readiness-checks`
- `GET /api/billing-readiness-checks/:id`

### Billing document requests — read-only
- `GET /api/billing-document-requests`
- `GET /api/billing-document-requests/:id`

### Completed billing packages — read + payment write
- `GET /api/completed-billing-packages`
- `GET /api/completed-billing-packages/:id`
- `POST /api/completed-billing-packages/:id/payment`
- `POST /api/billing/complete-package-payment`

### Invoices — full CRUD
- `GET /api/invoices`, `GET /api/invoices/aging`, `GET /api/invoices/:id`
- `POST /api/invoices`, `PATCH /api/invoices/:id/status`
- `POST /api/invoices/:id/send-email`
- `GET /api/invoices/:id/payments`, `POST /api/invoices/:id/payments`, `DELETE /api/invoices/:id/payments/:paymentId`
- `DELETE /api/invoices/:id`

### Projected invoices — read-only
- `GET /api/projected-invoice-rows`
- `GET /api/projected-invoice-rows/:id`

### Cash pricing — read-only
- `GET /api/cash-price-settings`
- `GET /api/cash-price-settings/:id`

## Frontend

- `client/src/pages/billing.tsx` — renders `CanonicalBillingPanel` plus the editable billing-records table; surfaces readiness state + payment recording. The legacy `billing_records` table is rendered alongside the canonical tables.
- `client/src/pages/invoices.tsx` — full invoice CRUD UI with aging buckets, line item view, payment recording, send-email.

## Gaps (named, not faked)

1. **Mark-package-complete endpoint missing.** Today there is `POST /api/completed-billing-packages/:id/payment` and `POST /api/billing/complete-package-payment`, but no endpoint to transition `packageStatus` itself (e.g. `draft → ready → completed`). The status currently changes via the payment routes and any cascading background logic; an explicit transition route would let UI seal a package without recording a payment.
2. **Readiness write endpoints missing.** `billing_readiness_checks` is created upstream (likely cascading from `procedure_events/complete` + document readiness), but no admin endpoint exists to recompute or override readiness for a stuck case.
3. **Billing document request write missing.** No endpoint creates a `billing_document_requests` row from the UI. A "Generate billing document" action would write here.
4. **Projected → real linkage missing in UI.** `projected_invoice_rows.realInvoiceLineItemId` exists but no UI surfaces the variance.
5. **Cash pricing admin UI missing.** `cash_price_settings` is read-only via API; there's no admin page to manage rates per facility/service/payer.
6. **Admin approval rule for invoices.** `admin_settings` can hold approval thresholds, but the invoice POST does not currently consult them.

## Hard rules already enforced

- `POST /api/invoices/:id/payments` updates `totalPaid` + `totalBalance` atomically; aging logic in `GET /api/invoices/aging` derives from these.
- `completed_billing_packages.paymentStatus` controls whether a package can roll into an invoice.
- `patient_journey_events` is appended on payment recording (so the patient command canvas reflects it via the journey folder).

## QA

- `npm run qa:document-billing-invoice-spine` — smoke-reads every billing/invoice table. Skips cleanly without `DATABASE_URL`.
- Existing flow tests (still passing): `test:patient-to-invoice-flow`, `test:billing-payment-invoice-flow`, `test:billing-visibility-read-model`, `test:final-schedule-commit-to-caller`, `test:operational-flow-assigned-to-billing-ready`.

## How to extend safely

- A new pricing override should go in `cash_price_settings` keyed by `(serviceType, facilityId, payerType)`. The invoice creator reads these.
- A new readiness rule should live as a derived check in `billing_readiness_checks.missingRequirements` rather than a parallel boolean column.
- A new invoice line shape should add to `invoice_line_items`, not create a sibling table.
