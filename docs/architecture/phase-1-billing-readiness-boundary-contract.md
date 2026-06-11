# Phase 1 billing readiness boundary contract

**Status:** Docs-only (Batch G1 of Phase 1 run).
**Companion:** `scripts/qa-phase-1-billing-readiness-boundary-contract.mjs`.

Billing readiness is a READ-ONLY aggregator that decides "is this
patient's record complete enough to invoice." It does NOT decide what
to charge, who to charge, when payment arrives, or how denials are
handled. Mission Control, claims, ERA / remittance, denial routing,
and payment posting are NOT in Phase 1.

## What billing readiness owns in Phase 1

| Concern | Source of truth |
|---|---|
| Per-patient readiness status | `billing_readiness_checks` (existing) |
| Required document presence | `documents.kind` rows on `surface=ancillary` |
| Required signing state | F5/F6 signing-state machine |
| Required ancillary procedure status | `ancillary_appointments.procedureStatus` |

The readiness aggregator is PURE and READ-ONLY. It computes a
status, never writes any money field.

## What billing readiness does NOT own

- Invoice rows or amounts. (G3/G4 — invoicing.)
- Claims submission. (NOT Phase 1.)
- ERA / remittance ingestion. (NOT Phase 1.)
- Denial routing. (NOT Phase 1.)
- Payment posting. (NOT Phase 1.)
- Patient pricing. (Cash-pricing module already exists; readiness
  consumes it as input, never writes.)
- Mission Control dashboards. (Later phase.)

## Inputs (read-only)

- `ancillary_appointments.procedureStatus`
- `documents.surface=ancillary` rows (kinds: report, order_note,
  post_procedure_note, billing_document)
- F5 signing state on documents that require it
- Patient demographics (read from `patients` / `patient_screenings`,
  no PHI surfaced)
- Insurance eligibility (existing read model)

## Output shape (G2 scaffold target)

```ts
type BillingReadinessSnapshot = {
  patientScreeningId: number;
  readinessStatus: "incomplete" | "blocked" | "ready" | "billed";
  blockers: Array<{
    kind: "missing_document" | "unsigned_document" | "procedure_not_complete" | "eligibility_unknown";
    documentKind?: string;
    note?: string;
  }>;
  lastEvaluatedAt: string;
};
```

`readinessStatus=billed` is reserved for the post-invoicing state and
is set by Segment G4/G5 — NOT by the readiness aggregator itself.

## Feature flag

| Flag | Default | Scope |
|---|---|---|
| `USE_BILLING_READINESS_AGGREGATOR_V2` | OFF | G2 service gate |

Default OFF. Production flip requires explicit Ali approval. (V2
denotes the new pure aggregator scaffold; the existing
`billing_readiness_checks` table and write path are unchanged.)

## Boundaries

- **F2 ancillary read-model:** reads `documents` rows; G2 also reads
  but never writes.
- **F6 signing:** G2 consumes `requiresPhysicianSignature(kind)` and
  the snapshot's signing-status to decide `unsigned_document`.
- **Plexus IQ:** unaware.
- **Admin Review:** unaware.
- **Engagement:** unaware (engagement-completed != billing-ready).
- **Invoicing (G3/G4):** consumes readiness; never writes back.
- **Mission Control / claims / remittance / denials / payment
  posting:** NOT Phase 1.

## Related contracts

- [[phase-1-ancillary-boundary-contract]]
- [[ancillary-order-note-tracking-contract]]
- [[physician-signing-contract]]
- [[phase-1-plexus-iq-boundary-contract]]
- [[phase-1-admin-review-boundary-contract]]

End of contract.
