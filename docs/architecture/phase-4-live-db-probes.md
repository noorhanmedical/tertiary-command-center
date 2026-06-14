# Phase 4 — Live DB probes (PR 4.9)

Eight read-only probes that honestly skip with exit 0 when
`DATABASE_URL` is unavailable. On Replit (or anywhere the env var
is set), they verify Phase 4 table shape + seed presence without
mutating production data.

## Probes

| Script | npm command | What it checks |
|---|---|---|
| `livePhase4BillingPolicyProbe` | `npm run probe:phase4-billing-policy` | `admin_settings.test_type` exists; 6 representative `billing_policy.*` seed rows present at global scope. |
| `livePhase4InvoiceReadinessProbe` | `npm run probe:phase4-invoice-readiness` | `invoice_readiness_snapshots` table + unique `(execution_case_id, service_type)` index. |
| `livePhase4InvoiceBatchProbe` | `npm run probe:phase4-invoice-batches` | `invoice_batches` + `invoice_batch_items` tables present. |
| `livePhase4InvoiceApprovalProbe` | `npm run probe:phase4-invoice-approval` | 11 approval/delivery/snapshot columns added to `invoices`. |
| `livePhase4InvoiceDeliveryProbe` | `npm run probe:phase4-invoice-delivery` | `invoice_delivery_events` table present. |
| `livePhase4FinancialEventsProbe` | `npm run probe:phase4-financial-events` | `invoice_adjustments` + `invoice_denials` + `remittance_events` tables present. |
| `livePhase4BillingAuditorProbe` | `npm run probe:phase4-billing-auditor` | 6 worklist source tables present. |
| `livePhase4BillingReportsProbe` | `npm run probe:phase4-billing-reports` | 5 report source tables present. |

## Honest skip contract

Every probe starts with:

```ts
if (!process.env.DATABASE_URL) {
  console.log("[probe:<name>] DATABASE_URL unavailable — skipped live DB probe.");
  return;
}
```

Each probe finishes by calling `pool.end()` so the script exits
cleanly (Phase 2 hardening pattern).

## Run order on Replit

Apply Phase 4 migrations (0034–0038) + seed the billing policy,
then:

```
npm run probe:phase4-billing-policy
npm run probe:phase4-invoice-readiness
npm run probe:phase4-invoice-batches
npm run probe:phase4-invoice-approval
npm run probe:phase4-invoice-delivery
npm run probe:phase4-financial-events
npm run probe:phase4-billing-auditor
npm run probe:phase4-billing-reports
```

Any non-zero exit is a blocker — fix the migration or seed before
declaring Phase 4 live-validated.
