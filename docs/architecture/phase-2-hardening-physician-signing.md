# Phase 2 hardening — Physician signing honest block (item 4)

## Audit findings

`server/services/ancillary/signingService.ts` defines a dormant
state machine (`unsigned → pending → signed/declined/revoked`)
gated by `USE_ANCILLARY_SIGNING_SERVICE=1`. No route, no storage
writer, no UI uses it today.

The exact missing pieces:

| Piece | Status |
|---|---|
| State machine | exists (dormant) |
| `/api/portal/sign-order` route | **missing** |
| Storage helper to mark `physician_signed_order` documentStatus = `signed` | **missing** |
| Attestation audit (actor + timestamp + IP) | **missing** |
| Signed-order PDF rendering | **missing** |
| Identity verification | **missing** |

## Decision

Hardening item 4 does NOT add a fake signing writer. It DOES surface
the pending state more explicitly than PR 2.5 did, so the operator
sees the gap rather than seeing only a small pill.

## Surface change

`client/src/components/portal/AcsWorkflowPanel.tsx` now renders an
explicit block when the workflow reports
`physician_signature_pending`:

```
Physician signing pending
Physician signing writer not configured yet — the order note is
present but no canonical physician_signed_order writer / route
exists. See docs/architecture/phase-2-hardening-physician-signing.md.
```

`data-testid="acs-physician-signing-pending-block"` for QA.

## Anti-pattern guards

`qa-phase-2-hardening-physician-signing-honesty.mjs`:

- No `/api/portal/sign-order` route may exist (gates a future
  addition through an explicit honesty review).
- `signingService.ts` remains dormant (default OFF).
- AcsWorkflowPanel must render the explicit pending block.
- No client component fakes a "Signed" badge for a row whose
  `documentStatus` is not in the present set.

## Future enablement path

To enable physician signing properly (NOT in scope here):

1. Add a `POST /api/portal/sign-order` route that uses
   `signingService.canTransition(...)`.
2. Persist `physician_signed_order` documentStatus = `signed` via
   `case_document_readiness/complete`.
3. Capture actor + timestamp + (optional) IP into the readiness
   metadata.
4. Update `AcsWorkflowPanel` to remove the explicit block when the
   service is enabled.
