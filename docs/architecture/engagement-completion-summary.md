# Engagement completion — summary

**Status:** Docs-only (Batch 20 of Engagement completion run — FINAL).
**Date:** 2026-06-11.
**Companion:** `scripts/qa-engagement-completion-summary.mjs`.

## 1. PRs shipped in this run (20 total)

| Batch | PR | Title |
|---|---|---|
| 1 | [#201](https://github.com/noorhanmedical/tertiary-command-center/pull/201) | engagementStatusSemantics adapter option |
| 2 | [#202](https://github.com/noorhanmedical/tertiary-command-center/pull/202) | Engagement-route delegation FINAL readiness |
| 3 | [#203](https://github.com/noorhanmedical/tertiary-command-center/pull/203) | Engagement route delegation behind default-OFF flag |
| 4 | [#204](https://github.com/noorhanmedical/tertiary-command-center/pull/204) | Engagement route delegation parity harness |
| 5 | [#205](https://github.com/noorhanmedical/tertiary-command-center/pull/205) | Engagement delegate flag-OFF invariant |
| 6 | [#206](https://github.com/noorhanmedical/tertiary-command-center/pull/206) | Engagement delegate flag-ON invariant |
| 7 | [#207](https://github.com/noorhanmedical/tertiary-command-center/pull/207) | Canonical plural endpoint contract |
| 8 | [#208](https://github.com/noorhanmedical/tertiary-command-center/pull/208) | Canonical plural endpoint behind default-OFF flag |
| 9 | [#209](https://github.com/noorhanmedical/tertiary-command-center/pull/209) | Singular endpoint compatibility-adapter invariant |
| 10 | [#210](https://github.com/noorhanmedical/tertiary-command-center/pull/210) | UI post-delegation source audit |
| 11 | [#211](https://github.com/noorhanmedical/tertiary-command-center/pull/211) | UI canonical write switch plan |
| 12 | [#212](https://github.com/noorhanmedical/tertiary-command-center/pull/212) | UI canonical write switch (VITE flag default OFF) |
| 13 | [#213](https://github.com/noorhanmedical/tertiary-command-center/pull/213) | Call-list ownership final contract |
| 14 | [#214](https://github.com/noorhanmedical/tertiary-command-center/pull/214) | Call-list service module plan |
| 15 | [#215](https://github.com/noorhanmedical/tertiary-command-center/pull/215) | Dormant engagement call-list service scaffold |
| 16 | [#216](https://github.com/noorhanmedical/tertiary-command-center/pull/216) | Call-list route contract |
| 17 | [#217](https://github.com/noorhanmedical/tertiary-command-center/pull/217) | Call-list route behind default-OFF flag |
| 18 | [#218](https://github.com/noorhanmedical/tertiary-command-center/pull/218) | UI terminology implementation plan |
| 19 | [#219](https://github.com/noorhanmedical/tertiary-command-center/pull/219) | UI terminology implementation BLOCKERS (STOP) |
| 20 | this PR | Engagement completion summary |

## 2. What is now delegated

- **`POST /api/engagement-center/call-result`** (singular) — delegates to `recordEngagementCallResult` when `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE` is ON. Coarse engagementStatus semantics for legacy parity. Closure-capture deps reassemble the legacy 6-key response envelope byte-equivalent. Default OFF.
- **`POST /api/engagement-center/call-results`** (plural, NEW) — gated by `USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_ENDPOINT`. Returns 404 when OFF. When ON, shares the SAME handler as the singular route (no business logic duplication). Default OFF.
- **`GET /api/engagement-center/call-list`** (NEW) — gated by `USE_ENGAGEMENT_CANONICAL_CALL_LIST_READ`. Returns 404 when OFF. When ON, delegates to the dormant engagement call-list service scaffold with a projection over `listEngagementCenterCases`. Default OFF.
- **Engagement Center UI** — DispositionSheet line 150 + CanonicalRowActions line 206 now route through `engagementCallResultEndpoint()` helper, which toggles between singular (default) and plural based on `VITE_USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_UI`. Default OFF.

## 3. What is still flag-gated

ALL eight engagement-related flags default OFF on merge:

- `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE` (server)
- `USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_ENDPOINT` (server)
- `USE_ENGAGEMENT_CANONICAL_CALL_LIST_READ` (server)
- `VITE_USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_UI` (client)
- `USE_RECORD_CALL_RESULT_ENGAGEMENT_PREVIEW` (server — earlier run)
- `USE_RECORD_CALL_RESULT_OUTREACH_PREVIEW` (server — earlier run)
- `USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE` (server — earlier run, accessor only)
- `ENGAGEMENT_TO_CALL_LIST_BRIDGE` (server — earlier run)

## 4. Does canonical plural endpoint exist?

**Yes.** `POST /api/engagement-center/call-results` exists, shares the singular route's extracted `callResultHandler`, and is gated by a default-OFF flag.

## 5. Did UI switch?

**Yes — behind a default-OFF VITE flag.** The Engagement UI uses `engagementCallResultEndpoint()` which returns the plural endpoint only when `VITE_USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_UI` is truthy. No visual change. No label rename.

## 6. Does call-list service exist?

**Yes — dormant scaffold + flag-gated route.** `getEngagementCallList(filters, deps)` is the canonical read function, pure (no DB / Express / @shared/schema imports). The route at `GET /api/engagement-center/call-list` is its only runtime caller, gated by default-OFF flag.

## 7. What remains for Team Portal

- Team Portal still reads `/api/portal/outreach-call-list` (legacy day-of view).
- Team Portal disposition flow (DispositionSheet) inherits the engagement UI canonical endpoint switch automatically — it's the same component.
- Future PR: build a Team Portal projection on top of the canonical call-list service (Batch 20 of Engagement completion run says NOT in this run).

## 8. What remains for Outreach

- `POST /api/outreach/calls` route is UNCHANGED. The outreach delegation accessor + executor are dormant (Batch 19 of split-brain run blockers stand).
- Outreach delegation requires (a) per-surface step suppression on the canonical adapter (DONE in this run via prior runs' arg-extensions), and (b) Ali decisions on Batch 19 B4 (TERMINAL set superset) and B5 (journey event on outreach).
- Future PR series will wire outreach delegation following the same pattern this run used for engagement.

## 9. What remains for Journey Events

- `appendJourneyEvent` (Bundle 12c) is still the canonical writer for `patient_journey_events`.
- The engagement route delegation supplies its own `appendJourneyEvent` dep closure that wraps the canonical writer — DB effects are byte-equivalent under flag ON.
- The Batch 3 source scanner baseline still reports 2 known parallel journey-event writers (executionCase.repo.ts + routes/patients.ts). Those are sequenced for consolidation in a separate run that touches Admin Review reasoning regeneration + qualification reasoning.

## 10. What remains for Plexus IQ

- **Plexus IQ runtime was NOT touched in this run.** Every QA pin holds:
  - No Plexus IQ file imports any of the call-result/call-list services or flags.
  - No Plexus IQ writes to operational workflow tables.
- Plexus IQ remains the intelligence / read-model / aggregation layer.
- Future Ali-approved work may wire Plexus IQ to READ the canonical call list (via the Batch 17 route) for aggregation — that PR series is out of scope here.

## 11. Exact next recommended run

**Outreach completion run** — mirror the engagement-completion pattern for the outreach surface. Specifically:

1. Adapter / executor extension to address Batch 19 of split-brain run's B1 (atomic createOutreachCallAtomic passthrough).
2. Ali decision implementation for B4 (outreach-only outcome extension) per Batch F #190 of adapter blockers run.
3. Ali decision implementation for B5 (journey event on outreach) per Batch D #188 of adapter blockers run.
4. Wire outreach route delegation behind `USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE` (default OFF).
5. Parity harness + flag invariants (mirror of engagement Batches 4-6).
6. Outreach UI write switch (parallel to engagement Batch 12).
7. Team Portal projection of the canonical call-list service (consumes Batch 17 of this run).
8. Engagement UI terminology sweep (Batch 19 blockers cleared by Ali-approved comms window).

## 12. Hard-stops respected in this run

- No flag flipped ON.
- No migration.
- No billing money / claim / remittance behavior touched.
- No qualification final-decision behavior touched.
- No PDF / document generation behavior touched.
- No Admin Review approval behavior touched.
- No Plexus IQ runtime touched.
- No scratch files committed.
- No CLAUDE.md / artifacts/ / tmp_recovery/ committed.

End of summary.
