# Team Portal Left Tools Rail

**Status:** Phase 1.7 — Team Portal Operating Layer completion.
**Working branch:** `fix/team-portal-left-tools-complete`
**Latest base:** `main` at `e303707` (PR #281 merged).
**Premium UI PR #278:** untouched.

This document records the shared PCS/ACS left tools rail design + the
underlying tool wiring. It was first written in PR #281 (Phase 1.6) and
extended in Phase 1.7 with: Global Calendar isolation, Document Library
tool, honest-state guarantees on email send, right-queue-safety proofs
for the other tools, and explicit Deferred decisions for Quick Note +
Internal Contacts.

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

---

# Phase 1.7 addenda

The sections below extend the Phase 1.6 doc above with the Phase 1.7
work. The Phase 1.6 design is the foundation; Phase 1.7 makes the rail
operating-layer-complete so visual / premium-UI work can resume.

## 1.7-A — Final left rail tools

The rail now ships **7 tools** in this canonical order:

| Order | Tool | Tab kind | Center-canvas component |
|---|---|---|---|
| 1 | **Calendar** (button) | promotes via `centerMode="playground"` | reuses the existing playground |
| 2 | **Email** | `email` | `PortalEmailComposerTab` |
| 3 | **Marketing** | `marketing` | `PortalMarketingTab` |
| 4 | **Documents** (NEW in 1.7) | `documentLibrary` | `PortalDocumentLibraryTab` |
| 5 | **Patient Search** | `patientSearch` | `PortalPatientSearchTab` |
| 6 | **Tasks** | `plexusTasks` | `PortalPlexusTasksTab` |
| 7 | **Templates** | `resources` | `PortalTemplatesResourcesTab` |

Below the icon grid the rail still renders `LeftRailCompactCalendar`
(see §1.7-B for the isolation guarantee).

Quick Note and Internal Contacts are **NOT** added — see §1.7-H and
§1.7-I for the deferred-decision rationale.

## 1.7-B — Global Calendar isolation

**Before (PR #281):** the `LeftRailCompactCalendar` bound directly to
the shell's `selectedDate` state. That same state keys the right-rail
feed queries:

- `["team-workspace-call-list", role, facility, selectedDate, viewAs]`
- `["team-workspace-clinic-schedule", facility, selectedDate, viewAs]`
- `["team-workspace-ancillary-schedule", facility, selectedDate, viewAs]`

So clicking a date in the left calendar refetched the right-rail
assigned-work queue. That violates the "left rail is general tools" rule.

**Now (Phase 1.7):** the shell holds a separate `globalCalendarDate`
state. The compact calendar binds to it; the right-rail feed queries
stay on `selectedDate`. The expand-to-canvas handler uses
`globalCalendarDate` for the title so the center playground reflects
the user's left-calendar selection without ever touching the queue.

| Surface | Date state used |
|---|---|
| `LeftRailCompactCalendar` | `globalCalendarDate` |
| "Calendar" left-rail tool button (expand to canvas) | `globalCalendarDate` |
| Center playground calendar / scheduling context (existing flows) | `selectedDate` (unchanged) |
| Right-rail call list / clinic schedule / ancillary schedule | `selectedDate` (unchanged) |
| `/api/portal/today-schedule` query | `selectedDate` (unchanged) |
| Admin view-as queries | `selectedDate` (unchanged) |

Enforced by `scripts/qa-team-portal-global-calendar-isolated.mjs` and
`scripts/qa-team-portal-left-calendar-does-not-touch-right-queue.mjs`.

## 1.7-C — Document Library vs Marketing Materials

The two surfaces are **fully separate** at every layer.

| Aspect | Marketing Materials | Document Library |
|---|---|---|
| Backend | `server/services/marketingMaterials.ts` | `server/routes/documentLibrary.ts` |
| API | `GET /api/outreach/materials` | `GET /api/documents-library` (+ versions, meta) |
| Client helper | `fetchMarketingMaterials` | `useDocumentLibrary` hook |
| Tab component | `PortalMarketingTab` | `PortalDocumentLibraryTab` |
| Audience | **Patient-facing brochures** (sent to patients via email) | **Internal / shared documents** (forms, reports, templates) |
| Surface in this PR | Marketing tool + Email Composer attach picker | Documents tool (read-only browse) |

The Document Library tool is **read-only** — upload / supersede /
delete remain in the admin `/document-library` page. The tool reuses
the canonical `useDocumentLibrary` hook so any future filter / meta
additions automatically reflect here.

Enforced by `scripts/qa-team-portal-marketing-vs-document-library-boundary.mjs`
and `scripts/qa-team-portal-document-library-tool.mjs`.

## 1.7-D — Email + Marketing attachment workflow (final)

The workflow already shipped in PR #281 is unchanged in 1.7:

1. Right-panel patient row → opens patient in center canvas.
2. Operator opens Marketing tool from the left rail.
3. Operator selects a brochure → "Compose email with selected material".
4. Shell stages the material id in `pendingEmailAttachments` and
   switches the active tab to `email`.
5. `PortalEmailComposerTab` adopts the staged ids on mount via an
   `useEffect`.
6. Active patient's email pre-fills the To field.
7. Operator can edit the To field; subject + body are auto-generated by
   the per-material send route when materials are attached.
8. Send → `POST /api/outreach/send-material` per attached material.

**Honest send state (Phase 1.7 verification):**

- Backend requires `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` /
  `SMTP_FROM`. Without those `sendOutreachEmail()` throws
  `"Email is not configured. Set SMTP_HOST..."`.
- The route returns the error message with a 5xx status.
- The composer surfaces the literal backend error in the inline error
  panel (`data-testid="portal-email-composer-error"`).
- There is NO mock / random / setTimeout success path inside the
  composer — `qa-team-portal-email-honest-send-state.mjs` enforces this
  by forbidding the relevant tokens.

**Communication logging:** `logPatientCommunication` is available
client-side (in `commandCenterApi.ts`) but not yet auto-called after a
composer send. This is a documented Phase-2 follow-up — wiring the
composer's `onSuccess` to log a communication event so it lands in the
patient timeline / history surface.

## 1.7-E — Patient Search behavior (final)

The Patient Search tool stays a **general utility** with explicit
right-queue safety:

- Opens in the center canvas via the `patientSearch` tab.
- Searches via the canonical `searchPatients` helper →
  `GET /api/portal/patient-search`.
- Selecting a row calls `openPatientTabById` (opens the patient in the
  center canvas).
- Does **not** mutate `selectedDate`, `facility`,
  `activeWorkspaceMode`, or `viewAsTeamMemberId` — the right-rail queue
  is untouched.

Enforced by `scripts/qa-team-portal-patient-search-does-not-change-right-queue.mjs`.

## 1.7-F — Tasks behavior (final)

The Tasks tool stays **task management**, not a productivity dashboard:

- Opens in the center canvas via the existing `plexusTasks` tab.
- Reads from `/api/portal/my-tasks`.
- Live unread / urgent count badge sourced from the shell's existing
  `tasksData` query.
- Forbidden: KPIs, leaderboards, SLA trackers, revenue / conversion
  metrics, Mission Control surfacing. Enforced by
  `scripts/qa-team-portal-tasks-not-productivity-dashboard.mjs`.

## 1.7-G — Templates / Staff Resources behavior (final)

- Opens in the center canvas via the `resources` tab.
- Pulls from the in-code `STAFF_RESOURCES` catalog.
- "Insert into composer" button appears only on `email-template` items
  and hands `{ subject, body }` to the Email Composer via the shell's
  `pendingEmailTemplate` bridge. Non-template kinds (call scripts, prep
  language, SOP, FAQ) are read-only with a Copy button.

Enforced by `scripts/qa-team-portal-templates-insert-email-composer.mjs`.

## 1.7-H — Quick Note decision: **Deferred**

**Backend audit:** `server/routes/generatedNotes.ts` exposes
`generated-notes`, `generated-notes/service`, `generated-notes/batch`,
`procedure-notes`. All are domain-specific (qualification notes,
procedure-side notes, batch notes). There is **no general patient
"quick note" writer** — no `patient_notes` table, no general note
journal route.

**Decision:** Quick Note is **deferred to Phase 2**. Adding a tool
button now would force one of:
- Repurpose `generated_notes` for the wrong domain (bad — pollutes
  AI-generated qualification notes with operator scratchpad text).
- Write to `patient_journey_events` directly (bad — that table is the
  Slice 1.3 audit trail and is append-only via canonical helpers).
- Fabricate a write surface that returns "ok" without persisting (bad
  — fakes a working state).

Phase 2 acceptance criteria: a `patient_notes` table or canonical
note-writer service + a Quick Note tool + a `qa-team-portal-quick-note-tool.mjs`
QA. Until those exist, the rail does not show a Quick Note button.

Enforced by `scripts/qa-team-portal-quick-note-deferred-doc.mjs`.

## 1.7-I — Internal Contacts decision: **Deferred**

**Backend audit:** the closest existing structured contact data is
`outreach_schedulers` (one row per scheduler with `userId` + `facility`).
There is **no canonical clinic-phone, physician-contact, vendor,
escalation, or facility-contact table**.

**Decision:** Internal Contacts / Clinic Directory is **deferred to
Phase 2**. Adding the tool now would either:

- Show only outreach schedulers, which is a misleading partial view of
  "contacts" (operators expect phones, facility numbers, physician
  on-call, etc.).
- Hardcode contact data into the client tree, which is the antithesis
  of a directory tool.

Phase 2 acceptance criteria: a `contacts` table (or sufficiently rich
clinic-config / facility schema) + the tool component + the QA
`qa-team-portal-internal-contacts-tool.mjs`. Until then, the rail does
not show a Contacts button.

Enforced by `scripts/qa-team-portal-contacts-deferred-doc.mjs`.

## 1.7-J — What must stay out of the left rail

Re-stated for clarity. The Phase 1.7 boundary QA forbids any of these
inside the rail region (between `data-testid="left-rail-tools-rail"`
and the end of the rail IIFE):

- Patient timeline / detail / Patient Directory profile drawer
- Call result history surface
- Admin Review history / Admin Review dialog
- Prior ancillary detail / DNC / cooldown detail page
- The right-rail work queue (outreach call list rows)
- Marketing metrics / outreach campaign dashboards
- Revenue / productivity / financial / operational analytics
- Mission Control

Enforced by `scripts/qa-team-portal-left-panel-no-patient-timeline.mjs`,
`scripts/qa-team-portal-left-panel-no-execution-metrics.mjs`, and
`scripts/qa-team-portal-right-panel-remains-work-queue.mjs`.

## 1.7-K — PCS / ACS identical layout proof

Phase 1.7 changes are all inside the shared `TeamPortalShell`. PCS and
ACS continue to mount `ClinicWorkflowPortal` with only the role prop
differing. There is no PCS-only or ACS-only shell, page, or layout.

Enforced by `scripts/qa-team-portals-identical-pcs-acs-layout.mjs`
(unchanged from PR #281).

## 1.7-L — QA results (Phase 1.7)

11 new Phase 1.7 QA scripts added:

| Script | Purpose |
|---|---|
| `qa-team-portal-global-calendar-isolated.mjs` | `globalCalendarDate` state present + right-rail keys do not include it |
| `qa-team-portal-left-calendar-does-not-touch-right-queue.mjs` | `LeftRailCompactCalendar` usage does not call `setSelectedDate` / `setFacility` / `setActiveWorkspaceMode` |
| `qa-team-portal-document-library-tool.mjs` | Document Library tab uses `useDocumentLibrary` + `/api/documents-library`; left-rail button + center-canvas branch wired |
| `qa-team-portal-marketing-vs-document-library-boundary.mjs` | Marketing tab does not pull `/api/documents-library`; Document Library tab does not pull `/api/outreach/*` |
| `qa-team-portal-email-honest-send-state.mjs` | Composer has no fake-send path; SMTP env required by backend; surfaces literal backend error |
| `qa-team-portal-patient-search-does-not-change-right-queue.mjs` | Patient Search render branch does not mutate queue state |
| `qa-team-portal-tasks-not-productivity-dashboard.mjs` | Tasks tab has no KPI / leaderboard / SLA / Mission Control markers |
| `qa-team-portal-templates-insert-email-composer.mjs` | Templates insert-into-composer handoff plumbed end-to-end |
| `qa-team-portal-quick-note-deferred-doc.mjs` | No Quick Note button + audit doc labels Deferred |
| `qa-team-portal-contacts-deferred-doc.mjs` | No Contacts button + audit doc labels Deferred |
| `qa-team-portal-right-panel-remains-work-queue.mjs` | Right-rail region does not mount left-rail tool components |

## 1.7-M — Smoke results (Phase 1.7)

The `smoke-team-portal-left-tools-rail.mjs` smoke is extended to cover:

- Global Calendar isolation (`globalCalendarDate` exists, calendar
  uses it, right-rail keys do not include it).
- Document Library tool wired into the center canvas via the
  `documentLibrary` tab kind.
- Honest-send-state guarantees in the composer.
- Right-panel-remains-work-queue assertion.
- Quick Note + Internal Contacts honest Deferred labels in the doc.

STAGE 13 still re-runs `smoke-phase-1-full-system-wiring.mjs` so any
regression in Phase 1 wiring trips the smoke. DB-only probes still
skip honestly.

## 1.7-N — What remains for Phase 2

Phase 1.7 closes the operating layer. Phase 2 follow-ups:

- **Wire `logPatientCommunication`** into the Email Composer's
  `onSuccess` so sent emails land in the patient timeline / history
  surface without a manual log step.
- **Quick Note** — canonical `patient_notes` writer + tool.
- **Internal Contacts** — canonical contacts schema + tool.
- **Drive-backed marketing materials** — replace the in-code catalog
  with a Drive-folder-backed listing once the Document Library
  marketing-kind filter is reliable.
- **Communication-log surfacing inside Patient Directory** — so
  admins can search by "patient who received the BrainWave brochure
  in the last 30 days".
- **Tasks tool quick filters** — per-status, per-priority filters.
- **Text / SMS send** — replace the disabled "Text/SMS · not wired yet"
  button once an SMS gateway is canonical.

These items are explicitly **out of scope** for this PR — no fake
buttons, no scaffolding-only surfaces.
