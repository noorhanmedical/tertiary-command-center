---
name: Portal call-list Playground tabs
description: Durable rules for the TeamPortalShell tabbed call workflow (Call/Schedule/Case) and its honesty/z-index constraints.
---

- Each call-row icon opens/focuses its own Playground tab in `TeamPortalShell`; multiple stay open. Tab identity must be deduped so re-clicking focuses the existing tab rather than stacking duplicates. Focusing any tab clears the legacy `schedulePatientPlaygroundContext`.
- New tab kinds carry a `CallCaseContext` (built by `callRowToCaseContext`). `sourcePortal` must map to explicit ACS/PCS via `workspaceCallListContext`, never raw uppercased role (which produced labels like PATIENTCARESPECIALIST).

**RingCentral is dormant** — its provider `startCall` returns a synthetic session whose `callId` contains `"pending"`.
- **Why:** presenting that as a live call would fabricate a placed call.
- **How to apply:** gate the dialer on `isRingCentralClickToCallEnabled()` (VITE flag) AND, after `startCall`, treat `!callId || callId.includes("pending")` as unwired → show the honest "RingCentral connection required" boundary and never set `callSession`. Disposition is always logged via the canonical `DispositionSheet` (posts `/api/engagement-center/call-result`), never reimplemented.

**Overlay z-index:** the portal root is `z-[80]`; any Sheet/Popover/Select/Dropdown opened from inside it must be `z-[90]+` or it renders behind. `DispositionSheet`'s `SheetContent` is pinned to `z-[95]` (shared `Sheet` primitive defaults to `z-50`). When raising a Sheet, the content layer is what matters for interaction; the scrim overlay layering is secondary.

- No new source of truth: reads use `["portal-command-center", screeningId]` + `useCaseProofDocs` (proof PDFs from `/api/documents-library`, returns null when missing — no fake PDFs); scheduling writes only through `schedulePatientAncillary` then `invalidateTeamPortalScheduleQueries`.
