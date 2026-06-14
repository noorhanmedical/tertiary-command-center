# Phase 4 — Do Not Touch

These surfaces are explicitly off-limits during Phase 4 work.

| Surface | Reason |
|---|---|
| PR #278 premium UI redesign | Open PR, untouched. |
| Mission Control product | Phase 7. |
| Standalone Scheduler Portal product | Never. |
| RingCentral live phone integration | Dormant until Phase 6 explicitly enables it. |
| SMS live integration | Dormant. |
| Phase 3 AI surfaces | Out of phase. |
| Phase 5 AWS / staging / production wiring | Out of phase. |
| Phase 6 clearinghouse / EHR / payment-processor integrations | Out of phase. |
| Phase 8 enterprise scale controls | Out of phase. |

## Layout boundary (Phase 2 contract still applies)

- PCS + ACS share `TeamPortalShell`. Layout unchanged.
- Left rail = general tools. Center = patient canvas. Right rail =
  work queue. Patient facts in the center canvas, NOT the left rail.
- Global calendar isolated from right queues.

## Billing honesty contract

- "Sent" only after a real email or download succeeded.
- "Paid" only when balance ≤ 0 OR an admin explicitly closed with
  reason recorded.
- "Ready to invoice" only when readiness engine emits it without
  blockers.
- "Approved" only when an audited approval row exists.
- "Reminder sent" only after a real send succeeded.

## Anti-patterns guarded by QA

- A toast that fires "Invoice sent" before the server confirmed
  send.
- A status pill that says "Paid" while balance > 0.
- A hardcoded `if (facility === "X")` rule in billing code.
- A hardcoded invoice cutoff day / time / timezone.
- An invoice draft created without policy + recipient snapshot.
- A delivery attempt without a logged event.
- A clearinghouse / payment processor SDK import inside Phase 4
  code.
