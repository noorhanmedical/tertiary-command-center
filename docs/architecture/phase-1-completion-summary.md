# Phase 1 completion summary

**Status:** Docs-only (Batch I3 of Phase 1 run).
**Companion:** `scripts/qa-phase-1-completion-summary.mjs`.

This document records what shipped in Phase 1 of the
tertiary-command-center program. It is the canonical "what is true on
main today" reference for anyone joining the project mid-stream.

## Segments shipped

| Segment | Deliverable | PRs |
|---|---|---|
| A | Engagement completion (prior run) | merged before this run |
| B | Engagement assignment runtime restoration | #9 |
| C | Plexus IQ / Admin Review boundaries + Batch Flow handoff | merged prior |
| D | (continued boundary work) | merged prior |
| E1 | Team Portal panel/playground protection QA | #241 |
| E2 | Patient Directory wiring contract | #242 |
| E3 | Structured call-result selector contract | #243 |
| E4 | Structured call-result selector implementation | #244 |
| E5 | RingCentral adapter contract | #245 |
| E6 | RingCentral adapter scaffold | #246 |
| E7 | Patient call-history read wiring | #247 |
| E8 | Canonical call-result write switch plan | #248 |
| E9 | Canonical call-result write switch implementation | #249 |
| E10 | Team Portal assigned-work refresh | #250 |
| F1 | Ancillary boundary contract | #251 |
| F2 | Ancillary read-model scaffold | #252 |
| F3 | Ancillary report upload contract | #253 |
| F4 | Ancillary order/note tracking contract | #254 |
| F5 | Physician signing contract | #255 |
| F6 | Physician signing service scaffold | #256 |
| G1 | Billing readiness boundary contract | #257 |
| G2 | Billing readiness aggregator V2 scaffold | #258 |
| G3 | Invoicing boundary contract | #259 |
| G4 | Invoicing service scaffold | #260 |
| G5 | Invoice draft panel scaffold | #261 |
| H1 | AWS deployment contract + `.gitignore` `.env*` block | #262 |
| H2 | Env var inventory | #263 |
| H3 | AWS deploy runbook | #264 |
| H4 | AWS backup runbook | #265 |
| H5 | AWS smoke-test runbook | #266 |
| I1 | End-to-end smoke contract | #267 |
| I2 | Scanner enforcement plan | #268 |
| I3 | This summary | (current PR) |

## Live runtime changes shipped

The Phase 1 run shipped four runtime-affecting client changes, all
default-OFF and additive:

1. **E4 structured selector**: gated by
   `VITE_USE_STRUCTURED_CALL_RESULT_SELECTOR` — additive card inside
   DispositionSheet exposing the 15 canonical outcomes.
2. **E7 call-history panel**: gated by
   `VITE_USE_PATIENT_CALL_HISTORY_READ` (server-side
   `USE_PORTAL_CALL_HISTORY_READ` independently gates the endpoint).
3. **E9 primary-write switch**: default behavior now routes
   DispositionSheet's primary write to
   `engagementCallResultEndpoint()`. The pre-E9 dual-write is
   preserved behind `VITE_USE_LEGACY_DISPOSITION_WRITE=1` for one
   release.
4. **E10 query invalidations**: DispositionSheet + CanonicalRowActions
   now invalidate the Team Portal assigned-work query keys
   (`/api/engagement-center/cases`,
   `/api/portal/outreach-call-list`, `/api/portal/my-tasks`,
   `/api/portal/today-schedule`, `portal-call-history`) so the
   cockpit refreshes without waiting for the 60s poll.
5. **G5 invoice draft panel**: placeholder-only card gated by
   `VITE_USE_INVOICE_UI`.

## Dormant scaffolds shipped

Every Phase 1 scaffold is dormant by default — no route imports it,
production behavior is unchanged.

- `server/services/ringCentral/` (E6) — adapter facade + dormant client.
- `server/services/ancillary/ancillaryReadModel.ts` (F2) — pure
  blocker computation.
- `server/services/ancillary/signingService.ts` (F6) — F5 transition
  table + helpers.
- `server/services/billingReadiness/billingReadinessAggregator.ts`
  (G2) — pure readiness projection.
- `server/services/invoicing/invoicingScaffold.ts` (G4) — pure
  invoice draft projection.

## Boundary contracts pinned (no behavior change)

- Plexus IQ boundary (Phase 1)
- Admin Review boundary (Phase 1)
- Batch Flow handoff
- Team Portal panel / playground protection
- Patient Directory wiring (future)
- Structured call-result selector (now wired)
- Canonical call-result write switch (now wired)
- RingCentral adapter (scaffold)
- Ancillary boundary
- Report upload (future)
- Order / note tracking
- Physician signing (scaffold)
- Billing readiness (scaffold)
- Invoicing (scaffold)
- AWS deployment + deploy + backup + smoke + env inventory
- End-to-end smoke
- Scanner enforcement plan

## Flag posture summary

All Phase 1 flags default OFF. Detailed inventory:
[[phase-1-env-var-inventory]].

## QA coverage

`scripts/qa-*.mjs` count on the deploying commit: 161+ (one new QA
per merged batch). Run `for s in scripts/qa-*.mjs; do node "$s"
>/dev/null || { echo FAIL: $s; exit 1; }; done` to gate any merge.

## What did NOT ship (Phase 1 exclusions, confirmed)

- Production cut-over to AWS.
- Mission Control UI / runtime.
- Claims submission.
- ERA / remittance ingestion.
- Denial routing.
- Payment posting (beyond reading existing `invoice_payments` for
  display).
- New PDF generation behavior.
- Plexus IQ UI / runtime change.
- Admin Review UI / runtime change.
- Team Portal panel / layout redesign.
- Database migrations (none added in this run).

## Next phase candidates (NOT in Phase 1)

These are the natural follow-on batches:

1. CI workflow file (per I2 plan).
2. Production cut-over (per H1 contract).
3. RingCentral route + UI wiring (per E5 contract).
4. Patient Directory route + UI wiring (per E2 contract).
5. Ancillary report upload route (per F3 contract).
6. Physician signing route + UI (per F5/F6).
7. Billing readiness route + UI (per G1/G2).
8. Invoicing route + UI (per G3/G4/G5).
9. Mission Control (out-of-scope for Phase 1 by design).

## Related contracts

- [[phase-1-end-to-end-smoke-contract]]
- [[phase-1-aws-deployment-contract]]
- [[phase-1-env-var-inventory]]
- [[phase-1-scanner-enforcement-plan]]

End of summary.
