# Phase 4 — Billing + Invoicing Runtime

**Goal:** Turn the existing billing/invoice scaffold into an
enterprise-grade, settings-driven billing and invoicing operating
system that scales across hundreds of clinics with different
schedules, recipients, pricing, readiness rules, approval gates,
delivery rules, and reporting requirements.

## What Phase 4 IS

- A **policy engine** (admin-settings-driven) for invoice schedules,
  cutoff rules, recipients, pricing, revenue split, readiness, and
  approval requirements.
- A **readiness engine** that derives `ready_to_invoice` /
  `blocked_*` per (case, patient, testType) from canonical Phase 2
  sources (document readiness, billing readiness checks, procedure
  events, schedule events, contacts, policy).
- An **invoice batch builder** that finds facilities due for
  invoicing, computes the period + cutoff, groups ready items, and
  emits a draft preview — without sending or paying anything.
- An **invoice draft + approval workflow** that extends the existing
  `invoices` table with `approvalStatus`, `policySnapshot`,
  `recipientSnapshot`, `deliveryStatus`, and audit columns.
- A **delivery runtime** that resolves recipients from policy,
  blocks unauthorized sends, logs delivery events, and supports
  reminders.
- **Payment / denial / remittance** tracking via three new tables
  (`invoice_adjustments`, `invoice_denials`, `remittance_events`)
  that update invoice balances honestly.
- A **billing auditor worklist** aggregating the queues above.
- **EOD / weekly / monthly billing reports** built from canonical
  tables (no fake numbers; source missing → label says so).
- **Live DB probes** that exit cleanly and honestly skip without
  `DATABASE_URL`.

## What Phase 4 IS NOT

- A premium UI redesign. PR #278 stays untouched.
- A new product surface ("Mission Control" / "Scheduler Portal" —
  forbidden).
- Phase 3 AI work.
- Phase 5 AWS / staging / production wiring.
- Phase 6 clearinghouse / EHR / payment-processor integrations.
- Phase 7 Mission Control.
- Phase 8 enterprise scale controls.
- A simple "invoice page". The repo already has one. Phase 4 wraps
  it in policy + readiness + batches + approval + delivery + audit.

## Boundary contract (inherited from Phase 1 / Phase 2)

- PCS and ACS share `TeamPortalShell`. Layout unchanged.
- Left rail = general tools. Center = patient canvas. Right rail =
  work queue. Patient facts live in the center canvas, not the
  left rail.
- Global calendar must NOT mutate Team Portal right queues.
- RingCentral remains dormant.
- SMS remains dormant.
- No fake "sent" / "paid" / "ready" / "signed" states anywhere.
- Hardcoded billing rules are forbidden where an admin setting
  should drive behavior.

## Audit baseline

See [`phase-4-existing-billing-audit.md`](./phase-4-existing-billing-audit.md)
for the snapshot of what was already in place when Phase 4 started.

## PR plan

See [`phase-4-pr-plan.md`](./phase-4-pr-plan.md).

## Off-limits

See [`phase-4-do-not-touch.md`](./phase-4-do-not-touch.md).
