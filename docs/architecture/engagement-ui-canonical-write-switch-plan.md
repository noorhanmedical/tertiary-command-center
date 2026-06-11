# Engagement UI canonical write switch — plan

**Status:** Docs-only (Batch 11 of Engagement completion run).
**Date:** 2026-06-11.
**Companion:** `scripts/qa-engagement-ui-canonical-write-switch-plan.mjs`.

## 1. Current endpoint

The engagement UI today writes the engagement call-result via the singular legacy endpoint:

- `client/src/components/outreach/DispositionSheet.tsx:150` POSTs `/api/engagement-center/call-result` (after first POSTing `/api/outreach/calls` at line 129 — the dual-write).
- `client/src/components/outreach/CanonicalRowActions.tsx:206` POSTs `/api/engagement-center/call-result` only.

## 2. Target endpoint

`POST /api/engagement-center/call-results` (plural) — the canonical endpoint added in Batch 8 (#208), gated server-side by `USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_ENDPOINT` (default OFF).

## 3. Required feature flag

`VITE_USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_UI`:
- Source: `import.meta.env.VITE_USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_UI`.
- Default: unset → `undefined` → falsy → UI uses the legacy singular endpoint.
- Truthy values: `"1"`, `"true"`, `"yes"` (mirrors server-side flag pattern).

A tiny client helper module (e.g. `client/src/lib/engagementCanonicalCallResultsUiFlag.ts`) exports `isEngagementCanonicalCallResultsUiEnabled(): boolean` that wraps the env-var read.

## 4. Scope of UI change

Only the endpoint string changes. Body shape, response handling, query-key invalidations stay byte-equivalent. No visual change, no label rename, no layout shift.

### Files touched

| File | Change |
|---|---|
| `client/src/lib/engagementCanonicalCallResultsUiFlag.ts` | NEW. Pure env-flag accessor. |
| `client/src/components/outreach/CanonicalRowActions.tsx` | Replace the singular path with: `flag ? "/api/engagement-center/call-results" : "/api/engagement-center/call-result"`. |
| `client/src/components/outreach/DispositionSheet.tsx` | Same conditional for the SECOND POST (line 150). The first POST to `/api/outreach/calls` remains — the dual-write pattern is unchanged because outreach delegation is a separate track. |

### Files NOT touched

- `client/src/hooks/api/outreach.ts` — keeps writing the outreach call log; that's a separate sub-workflow.
- `client/src/components/portal/TeamPortalShell.tsx` / `PortalShell.tsx` — they only READ; no POST switch.
- `client/src/hooks/api/keys.ts` — query keys are unchanged.
- `client/src/lib/portal/scheduleInvalidations.ts` — invalidation keys are unchanged.

## 5. Rollback

- Flip `VITE_USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_UI` unset (or `"0"` / `"false"`).
- Restart / rebuild the frontend bundle.
- UI immediately resumes calling the singular endpoint.

If the server-side plural endpoint is disabled while the UI flag is ON, the UI POST returns 404 — submissions fail loudly. Operational dependency: the server-side `USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_ENDPOINT` MUST be ON in any environment where the UI flag is ON.

## 6. Visual QA checklist

- [ ] DispositionSheet renders and submits without console errors with the UI flag OFF (current behavior preserved).
- [ ] DispositionSheet renders and submits without console errors with the UI flag ON AND server-side plural endpoint ON.
- [ ] CanonicalRowActions row actions still trigger the disposition flow.
- [ ] Submit success closes the sheet and invalidates outreach query keys.
- [ ] Submit failure surfaces an error toast.
- [ ] No visual difference between flag OFF and flag ON.
- [ ] No "Scheduler" / "Outreach" label rename in this PR (terminology cleanup is Batch 18-19).

## 7. Operational rollout

1. Land Batch 12 with the UI flag default OFF.
2. Enable `USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_ENDPOINT` server-side in staging.
3. Enable `VITE_USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_UI` in staging (via build env var).
4. Smoke test the disposition flow with both flags ON in staging.
5. After a stabilization window, repeat in production.

## 8. Plexus IQ

Untouched. Plexus IQ UI surfaces do not POST call-results.

## 9. No Team Portal switch in this run

The Team Portal disposition flow is the same DispositionSheet — switching it switches BOTH the engagement-board and Team Portal surfaces together. That is the intended behavior; this plan is engagement-first and Team Portal inherits the canonical endpoint as a free side effect.

If Ali wants Team Portal to stay on the legacy endpoint while the engagement board moves, the DispositionSheet would need a per-caller branch — out of scope for this plan.

## 10. Hard-stops

- No visual redesign.
- No label rename.
- No `client/src/components/outreach/` directory rename.
- No query-key string rename.
- No Plexus IQ change.
- No outreach-route switch (still POST `/api/outreach/calls` for the call log).

End of plan.
