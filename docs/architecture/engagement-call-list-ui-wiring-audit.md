# Engagement call-list UI / source wiring audit

**Status:** Docs-only (Batch 5 of platform split-brain run).
**Date:** 2026-06-10.
**Companion:** `scripts/qa-engagement-call-list-ui-wiring-audit.mjs`.

## 1. UI surfaces inspected

- `client/src/components/portal/TeamPortalShell.tsx`
- `client/src/components/portal/PortalShell.tsx`
- `client/src/components/outreach/DispositionSheet.tsx`
- `client/src/components/outreach/CanonicalRowActions.tsx`
- `client/src/hooks/api/outreach.ts`
- `client/src/hooks/api/keys.ts`
- `client/src/lib/portal/scheduleInvalidations.ts`

(Plus Patient Command Canvas / SchedulePatientPlayground / CallListPanel — not directly endpoint-calling at audit time.)

## 2. Which UI surfaces show the call list

| Surface | Endpoint read | Notes |
|---|---|---|
| `TeamPortalShell.tsx:1153` | `GET /api/portal/outreach-call-list` | Team Portal's primary call list |
| `PortalShell.tsx:832` | `GET /api/portal/outreach-call-list` | Older portal shell — both shells query the same key |
| Engagement Center board | `GET /api/engagement-center/cases` | The board view; engagement-case rows |

`scheduleInvalidations.ts:69` invalidates the `/api/portal/outreach-call-list` query key on schedule mutations.

## 3. Which UI surfaces log call results

This is where the split-brain is most visible in the client.

| Surface | Endpoint(s) called | Behavior |
|---|---|---|
| `DispositionSheet.tsx:129` | `POST /api/outreach/calls` | Primary write — the legacy outreach call log. |
| `DispositionSheet.tsx:150` | `POST /api/engagement-center/call-result` | **Sequential dual-write** in the same submit handler — after the outreach POST returns, the component additionally POSTs to engagement-center to update the engagement case. |
| `CanonicalRowActions.tsx:206` | `POST /api/engagement-center/call-result` | Engagement-only path (rows that came from the engagement board). |
| `outreach.ts:70` (hook) | `POST /api/outreach/calls` | Outreach-only hook used by older paths. |

### 3.1 The DispositionSheet dual-write is the UI patching around split-brain

`DispositionSheet.tsx` submits a disposition by:
1. POSTing to `/api/outreach/calls` (writes outreach_calls + appointmentStatus + scheduler-assignment terminal completion).
2. **Then** POSTing to `/api/engagement-center/call-result` (appends journey event + updates execution case + maybe opens triage + maybe creates task).

This is a UI-level workaround for the server-side split-brain documented in Batch 4. Each request is independent — if the second one fails, the first one already landed and the engagement case is left stale. There is no transactional contract.

The future canonical service makes this dual-write redundant: the server will do both side-effect sets atomically (or at least in a single request boundary) behind the engagement delegation flag.

## 4. Which endpoints each surface calls

(Endpoint inventory pulled from `grep -rn` results.)

- **Read endpoints used by UI:**
  - `/api/portal/outreach-call-list` — Team Portal + Portal shells.
  - `/api/outreach/calls/today` + `/api/outreach/calls/by-patients` — outreach hooks for log views.
  - `/api/portal/calls` — Batch I flag-gated read (not yet adopted by UI components on disk).

- **Write endpoints used by UI:**
  - `POST /api/outreach/calls` — DispositionSheet + outreach hook.
  - `POST /api/engagement-center/call-result` — DispositionSheet + CanonicalRowActions.

## 5. Which labels are misleading

- The word **"Outreach"** appears as a top-level concept in `client/src/components/outreach/*` even though product-wise it is a sub-workflow inside Engagement Center.
- DispositionSheet and CanonicalRowActions live under `components/outreach/` even though CanonicalRowActions writes engagement-center call-results.
- Team Portal shells query keys named `["/api/portal/outreach-call-list", facility]` — the "outreach" in the key name suggests a standalone product brain.
- The terms **"scheduler"** and **"Scheduler"** appear in UI strings and route paths despite the product role being **Team Member / PCS / ACS**. (See `team-member-assignment-terminology-contract.md`.)

## 6. Whether UI needs to change for strong architecture

Yes, but **only after the server-side delegation lands**. The order is:
1. Server: ship engagement delegation behind default-OFF flag (Batch 12).
2. Server: ship outreach delegation behind default-OFF flag (Batch 19).
3. Verify byte-equivalent responses under both flags in staging.
4. UI: collapse the DispositionSheet dual-write to a single canonical POST.
5. UI: rename the `components/outreach/*` directory to `components/engagement/*` (or similar) once the server endpoints are fully unified.
6. UI: rename label "Outreach" → "Engagement Center" surface-by-surface.
7. UI: remove the legacy "Scheduler" portal label.

## 7. Proposed UI changes

- **Step A (safe now):** none — UI changes are blocked on server-side delegation. The dormant scanner (Batch 3) and the response-shape fixtures (Batches 8 + 15) protect what comes next.
- **Step B (after Batch 12):** collapse DispositionSheet's two POSTs into one canonical POST to whichever endpoint is the canonical surface. The dormant `recordCallResult` planner already covers both side-effect envelopes.
- **Step C (after Batch 19):** rename `components/outreach/*` → `components/engagement-center/*`. Update query keys to drop the `outreach-call-list` literal.
- **Step D (Ali-approved, staged):** rename "Scheduler" → "Team Member / PCS / ACS" in UI strings; rename `/scheduler-portal` page route.

## 8. What can change safely (this run)

Nothing in the UI. The audit is information-only. The scanner adopted in Batch 3 prevents NEW UI-level dual-writes from being added without notice.

## 9. What Ali must approve

- Any actual edit to `DispositionSheet.tsx`, `CanonicalRowActions.tsx`, `TeamPortalShell.tsx`, `PortalShell.tsx`, or the outreach hooks file.
- Any directory rename under `client/src/components/`.
- Any query-key string rename in `client/src/hooks/api/keys.ts` or `scheduleInvalidations.ts`.
- Any UI-string label change touching "Scheduler" / "Outreach".

## 10. Plexus IQ

Untouched. Plexus IQ surfaces are independent of the call-list / disposition UI flow.

End of UI wiring audit.
