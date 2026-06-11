# Phase 1 — Team Portal outreach write audit

**Status:** Docs-only (Batch B10 of Phase 1 run).
**Date:** 2026-06-11.
**Companion:** `scripts/qa-phase-1-team-portal-outreach-write-audit.mjs`.

## 1. Current Team Portal call-result write paths

| File | Endpoint POSTed | Notes |
|---|---|---|
| `client/src/components/outreach/DispositionSheet.tsx:129` | `POST /api/outreach/calls` | Primary (always called) |
| `client/src/components/outreach/DispositionSheet.tsx:150` | `engagementCallResultEndpoint()` → singular or plural engagement endpoint | Sequential dual-write per #212 / Engagement completion run Batch 12 |
| `client/src/components/outreach/CanonicalRowActions.tsx:206` | `engagementCallResultEndpoint()` | Engagement-only path |
| `client/src/hooks/api/outreach.ts:70` | `POST /api/outreach/calls` | Outreach hook |

## 2. What is still legacy

- The outreach POST at line 129 of DispositionSheet and line 70 of the outreach hook still goes to `/api/outreach/calls` directly.
- The engagement POST at line 150 of DispositionSheet uses the canonical endpoint helper (line 150 — engagement-side only).
- The DispositionSheet sequential dual-write pattern (#164 Batch 5 of split-brain run) persists — the UI does two POSTs per submit.

## 3. Canonical target

Per Phase 1 architecture rule, Team Portal should EVENTUALLY POST a SINGLE call result to the canonical Engagement endpoint (`/api/engagement-center/call-results` plural). The outreach route remains as a compatibility adapter for non-Team-Portal callers.

The Team Portal single-POST migration is gated by:

1. The canonical engagement endpoint being stable in production (`USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_ENDPOINT` enabled).
2. The engagement delegation handling the full outreach-only canonical outcome set (`completed / dnc / do_not_contact / deceased / cancelled` — landed in Batch B2 of this run).
3. Team Portal panels/playground preserved during the switch.
4. Ali approval per the operator-communication window.

## 4. Team Portal panels/playground protection

The following surfaces MUST be preserved unchanged by any Team Portal call-result write switch:

- `client/src/components/portal/TeamPortalShell.tsx`
- `client/src/components/portal/PortalShell.tsx`
- `client/src/features/command-center/tiles/*` (Patient Command Canvas + Outreach Command Tile + Visit/Outreach toggle)
- `client/src/components/outreach/CallListPanel.tsx` (referenced by playground)
- `client/src/components/outreach/DispositionSheet.tsx` layout (only the URL string is allowed to change behind a flag)
- `client/src/components/outreach/CanonicalRowActions.tsx` layout

The audit-only nature of this batch: NO UI file is edited in B10.

## 5. Next safe Team Portal switch

Segment E ships the Team Portal canonical call-result write switch:
- Batch E1 — panel/playground protection QA.
- Batch E8 — write-switch plan.
- Batch E9 — flag-gated single-POST switch (replaces DispositionSheet's two POSTs with one POST to the canonical endpoint), behind `USE_TEAM_PORTAL_CANONICAL_CALL_RESULT_WRITE` (default OFF).

Until E9 ships, DispositionSheet's dual-write pattern persists. Team Portal continues to function exactly as today.

## 6. Plexus IQ + Admin Review

Untouched. Neither writes call results from the UI.

## 7. Hard-stops

- No UI file edited in B10.
- No Team Portal panel/playground change.
- No call-list panel layout change.
- No Plexus IQ / Admin Review change.
- No new endpoint added.

End of audit.
