# Team Portal Left Tools Rail

**Status:** Phase 1.6 — Team Portal Operating Layer.
**Branch:** `fix/team-portal-left-tools-rail`
**Base:** `main` at `cabbaa7` (PR #280 merged).
**Premium UI PR #278:** untouched.

This document records the shared PCS/ACS left tools rail design + the
underlying tool wiring.

---

## 1. Before vs after

### 1.1 Before (`main` at `cabbaa7`)

The left rail in `TeamPortalShell.tsx` contained:

1. A row of 4 quick-action icons (My Patients · Patient Search · Plexus Tasks · Marketing).
2. **`PatientMiniCalendar`** — a patient-centric mini calendar that switched its header to the active patient when one was selected.
3. **`Documents / Upload`** card — a patient-specific upload affordance (`LeftRailUpload`) gated on a selected patient.
4. **`Outreach call list`** card — a list of outreach candidates (right-rail territory).
5. **`My tasks`** card — inline render of urgent + open tasks with click handlers that switched the center mode.

Issues with the prior rail:

- Patient-centric calendar conflicts with the "left rail = general tools" rule.
- `Documents / Upload` is a patient-specific surface, not a general tool.
- `Outreach call list` belongs to the right rail (the assigned work queue).
- `My tasks` was a duplicate of the center-canvas tasks tab.
- No Email tool, no Templates / Staff Resources tool, no Compact Global Calendar that wasn't patient-centric.

### 1.2 After (this PR)

The left rail is now a **shared general tools rail**:

| Slot | Tool | Surface | Source-of-truth backend |
|---|---|---|---|
| 1 | **Calendar** | Promotes to center canvas via the existing `centerMode = "playground"` pipeline | n/a (date state) |
| 2 | **Email** | Opens `PortalEmailComposerTab` in center canvas | `POST /api/outreach/send-email`, `POST /api/outreach/send-material` |
| 3 | **Marketing** | Opens `PortalMarketingTab` in center canvas | `GET /api/outreach/materials` (canonical) |
| 4 | **Patient Search** | Opens `PortalPatientSearchTab` in center canvas | `GET /api/portal/patient-search` (canonical) |
| 5 | **Tasks** | Opens `PortalPlexusTasksTab` in center canvas | `GET /api/portal/my-tasks` |
| 6 | **Templates** | Opens `PortalTemplatesResourcesTab` in center canvas | `STAFF_RESOURCES` (in-code catalog) |

Below the tools grid the rail also renders the **`LeftRailCompactCalendar`** — a small fitted month grid that is NOT patient-centric. Clicking a date updates the workspace's selected date (right rail + center canvas react). Clicking the month header promotes the calendar to the center canvas / playground.

Removed from the rail:

- `PatientMiniCalendar` (patient-centric — replaced by the compact general calendar)
- `Documents / Upload` patient card (patient-specific — patient detail lives in the center canvas)
- `Outreach call list` card (right rail owns the queue)
- Inline `My tasks` render (replaced by the single Tasks tool button)
- The 4 quick-action chips (replaced by the unified 6-tool grid)

---

## 2. Files changed

### New
- `client/src/components/portal/leftRail/LeftRailToolsButton.tsx` — reusable vertical icon-button.
- `client/src/components/portal/leftRail/LeftRailCompactCalendar.tsx` — small fitted general calendar.
- `client/src/components/portal/PortalEmailComposerTab.tsx` — center-canvas Email Composer.
- `client/src/components/portal/PortalTemplatesResourcesTab.tsx` — center-canvas Templates / Staff Resources.
- `client/src/lib/portal/staffResources.ts` — staff-facing catalog (NOT patient-facing brochures).

### Modified
- `client/src/components/portal/TeamPortalShell.tsx` — left-rail body replaced with the 6-tool grid + compact calendar. New `email` + `resources` `PortalTabKind` values + center-canvas render branches. New `pendingEmailAttachments` + `pendingEmailTemplate` state for the marketing/templates → email composer handoffs.
- `client/src/components/portal/PortalMarketingTab.tsx` — adds the `onComposeEmailWithMaterials` handoff button.
- `client/src/lib/portal/commandCenterApi.ts` — adds `sendOutreachEmail({ patientScreeningId, to, subject, body })`.

### Not modified (deliberate)
- All Phase 1 server routes (`portal.ts`, `globalSchedule.ts`, `executionCases.ts`, `email.ts`) — wiring stays as-is.
- The Slice 1.4 canonical call-result writeback default — preserved.
- The Slice 1.5 single-source Patient Directory route — preserved.
- The Slice 1.6 HTN ↛ Lower Extremity Venous Duplex rule — preserved.
- Admin view-as selector + Admin Home dock button — preserved.
- The right rail / work queue — untouched.
- PCS/ACS portal page files (`patient-care-specialist-portal.tsx`, `ancillary-care-specialist-portal.tsx`) — untouched; both still mount `ClinicWorkflowPortal`, which routes both team-member roles to the same `TeamPortalShell`.

---

## 3. Calendar behavior

- **Compact view (left rail):** `LeftRailCompactCalendar` shows a single-month grid with today + selected-date highlights and prev/next month nav.
- **Date selection:** updates the workspace's `selectedDate` state (the right rail's schedule/queue and the center canvas react).
- **Promotion to center canvas:** clicking the month header (or the Calendar tool button) sets `centerMode = "playground"` + `centerTitle = "Calendar — <date>"`. The existing playground / `PatientMiniCalendar` / `SchedulePatientPlayground` machinery handles the expanded view.
- **NOT** a scheduler portal. NOT a separate calendar route.

---

## 4. Marketing materials source

**Canonical source (single):**

- Server: `server/services/marketingMaterials.ts` → `MARKETING_MATERIALS` catalog.
- Server route: `GET /api/outreach/materials` (proxied through `server/routes/email.ts`).
- Client helper: `fetchMarketingMaterials()` in `client/src/lib/portal/commandCenterApi.ts`.
- Consumers (in this PR): `PortalMarketingTab.tsx` AND `PortalEmailComposerTab.tsx` both call `fetchMarketingMaterials()` — they share the same cached `["portal-marketing-materials"]` React-Query key.

**Marketing materials are NOT duplicated** anywhere else. The QA scripts forbid hardcoded marketing catalogs in the client tree.

---

## 5. Email backend status

| Aspect | State |
|---|---|
| Routes (`POST /api/outreach/send-email`, `POST /api/outreach/send-material`) | **Live** (committed) |
| Implementation (`server/services/emailService.ts`) | **Live** (nodemailer) |
| Activation | **Requires SMTP env**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| Without SMTP env | Backend throws `Email is not configured...`; the route returns 502 with the error |
| Composer behavior on 502 | Surfaces the literal error in a red inline panel (`data-testid="portal-email-composer-error"`); does NOT show a fake "sent" state |

This is **Live** with **Requires Activation** semantics, NOT scaffold. Once SMTP is provisioned, the composer sends — no further code change required.

### 5.1 Send modes

| Operator state | Endpoint used | Notes |
|---|---|---|
| Composer body + subject, 0 attachments | `POST /api/outreach/send-email` | Operator-authored subject + body |
| 1+ marketing materials attached | `POST /api/outreach/send-material` per material | Backend generates a canonical subject + body per material and attaches the file. The composer's subject + body fields are disabled when materials are attached. |

---

## 6. Patient search source

- Route: `GET /api/portal/patient-search` (existing, canonical).
- Backend: filtered by user's profile facilities.
- Client helper: `searchPatients` in `commandCenterApi.ts`.
- Center-canvas tab: `PortalPatientSearchTab` (existing component, unchanged).
- Selecting a row opens the patient in the center canvas via `openPatientTabById`.

---

## 7. Tasks source

- Route: `GET /api/portal/my-tasks` (existing).
- Center-canvas tab: `PortalPlexusTasksTab` (existing, unchanged).
- The left-rail Tasks button shows a live unread/urgent count badge sourced from the shell's existing `tasksData` query.

---

## 8. Templates / Resources source

- **Catalog file:** `client/src/lib/portal/staffResources.ts` — `STAFF_RESOURCES` array of `{ id, kind, title, description, body }`.
- **Kinds:** `email-template`, `call-script`, `prep-language`, `sop`, `faq`.
- **Backend:** none — this is staff-facing in-code content. No new tables. No fake API.
- **Reasoning:** staff resources (email templates, call scripts, internal SOP, FAQ) change rarely and are version-controlled with the source. Patient-facing brochures live in `MARKETING_MATERIALS` server-side because they involve filename / contentType / attachment payload concerns.
- **Insert into composer:** `email-template` items expose an "Insert into composer" button that hands `{ subject, body }` to the Email Composer via the shell's `pendingEmailTemplate` bridge. Non-template kinds are read-only with a Copy button.

---

## 9. PCS/ACS shared layout proof

| Evidence | File |
|---|---|
| PCS page: `<ClinicWorkflowPortal role="patientCareSpecialist" />` | `client/src/pages/patient-care-specialist-portal.tsx` |
| ACS page: `<ClinicWorkflowPortal role="ancillaryCareSpecialist" />` | `client/src/pages/ancillary-care-specialist-portal.tsx` |
| Both team-member roles route through the same `TeamPortalShell` | `client/src/components/workflow/ClinicWorkflowPortal.tsx` |
| Left rail testids carry NO workspace-type variants (no `left-rail-pcs-*` or `left-rail-acs-*`) | `client/src/components/portal/TeamPortalShell.tsx` |
| No `PCSShell.tsx` / `ACSShell.tsx` / `AncillaryCareSpecialistShell.tsx` / `PatientCareSpecialistShell.tsx` exists | `client/src/components/portal/` |

Enforced by `scripts/qa-team-portals-identical-pcs-acs-layout.mjs`.

---

## 10. What remains for Phase 2+

Quality-of-life follow-ups that are NOT blocking the operating layer:

- **Text/SMS send.** Disabled button in Marketing tab labeled `"Text/SMS · not wired yet"`. Phase 4 or later (paired with a real SMS gateway).
- **Inline communication-log surfacing.** Today, `logPatientCommunication` is available client-side but not auto-called after a composer send. Phase 2 should hook it into the composer's `onSuccess` so the timeline reflects the send without manual entry.
- **Attachment count display in the tools rail.** The Email tool button could show a badge if `pendingEmailAttachments` has entries. Cosmetic.
- **Drive-backed marketing materials.** The `MARKETING_MATERIALS` catalog is in-code today; a future iteration could pull from Document Library / Drive with a marketing-kind filter. Out of scope.
- **Resource search.** `PortalTemplatesResourcesTab` doesn't yet support full-text search across resources. Phase 2 polish.
- **Tasks tool icon as the only `Bell`-style alerter.** The dock still includes a Bell icon for tasks; the dock and the left rail expose the same surface twice. A future cleanup could collapse one of them.

---

## 11. QA scripts (11 added)

| Script | Purpose |
|---|---|
| `qa-team-portal-left-panel-tools-rail.mjs` | All 6 tool buttons rendered + marker comment present |
| `qa-team-portal-left-panel-calendar.mjs` | `LeftRailCompactCalendar` exists + is mounted by the shell |
| `qa-team-portal-marketing-materials-source.mjs` | Marketing materials come from `/api/outreach/materials` only (no duplicate client catalog) |
| `qa-team-portal-email-composer-canvas.mjs` | `PortalEmailComposerTab` exists, is mounted via the `email` tab, uses the canonical send route, surfaces SMTP-not-configured errors |
| `qa-team-portal-marketing-email-attachment-flow.mjs` | Marketing → Email Composer handoff plumbed end-to-end |
| `qa-team-portal-patient-search-directory.mjs` | Patient Search wired to `/api/portal/patient-search` |
| `qa-team-portal-tasks-tool.mjs` | Tasks tool wired to `PortalPlexusTasksTab` |
| `qa-team-portal-templates-resources-tool.mjs` | Templates / Resources tab + `STAFF_RESOURCES` catalog separate from `MARKETING_MATERIALS` |
| `qa-team-portal-left-panel-no-patient-timeline.mjs` | Left rail does NOT contain patient timeline / detail / Admin Review surfaces |
| `qa-team-portal-left-panel-no-execution-metrics.mjs` | Left rail does NOT contain Mission Control / dashboards / outreach queue |
| `qa-team-portals-identical-pcs-acs-layout.mjs` | PCS and ACS use the same shell with no per-workspace shells |

## 12. Smoke script (1 added)

- `scripts/smoke-team-portal-left-tools-rail.mjs` — 14 stages covering the entire contract; STAGE 13 re-runs `smoke-phase-1-full-system-wiring.mjs` to ensure nothing regressed.

---

## 13. Validation summary

| Gate | Result |
|---|---|
| `npm run check` | clean |
| `npm run build` | clean |
| QA gauntlet | **250 scripts, 0 failed** (11 new + 239 pre-existing) |
| Smoke gauntlet | **8 / 8 PASS** (incl. the new `smoke-team-portal-left-tools-rail.mjs` and the Phase 1 wiring + view-as smokes) |
