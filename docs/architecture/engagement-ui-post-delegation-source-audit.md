# Engagement Center UI — post-delegation source audit

**Status:** Docs-only (Batch 10 of Engagement completion run).
**Date:** 2026-06-11.
**Companion:** `scripts/qa-engagement-ui-post-delegation-source-audit.mjs`.

After Batches 3 + 8 wired the engagement-route delegation + the canonical plural endpoint behind default-OFF flags, this audit inspects which `client/src` surfaces still write engagement call-results and which endpoints they target.

## 1. UI files that POST engagement call-results

Verified by `grep -rln '/api/engagement-center/call-result\|/api/outreach/calls' client/src`:

| File | Line | Endpoint POSTed |
|---|---|---|
| `client/src/components/outreach/DispositionSheet.tsx` | 129 | `POST /api/outreach/calls` (primary) |
| `client/src/components/outreach/DispositionSheet.tsx` | 150 | `POST /api/engagement-center/call-result` (sequential dual-write) |
| `client/src/components/outreach/CanonicalRowActions.tsx` | 206 | `POST /api/engagement-center/call-result` (engagement-only path) |
| `client/src/hooks/api/outreach.ts` | 70 | `POST /api/outreach/calls` (outreach hook) |

## 2. Endpoint each surface calls

- DispositionSheet writes BOTH endpoints sequentially per submit (the dual-write pattern documented in #164 Batch 5 of the split-brain run).
- CanonicalRowActions writes ONLY the singular engagement endpoint.
- The outreach hook writes ONLY the outreach endpoint.

## 3. Is anything calling the plural canonical endpoint?

**No.** The plural `POST /api/engagement-center/call-results` has been wired server-side (Batch 8, #208) but ZERO client/src files reference it yet.

## 4. Does any Engagement UI call `/api/outreach/calls`?

**Yes — DispositionSheet.tsx:129 and the outreach hook.** This is the same finding as #164 Batch 5 audit. After Batch 3 + 8 of this run, the server side now has a unified canonical write path; the UI dual-write is the remaining split-brain.

## 5. Does any UI bypass canonical service?

**Yes — the dual-write pattern bypasses the canonical service idea by writing through TWO endpoints.** Each endpoint is a separately-flagged delegation surface; the canonical write happens via the engagement-center server-side delegation only.

## 6. Which files need future UI rewiring?

Three files would need rewiring to land the canonical-UI switch:

- `client/src/components/outreach/DispositionSheet.tsx` — collapse the two POSTs into a single POST to the canonical plural endpoint.
- `client/src/components/outreach/CanonicalRowActions.tsx` — switch the singular POST to the plural endpoint.
- `client/src/hooks/api/outreach.ts` — repoint the outreach call-log POST (or split into two hooks — one keeps writing the outreach call log; the other writes the canonical engagement call-result through the plural endpoint).

The query keys file (`client/src/hooks/api/keys.ts`) would also need invalidation-key updates after the rewire, but it does NOT POST.

## 7. Can UI change now safely?

**Conditional yes.** The change is safe IF:
- A frontend flag exists or can be added.
- The flag defaults OFF.
- The plural server endpoint is enabled in the SAME environment where the UI flag is ON.
- Without the server flag, the plural endpoint returns 404 — visible breakage.

The repo's frontend flag pattern (single existing example): `import.meta.env.DEV` in `client/src/lib/pdfGeneration.ts:198`. The project uses Vite, which supports `import.meta.env.VITE_*` user-defined variables. A new variable `VITE_USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_UI` (default unset → falsy) would mirror the server-side flag pattern.

## 8. What requires Ali visual approval?

ANY UI change. Even a flag-gated repoint that switches the endpoint with no visual change requires Ali approval per:
- #164 Batch 5 audit §9 — "Any actual edit to DispositionSheet.tsx, CanonicalRowActions.tsx, TeamPortalShell.tsx, PortalShell.tsx, or the outreach hooks file."
- #180 Batch 21 readiness §9 — "Removing the dual-write from DispositionSheet."

The reason: even a "behaviorally equivalent" UI change ships with the risk of:
- Submit ordering subtly changing (current dual-write does outreach first, engagement second; canonical is one POST).
- Error-path semantics changing (current: if engagement POST fails, outreach POST has landed; canonical: one POST, atomic on server).
- Query-key invalidations shifting which lists refresh.

## 9. Recommended sequence

1. **Batch 11 (next):** plan the switch — include the proposed VITE flag name, the exact files touched, the rollback plan, and the visual QA checklist.
2. **Batch 12:** if Ali approves the plan, ship the flag-gated repoint. If not, ship a blockers doc + STOP.
3. Operational rollout: enable the server flag in staging → enable the UI flag in staging → smoke test → repeat in production after stabilization.

## 10. Plexus IQ

Untouched. Plexus IQ surfaces do not POST call-results.

## 11. Hard-stops respected by this audit

- No client/src file is edited.
- No flag added.
- No endpoint added.
- No Plexus IQ touched.

End of audit.
