# Billing Package — Source of Truth

> **Scope:** Single reference for the
> `completed_billing_packages` → `billing_readiness_checks` →
> `billing_records` → `invoice_line_items` → `invoices` /
> `projected_invoice_rows` chain. Read-only audit.

## Canonical tables

```
case_document_readiness
  ↓ (evaluator: evaluateBillingReadinessForProcedure)
billing_readiness_checks
  ↓ (helper: createPendingBillingDocumentRequestFromReadiness)
billing_document_requests
  ↓ (manual or system-driven completion)
completed_billing_packages
  ↓ (addCompletedPackageToInvoice)
invoice_line_items
  ↓
invoices
  ↔ projected_invoice_rows  (realInvoiceLineItemId linkage)
```

Every hop is mediated by a canonical repo function (no direct
DB writes from routes outside the repos).

## Read paths (client)

| Domain | Helper | Underlying route |
| --- | --- | --- |
| Document readiness | `documentReadinessApi.ts` | `/api/case-document-readiness` |
| Billing readiness | (read via `evaluateDocumentPackage` returns) | `/api/billing-readiness-checks` |
| Billing doc requests | (via package/UI flow) | `/api/billing-document-requests` |
| Completed packages | `completedBillingPackagesApi.ts` | `/api/completed-billing-packages` |
| Invoice line items | (via invoice fetch) | `/api/invoices/:id` |
| Invoices | (direct page query) | `/api/invoices` |
| Projected invoices | `projectedInvoicesApi.ts` | `/api/projected-invoice-rows` |

## Write paths (canonical)

| Trigger | Endpoint | Repo |
| --- | --- | --- |
| Procedure performed | `POST /api/procedure-events/complete` | `markProcedureComplete()` — cascades readiness/notes/billing |
| Document marked complete | `POST /api/case-document-readiness/complete` | upserts readiness + re-evaluates billing |
| Report uploaded | `POST /api/case-document-readiness/report-uploaded` | wrapper around the same evaluator |
| Billing readiness recompute | `POST /api/billing-readiness-checks/recompute` | manual recompute action |
| Package payment | `POST /api/billing/complete-package-payment` | finalizes package + line item + invoice |
| Package transition | `POST /api/completed-billing-packages/:id/transition` | `pending_payment → payment_updated → completed_package → ...` |

## State machines

### `case_document_readiness.documentStatus`

`pending` · `uploaded` · `completed` · `complete` · `generated` ·
`ready` · `ready_to_generate` · `failed` — per-doc-type defaults
applied at the `/complete` route's `DEFAULT_STATUS_BY_TYPE`.

### `billing_readiness_checks.readinessStatus`

`not_ready` · `missing_requirements` · `ready_to_generate` ·
`billing_document_generated` · `sent_to_billing`.

### `billing_document_requests.requestStatus`

`pending` · `generating` · `generated` · `failed` · `sent_to_billing`.

### `completed_billing_packages.packageStatus`

`pending_payment` · `payment_updated` · `completed_package` ·
`added_to_invoice` · `invoiced` · `closed`. Shorthand aliases on
the transition route: `draft | ready | completed`.

### `projected_invoice_rows.projectedStatus`

`projected_open` · `projected_sent` · `converted_to_real_invoice` ·
`variance_review` · `projected_closed`.

## Invoice line linkage (projected → real)

`projected_invoice_rows.realInvoiceLineItemId` is the canonical
join into `invoice_line_items.id`. `varianceAmount` records the
delta when both projected + real amounts are known. The
`PatientJourneyDrawer` already renders this linkage inline (per
Batch 9 of the earlier operational stream).

## Open gaps (named)

1. **No `/api/invoice-candidates` read route.** A backend joined
   read of:
   `completed_billing_packages` (terminal status) →
   `billing_records` → `invoice_line_items` → `invoices`,
   returning a per-candidate row that surfaces:
   `patient_uuid / name`, `serviceType`, `dos`, `packageStatus`,
   `billing_record_status`, `invoice_line_item_id?`,
   `invoice_id?`, `amount?`.
   Today the Plexus-OS UI side has a read-only bridge that
   computes this client-side from billing rows joined to the
   package selector; the Tertiary repo has no equivalent.
   Surfacing this as a single route would let the Invoices page
   show real linkage instead of `not yet linked`. **Future
   batch.**
2. **`completed_billing_packages.packageStatus` doesn't fire
   `patient_journey_events` for the `pending_payment → ...`
   transitions outside the canonical `transition` route**
   (e.g. when `addCompletedPackageToInvoice` flips it). Worth
   instrumenting.
3. **Variance threshold settings live in `admin_settings.projected_invoice`**
   but aren't read anywhere yet. Surfacing them in the Invoices
   page (colour rows past threshold) is a self-contained future
   batch — see `admin-settings-rule-application.md` gap #4.

## QA + smoke coverage

- `qa:document-billing-invoice-spine` — covers readiness +
  packages + invoices.
- `qa:procedure-readiness-spine` — covers enum + helper.
- `qa:admin-approval-engagement-gate` — covers the upstream gate.
- `qa:projected-invoice-reconciliation` *(this stream, next
  batch)* — covers `realInvoiceLineItemId` linkage shape.

## Cross-references

- `docs/architecture/tertiary-command-center-canonical-spine.md`
- `docs/architecture/procedure-complete-canonical-path.md`
- `docs/architecture/audit-log-coverage.md`
- `client/src/lib/workflow/completedBillingPackagesApi.ts`
- `client/src/lib/workflow/projectedInvoicesApi.ts`
- `server/repositories/billingReadiness.repo.ts` —
  `evaluateBillingReadinessForProcedure()`.
- `server/repositories/completedBillingPackages.repo.ts`.
