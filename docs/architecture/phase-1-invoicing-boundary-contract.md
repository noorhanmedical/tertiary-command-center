# Phase 1 invoicing boundary contract

**Status:** Docs-only (Batch G3 of Phase 1 run).
**Companion:** `scripts/qa-phase-1-invoicing-boundary-contract.mjs`.

Invoicing in Phase 1 is the layer that turns a billing-ready patient
record into an invoice row. It does NOT touch claims submission, ERA
/ remittance, denial routing, or payment posting — those layers
remain outside Phase 1.

## What invoicing owns in Phase 1

| Concern | Source of truth |
|---|---|
| Invoice header | `invoices` (existing) |
| Line items | `invoice_line_items` (existing) |
| Total amount | `invoices.totalAmount` (sum of line items) |
| Generation status | `invoices.status` |

## What invoicing does NOT own

- Decision to be billing-ready — that's G1/G2's job.
- Patient pricing computation. (Cash-pricing module is the
  authoritative source; invoicing reads, never writes.)
- Claims submission. (NOT Phase 1.)
- ERA / remittance ingestion. (NOT Phase 1.)
- Denial routing. (NOT Phase 1.)
- Payment posting beyond reading `invoice_payments` for display.
  (NOT Phase 1 — see [[phase-1-batch-flow-handoff-contract]] for
  payment posting exclusion.)
- Mission Control / financial dashboards.

## Invoice lifecycle (Phase 1)

```
billing readiness=ready  →  draft  →  finalized  →  delivered
                                                  ↘ voided
```

- `draft`: invoice row created from G2 readiness snapshot; line items
  populated from existing cash-pricing rules.
- `finalized`: amounts locked; PDF (if generated) is rendered from
  existing pdf path (NO behavior change in Phase 1).
- `delivered`: patient-facing send recorded. (Phase 1 records the
  fact; mechanism for sending is OUT of scope.)
- `voided`: terminal; new invoice is required.

## What G4 scaffold provides

- Pure `createDraftInvoice(input)` that returns a draft invoice +
  line-items projection. NO db writes from this scaffold (a future
  approved batch wires the storage helper).
- `isInvoicingScaffoldEnabled(env)` flag accessor for
  `USE_INVOICING_SCAFFOLD_V2` (default OFF).

## Feature flags

| Flag | Default | Scope |
|---|---|---|
| `USE_INVOICING_SCAFFOLD_V2` | OFF | G4 service gate |
| `VITE_USE_INVOICE_UI` | OFF | G5 UI gate |

Both default OFF. Production flip requires explicit Ali approval.

## Boundaries

- **G2 billing readiness:** consumed as input; never written back.
- **Plexus IQ:** unaware of invoicing.
- **Admin Review:** unaware of invoicing.
- **Engagement:** unaware of invoicing.
- **Ancillary:** consumed via document presence; never mutated by
  invoicing.
- **Cash pricing:** read-only input to line-item amounts.
- **Claims submission / ERA / denials / payment posting:** OUT of
  scope — Phase 1 invoicing never invokes these paths.

## Related contracts

- [[phase-1-billing-readiness-boundary-contract]]
- [[phase-1-ancillary-boundary-contract]]
- [[phase-1-plexus-iq-boundary-contract]]
- [[phase-1-admin-review-boundary-contract]]
- [[phase-1-batch-flow-handoff-contract]]

End of contract.
