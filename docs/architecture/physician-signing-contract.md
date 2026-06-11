# Physician signing contract

**Status:** Docs-only (Batch F5 of Phase 1 run).
**Companion:** `scripts/qa-physician-signing-contract.mjs`.

Defines the signing-state machine for ancillary documents that need a
physician's signature before downstream consumers (billing readiness,
invoicing) can rely on them. PDF generation behavior is OUT of scope
for this contract — Phase 1 must not change rendered output.

## Documents that require signing

| kind | Phase 1 disposition |
|---|---|
| `post_procedure_note` | YES — physician must sign before billing readiness counts it |
| `report` | YES (if procedure kind requires it; pulled from existing rule table) |
| `order_note` | NO — the referring physician signed upstream |
| `informed_consent` | OUT of scope (patient signing, separate path) |
| `screening_form` | OUT of scope |

## Signing-state machine

```
             ┌─────────┐
             │ unsigned│ (initial when document row is created)
             └────┬────┘
                  │ physician opens, reviews, taps Sign
                  ▼
             ┌─────────┐
             │ pending │ (signing request enqueued; awaiting attest)
             └────┬────┘
        ┌─────────┼─────────┐
        ▼         ▼         ▼
   ┌────────┐ ┌────────┐ ┌──────────┐
   │ signed │ │declined│ │ revoked  │
   └────────┘ └────────┘ └──────────┘
```

States are persisted on a future `documents.signingStatus` column
(reserved; added by F6 contract — NOT in this batch). Until F6 lands
the state is computed from absence-of-signature.

## Allowed transitions

| From | To | Trigger |
|---|---|---|
| `unsigned` | `pending` | Physician opens signing UI |
| `pending` | `signed` | Physician attests + posts to signing endpoint |
| `pending` | `declined` | Physician rejects |
| `pending` | `unsigned` | Physician cancels |
| `signed` | `revoked` | Admin override (audit-logged) |

`signed` and `revoked` are terminal for the document version. A new
version restarts the machine at `unsigned`.

## What signing MUST NOT do

- Mutate the PDF bytes. (PDF generation behavior is protected — F6
  scaffolds the service but cannot change rendered output without
  explicit approval.)
- Mutate qualification reasoning (Admin Review territory).
- Mutate billing money state (Segment G).
- Auto-create or mutate invoice rows (Segment G).
- Bypass the existing facility ACL on the document row.

## Feature flag

| Flag | Default | Scope |
|---|---|---|
| `USE_ANCILLARY_SIGNING_SERVICE` | OFF | F6 scaffold + future ingress route |

Default OFF. Production flip requires explicit Ali approval.

## Boundaries

- **F2 read-model:** observes `signed` state via the document
  presence; consumes the state to compute `signed_present` blocker.
- **F3 upload:** independent of signing. An uploaded report starts in
  `unsigned`.
- **Engagement / Plexus IQ / Admin Review:** unaware of signing.
- **Billing readiness (G):** consumes `signed` for billing-eligible
  document kinds.
- **Invoicing (G):** consumes billing readiness, not signing state
  directly.

## Related contracts

- [[phase-1-ancillary-boundary-contract]]
- [[ancillary-report-upload-contract]]
- [[ancillary-order-note-tracking-contract]]

End of contract.
