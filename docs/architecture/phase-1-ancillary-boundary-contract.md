# Phase 1 ancillary workflow boundary contract

**Status:** Docs-only (Batch F1 of Phase 1 run).
**Companion:** `scripts/qa-phase-1-ancillary-boundary-contract.mjs`.

The ancillary workflow is the post-scheduling track that runs from
"patient is on the ancillary calendar" through "report uploaded /
order note in / physician signed." It is distinct from Plexus IQ
(qualification), Admin Review (reasoning approval), Engagement
(operational call workflow), Billing readiness (Segment G), and
Mission Control (later).

## What ancillary owns in Phase 1

| Concern | Source of truth |
|---|---|
| Appointment / procedure row | `ancillary_appointments` |
| Procedure status | `ancillary_appointments.procedureStatus` |
| Uploaded report blob pointer | `documents` rows with `kind=report` |
| Order / referral note | `documents` rows with `kind=order_note` |
| Post-procedure note | `documents` rows with `kind=post_procedure_note` |
| Physician signing state | document-signing fields (added in F5/F6 contract — not in this batch) |

## What ancillary does NOT own

- Qualification reasoning (Plexus IQ).
- Admin Review approval (Admin Review).
- Outbound calls, dispositions, callbacks (Engagement / Outreach).
- Patient demographics writes (Plexus IQ / batch flow).
- Billing readiness aggregation (Segment G).
- Invoice rows or amounts (Segment G).
- Claims, ERA / remittance, denials, payment posting (NOT Phase 1).
- PDF generation / signing engine behavior (protected — only contract
  expansion in F5/F6, no behavior change without explicit approval).

## Phase 1 deliverables

| Batch | What |
|---|---|
| F1 (this) | Boundary contract — what ancillary is and is not |
| F2 | Pure read-model service (`server/services/ancillary/*`) — dormant |
| F3 | Report upload contract (storage target, MIME constraints) |
| F4 | Order / note tracking contract |
| F5 | Physician signing contract (signing-state machine boundary) |
| F6 | Signing service scaffold — dormant, no PDF behavior change |

All Phase 1 ancillary work is additive and dormant. UI changes in
Segment F are NOT planned in Phase 1 unless an additive Team Portal
panel section becomes necessary (in which case the protected-layout
rules from `team-portal-panel-playground-protection-contract` apply).

## Feature flag posture

| Flag | Default | Scope |
|---|---|---|
| `USE_ANCILLARY_READ_MODEL` | OFF | F2 server-side gate |
| `USE_ANCILLARY_REPORT_UPLOAD` | OFF | F3 ingress gate |
| `USE_ANCILLARY_SIGNING_SERVICE` | OFF | F6 service gate |
| `VITE_USE_ANCILLARY_PANEL_SECTIONS` | OFF | If a UI render becomes needed |

All flags default OFF. Production flip requires explicit Ali
approval.

## Boundaries with other modules

- **Plexus IQ:** consumes ancillary status as a read-only field on the
  patient row; never writes to ancillary tables.
- **Admin Review:** unaware of ancillary state; reads only
  `patient_screenings.reasoning` for its surface.
- **Engagement:** writes `ancillary_appointments` only via the
  scheduled-flow side-effect of `recordCallResult` `outcome=scheduled`
  (which already flows through `desiredAppointmentStatus`); never
  changes a procedure's terminal status.
- **Billing readiness (G):** consumes ancillary status + `documents`
  presence as inputs; never writes to ancillary tables.
- **Invoicing (G):** depends on billing readiness, not directly on
  ancillary.

## Related contracts

- [[phase-1-plexus-iq-boundary-contract]]
- [[phase-1-admin-review-boundary-contract]]
- [[phase-1-batch-flow-handoff-contract]]
- [[team-portal-panel-playground-protection]]

End of contract.
