# Phase 4 — PR plan

| PR | Scope | Status |
|---|---|---|
| 4.0 | Guardrails + audit baseline. 4 docs + 6 QA scripts. | landed |
| 4.1 | Billing policy engine. `billingPolicyService` + `/api/billing-policy/effective` + `/admin/billing-settings` page + seed. | landed |
| 4.2 | Invoice readiness engine. `invoice_readiness_snapshots` table + engine + route + queue page. | landed |
| 4.3 | Invoice batch builder. `invoice_batches` + `invoice_batch_items` tables + builder service + route + page. | landed |
| 4.4 | Invoice draft + approval workflow. `approvalStatus` + snapshots on invoices + draft + approval services. | landed |
| 4.5 | Invoice delivery runtime. `invoice_delivery_events` table + delivery service + queue page. | landed |
| 4.6 | Payment / denial / remittance. `invoice_adjustments` + `invoice_denials` + `remittance_events` tables. | landed |
| 4.7 | Billing auditor worklist. | landed |
| 4.8 | Billing reports (EOD / weekly / monthly). | landed |
| 4.9 | Live DB probes (8 probes) + final validation. | landed |

## Sequencing rules

- Each PR commits independently to `phase-4-billing-invoicing-runtime`.
- No PR depends on a future PR.
- Every PR ends with `npm run check` and `npm run build` clean.
- Every PR adds at least one QA + one smoke (or extends an existing
  one).
- No PR touches PR #278.
- No PR creates Mission Control / Scheduler Portal / RingCentral
  live / SMS live surfaces.

## Forbidden in every Phase 4 PR

- Premium UI redesign.
- New top-level navigation entries beyond the billing-focused pages
  enumerated in this plan.
- Splitting PCS / ACS portals or mutating their layout.
- Fake "sent" / "paid" / "ready" / "signed" states.
- Hardcoded billing rules where an admin setting should drive
  behavior.
