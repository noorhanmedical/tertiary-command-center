# Team Portal call-result source wiring — readiness

**Status:** Docs-only (Batch 21 of platform split-brain run).
**Date:** 2026-06-10.
**Companion:** `scripts/qa-team-portal-call-result-source-wiring-readiness.mjs`.

## 1. Purpose

Inspect Team Portal's current call-result write path on-disk + name the readiness criteria the future UI consolidation must satisfy before it is safe to rewire the disposition flow to the canonical Engagement Center endpoint.

This batch makes no UI change. UI changes require Ali approval.

## 2. Current Team Portal call-result write path

From the Batch 5 UI wiring audit:

- **Primary surface:** `client/src/components/outreach/DispositionSheet.tsx`.
- **Submit flow (lines 129 + 150):**
  1. First POSTs `/api/outreach/calls` with the legacy outreach body. Captures returned call row.
  2. Then POSTs `/api/engagement-center/call-result` with a canonical-shaped body. Captures returned engagement envelope.
- **No transactional contract.** If the second POST fails, the first one already landed.
- **Mutation invalidations** (lines 160-165): `/api/outreach/calls`, `/api/outreach/calls/by-patients`, `/api/outreach/calls/today` query keys invalidated.
- **Secondary surface:** `client/src/components/outreach/CanonicalRowActions.tsx:206` — POSTs `/api/engagement-center/call-result` (engagement-only path; used when the row originated from the engagement board).

## 3. Current DispositionSheet behavior

- Renders a form for outcome + notes + (when applicable) callbackAt.
- Submits via the dual-write described above.
- On success: closes itself, invalidates the outreach query keys.
- Does NOT distinguish "engagement-center surface" vs "outreach surface" to the user — the dual-write is a hidden compatibility shim.

## 4. Current CanonicalRowActions behavior

- Provides per-row quick disposition actions on the engagement board.
- Submits a single POST to `/api/engagement-center/call-result`.
- No dual-write.

## 5. Current call-list endpoints used by Team Portal

| Surface | Endpoint | Auth | Notes |
|---|---|---|---|
| TeamPortalShell call list | `GET /api/portal/outreach-call-list` | Portal role | Query keyed `["/api/portal/outreach-call-list", facility]` |
| PortalShell call list (older) | same as above | Portal role | Same key — both shells refresh together |
| Call history (per patient) | `GET /api/portal/calls?patientScreeningId=<id>` | Portal role | Batch I; flag-gated by `USE_PORTAL_CALL_HISTORY_READ` (default OFF) |

## 6. Target canonical endpoint

- `POST /api/engagement-center/call-results` (plural; Batch 6 contract). NOT yet wired.
- Lifecycle:
  - Phase A — engagement delegation behind `USE_RECORD_CALL_RESULT_ENGAGEMENT_DELEGATE` ships (after Batch 12 blockers resolved). UI still uses dual-write.
  - Phase B — outreach delegation behind `USE_RECORD_CALL_RESULT_OUTREACH_DELEGATE` ships (after Batch 19 blockers resolved). UI still uses dual-write.
  - Phase C — UI consolidates DispositionSheet into a single canonical POST. The legacy endpoints stay as compatibility adapters.

## 7. UI wording changes needed

- **DispositionSheet UI strings.** The form currently uses neutral language; review surface labels for "Scheduler" / "Outreach" terms that should become "Team Member" / "Engagement Center."
- **Mutation key strings.** `["/api/outreach/calls"]` invalidations are scoped to the outreach surface. Once consolidated, these become engagement invalidations.
- **Toasts / inline labels.** Verify no toast text says "outreach call logged" — should be "call result logged" surface-neutral.

## 8. Ali approval needed for

- Removing the dual-write from DispositionSheet.
- Renaming the `client/src/components/outreach/` directory to engagement-centric.
- Changing any UI string visible to operators (e.g. "Outreach" → "Engagement Center").
- Renaming the `/scheduler-portal` page route in the client router.
- Removing `CanonicalRowActions`-as-distinct-component if consolidation makes it redundant.

## 9. Ali approval NOT needed for

- Adding new dormant docs / fixtures / QA scripts to track readiness.
- Server-side flag-gated delegation work (already governed by its own contracts).
- New canonical endpoint behind the canonical Batch 6 contract.

## 10. Plexus IQ

Untouched. The Plexus IQ UI surfaces are independent of the call-result disposition flow.

## 11. Hard-stops

- No UI source file is edited in this batch.
- No client-side query key is renamed.
- No client-side mutation hook is added or removed.
- No DispositionSheet behavior change.
- No CanonicalRowActions behavior change.

End of readiness.
