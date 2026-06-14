# Phase 4 — Existing billing/invoice audit baseline

Snapshot taken at the start of Phase 4 against `main` at `4203dbd`
(PR #287 Phase 2 hardening merged).

## What exists (do not duplicate)

### Schemas (shared/schema)

| File | Tables of interest |
|---|---|
| `billing.ts` | `billingRecords` (patient-level service charges, paid status, balance, AR fields) |
| `invoices.ts` | `invoices` (id, invoiceNumber, facility, dates, status, totals, sentTo, sentAt, lastRemindedAt), `invoiceLineItems`, `invoicePayments` |
| `billingReadiness.ts` | `billingReadinessChecks` (readinessStatus, missingRequirements jsonb) |
| `billingDocuments.ts` | `billingDocumentRequests` |
| `completedBillingPackages.ts` | snapshot rollups |
| `projectedInvoices.ts` | projected line-item draft scaffolds |

### Routes (server/routes)

- `billing.ts`, `billingReadiness.ts`, `billingDocuments.ts`,
  `completedBillingPackages.ts`, `invoices.ts`, `projectedInvoices.ts`.

### Services

- `server/services/billing/billingRecordsService.ts`
- `server/services/billingReadiness/billingReadinessAggregator.ts`
  (Phase 1 dormant aggregator the route consumes)
- `server/services/invoicing/invoicingScaffold.ts`
- `server/services/invoiceReminderService.ts`

### Client surfaces

- `client/src/pages/billing.tsx`
- `client/src/pages/invoices.tsx`
- billing components scattered under `client/src/components/billing/`

### Admin settings (already supports Phase 4)

`admin_settings` has these scope columns after Phase 2 hardening:

- `setting_domain`, `setting_key`, `setting_value`
- `facility_id` (nullable)
- `user_id` (nullable)
- `test_type` (nullable) — Phase 2 hardening item 5
- `active`

The `getEffectiveAdminSettings` service + the precedence resolver in
`server/repositories/adminSettings.repo.ts` already honor
`(facility, user, testType)` precedence. Phase 4 reuses this — no
new settings table.

### Tests / probes / QA in place

- `script/testBillingPaymentInvoiceFlow.ts`
- `script/testOperationalPatientToInvoiceFlow.ts`
- `script/testBillingVisibilityReadModel.ts`
- Phase 2 probes (`probe:phase2-ops`, `probe:phase2-documents`,
  `probe:phase2-call-attempt`, etc.).

## What is missing (Phase 4 fills in)

| Gap | Phase 4 PR |
|---|---|
| Settings-driven invoice schedule per facility / testType | 4.1 |
| Recipient / CC / fallback resolution policy | 4.1 |
| Pricing + revenue split policy | 4.1 |
| Approval requirements policy | 4.1 |
| Payment terms / reminder cadence policy | 4.1 |
| Per-(case, testType) readiness engine emitting blocker list | 4.2 |
| `invoice_readiness_snapshots` table | 4.2 |
| Facility-due batch builder + cutoff computation | 4.3 |
| `invoice_batches` + `invoice_batch_items` tables | 4.3 |
| Invoice approval workflow + policySnapshot + recipientSnapshot | 4.4 |
| Delivery queue + delivery events table | 4.5 |
| `invoice_delivery_events` table | 4.5 |
| Payment / denial / remittance internal tracking | 4.6 |
| `invoice_adjustments`, `invoice_denials`, `remittance_events` tables | 4.6 |
| Billing auditor worklist | 4.7 |
| EOD / weekly / monthly billing reports | 4.8 |
| Live probes for Phase 4 | 4.9 |

## What stays untouched

- The legacy `invoices.status` text column is **not** renamed or
  type-changed. Phase 4 adds `approvalStatus` + `deliveryStatus`
  alongside. The existing billing page + tests continue to work.
- `invoicingScaffold.ts` stays as the dormant module it is — Phase 4
  ships its own runtime services next to it.
- The legacy `billingRecords` workflow is the existing per-patient
  ledger. Phase 4 reads it; it does not rewrite it.

## Decisions documented up front

1. **No second settings table.** `admin_settings` is sufficient.
2. **No status renames on `invoices`.** Add columns; don't break
   existing readers.
3. **No write to clearinghouses or payment processors.** That is
   Phase 6.
4. **All new policy keys carry seed defaults** so a freshly-pushed
   DB without admin-customised rows still resolves to a safe
   baseline.
