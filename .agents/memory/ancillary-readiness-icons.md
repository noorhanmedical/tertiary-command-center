---
name: Ancillary doc-readiness icons + billing gate
description: How the ACS appointment-card readiness indicators and the billing READINESS_GATE are wired.
---

# Ancillary document-readiness (ACS appointment cards)

Three readiness items per ancillary appointment, persisted in `case_document_readiness` (documentType column is free text):
- `informed_consent` — every patient
- `screening_form` — BrainWave/VitalWave only
- `brainwave_pdf` — BrainWave only (a NEW documentType string; NOT in REQUIRED_DOC_RULES, so it never affects the existing billingReadiness engine)

**Where things live**
- Summary builder + per-service requirement flags + the billing-gate evaluator: `server/services/ancillary/ancillaryReadinessSummary.ts`. Requirement split keys off `getAncillaryCategory()` (`@shared/ancillaryCategory`).
- The ACS ancillary schedule feed is `GET /api/technician-liaison/ancillary-schedule` (in `server/routes/globalSchedule.ts`), NOT any `/api/portal/...` path. It enriches each row with a `readiness` summary.
- Mark/upload writers: `server/routes/portalCaseReadiness.ts` → `POST /api/portal/case-readiness/:executionCaseId/mark` and `/upload-brainwave-pdf`. BrainWave bytes use `blobStore` ownerType `brainwave_result`.
- Card UI: `client/src/components/portal/AncillaryReadinessRow.tsx`, rendered inside the `activeWorkspaceMode === "ancillarySchedule"` card in `TeamPortalShell.tsx`. PDF preview iframes `/api/documents-library/:id/file?disposition=inline` (canonical doc-library path).

**Complete-status set** (any of these = done): complete, completed, uploaded, approved, generated.

**Billing gate** — `evaluateCaseReadinessGate()` is called in `server/routes/billing.ts`:
- `POST /api/billing-records` when `patientId` present.
- `PATCH /api/billing-records/:id` only when `billingStatus` transitions to a submitted-ish state (Submitted/Accepted/Pending/Denied/Rejected — NOT "Not Billed").
- Returns 400 `{ error: "Document readiness incomplete", code: "READINESS_GATE", missing }`.

**Why scoped this way:** the lazy GET auto-create scan in `billingRecordsService` is intentionally NOT gated (it pre-populates the worklist and gating it would break the billing page). The gate also no-ops when no execution case is resolvable, so non-ancillary/manual rows still work.

## Doc workflows live in the Playground, NOT on the schedule row
- **The ACS ancillary schedule row stays clean** — patient name, a status badge, and the procedure-complete action. NO per-row doc button bar (an earlier 5-button row bar / `AncillaryActionBar.tsx` was deleted per user request — do NOT re-add it). **The WHOLE row/bar is clickable** (role=button + Enter/Space) to open the Playground, not just the name; the procedure-complete container `stopPropagation`s so it doesn't also open the row. **Why:** user expects clicking anywhere on the bar to open it, not hunting for the highlighted name.
- **This surface has been redesigned MULTIPLE times; the user explicitly rejected, in order: (1) the per-row action bar, (2) a tile-heavy Playground (gradient `DocStatusTile`/`ActionTile`/`AncillaryDocCard` cards, two-pane grid), and (3) a large embedded calendar dominating the view.** Do NOT reintroduce any of these. **Why:** repeated "stop cramming into tiles", "the calendar shouldn't be the first thing", "make it simple".
- **Current canonical Playground design (`SchedulePatientPlayground.tsx`):** one compact header (avatar + name + meta line + a single "Schedule appointment" button + close X), then ONE natural vertical scroll region (`min-h-0 flex-1 overflow-y-auto`) — NO nested tiny fixed-scroll panes, NO tile grid. Each ancillary is a plain `<section>`: test name + `done/3` chip + optional "Chart" link, then three plain full-width `DocButton`s (Consent · Screening · Report), green when complete, highlighted when open. Clicking a DocButton toggles an inline panel that renders the workflow **directly underneath** (`expandedDoc {instanceId, kind}` state) — NOT a popup, NO "Ancillary Documents" title.
- **The calendar/booking form lives behind the "Schedule appointment" button in a Dialog (`scheduleOpen` state), z-[95].** It holds `CanonicalMonthCalendar` + time slots + multi-test chips + per-test date/time overrides + appt type/location/note + confirm. The calendar must NEVER be the always-visible main surface.
- **Doc workflow body is `AncillaryDocInline` (exported from `AncillaryDocModals.tsx`)** — the bare consent/screening/report form + all state/mutations, no dialog chrome. It renders both inline (Playground, under the button) and inside the `AncillaryDocModals` Dialog wrapper (which resolves the active ancillary + multi-ancillary selector then renders `AncillaryDocInline`). Keep pure exports `resolveOpenInstanceId`/`resolveActiveAncillary`/type `AncillaryServiceContext` stable — the unit test imports them.
- **Do NOT rely on callers passing `ancillaries` — the Playground self-fetches.** Many entry points open `SchedulePatientPlayground` WITHOUT the `ancillaries` prop (call list, patient roster, calendar quick-schedule), so the doc sections silently vanished for those users. The Playground fetches `fetchWorkspaceAncillarySchedule({facilityId, startDate/endDate = selectedDate day})` and filters to the patient (same `p:<id>` / `n:<name>|<facility>` key), using the caller-supplied prop only when non-empty. **How to apply:** when a Playground/portal panel depends on per-patient rows, derive them inside the component from the shared feed, treat any passed prop as an optional override, and gate the self-fetch `enabled` on the prop being empty.
- Secondary per-section actions kept minimal: a small "Chart" link (`navigate('/patient-directory?patientId=<screeningId>')`, canonical patient-chart route; only when `patientScreeningId != null`). EHR nav uses wouter `useLocation` (aliased around the local `location`/`setLocation` facility-state, which is unrelated to routing).
- The shared doc workflows: consent = pick a library template + SignaturePad OR upload; screening = preview the configured screening-form doc + upload; report = upload + fire the canonical `case-document-readiness/complete`. **Completed docs always land in the patient chart via the portal upload pipeline — never the Document Library, which holds blank templates only.**
- `AncillaryReadinessSummary` has a **display-only** `report` item: deliberately NOT added to `requirementsForService`, so the billing gate is unchanged. Its default status is `uploaded` (already in the complete-status set).
- **BrainWave report is a HARD dual-write:** the report upload must ALSO complete `brainwave_pdf`, because the billing gate keys off `brainwave_pdf`, not `documentType=report`. Do NOT swallow that call's failure — a chart-only report would leave BrainWave billing silently blocked. The `report` summary item also treats a complete `brainwave_pdf` as satisfying report.
- **Per-ancillary selection MUST key on a per-appointment instance id (the schedule/appointment row id), never on `serviceType`.** A patient can have repeat/return visits of the same test; deduping by serviceType collapses them and routes docs to the wrong execution case. Carry instance-level schedule metadata (start time · status) so two same-type appointments are distinguishable in the selector/cards.
- Patient-name click opens the scheduler Playground carrying the patient's sibling ancillaries as premium per-ancillary doc cards reusing the same modals. (Scheduling happens via the Playground booking form; there is no longer a per-row Calendar/Phone quick action — call access lives in the call-list workflow.)
- All modal/dialog content is `z-[95]` (+ Select `z-[96]`) because the Team Portal is a `z-[80]` overlay.
