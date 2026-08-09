# Phase 2L — Replit Reference Audit (Homepage + Dock/Navigation)

Status: **DISCOVERY / DOCUMENTATION-ONLY.** Read-only archaeology.
Author-context: Phase 2L UI discovery.
Working checkout: `phase/2l-ui-discovery` @ HEAD `08a78978` (== `phase/2k-enterprise-hardening`).

## Scope note

- This document is **pure read-only archaeology**. Nothing was checked out, merged, cherry-picked, restored, or copied from the reference branches. All inspection used `git show <branch>:<path>`, `git ls-tree`, and `git diff` only.
- **No "winner" homepage or dock variant is selected here.** Every distinct home/dock variant ends with `USER_DECISION_REQUIRED`. The user decides later.
- Visual/interaction design is kept **separate** from old route/functional binding. Where a reference depends on obsolete Replit APIs/data, it is marked `VISUAL_REFERENCE_ONLY — REBIND TO CURRENT CANONICAL DATA`.
- Old Replit functionality is **never** presented as current canonical truth.

## Reference branches

| Role | Branch | SHA | Presence |
|------|--------|-----|----------|
| PRIMARY (user likes its new home page + floating dock) | `plexus-iq-admin-review-persistence-fix` | `66f1c04b` | local + origin |
| SECONDARY (restoration reference) | `integration/restore-replit-ui-ux-canonical` | `7c875fe9` | local + origin |
| CURRENT CANONICAL (comparison baseline) | HEAD `08a78978` (== `phase/2k-enterprise-hardening`) | `08a78978` | current checkout |

## Critical archaeology finding (read before the catalog)

The homepage + floating-dock **code** on the PRIMARY branch is, at the file level, **already essentially identical to current canonical HEAD `08a78978`**. Verified byte-for-byte via `git diff`:

| File | HEAD vs PRIMARY |
|------|-----------------|
| `client/src/lib/navigation/navigationRegistry.ts` | **identical (0 diff)** |
| `client/src/components/navigation/GlobalFloatingDock.tsx` | **identical (0 diff)** |
| `client/src/pages/home.tsx` | **identical (0 diff)** |
| `client/src/components/HomeLiveDashboard.tsx` | **identical (0 diff)** |
| `client/src/components/HomeWorldClocks.tsx` | **identical (0 diff)** |
| `client/src/App.tsx` | **identical (0 diff)** |
| `client/src/pages/mission-control.tsx` | **identical (0 diff)** |
| `client/src/components/HomeDashboard.tsx` | **1 hunk diff** — HEAD adds `data-testid="home-dashboard"` on the root `<div>`; PRIMARY omits it. No visual/behavioral difference. |

Ancestry: PRIMARY (`66f1c04b`) is **NOT** an ancestor of HEAD; merge-base is `b2a90949`. The two lines diverged, but the home/dock surface converged to the same implementation.

**Implication for Phase 2L:** the "new front page/home direction + floating dock direction" the user likes is, as *shipped code*, already the canonical 2K home + dock. What the PRIMARY branch uniquely carries that HEAD does **not** is a large body of **homepage design-mockup screenshots** (37 in `attached_assets/screenshots/`, 14 `targeted_element_*`, 7 `image_*`) — these are *visual references only*, not wired-up alternate homepages in code. See DOC 3 (`PHASE_2L_VISUAL_EVIDENCE_INDEX.md`).

The SECONDARY branch (`integration/restore-replit-ui-ux-canonical`) is likewise identical to PRIMARY on all key home/dock files (`navigationRegistry.ts`, `GlobalFloatingDock.tsx`, `home.tsx`, `HomeDashboard.tsx`, `App.tsx` all 0-diff). It carries no additional wired homepage variant beyond the two coded ones below. Its notable code-level uniqueness is a server file `server/services/homeStats/homeStatsService.ts` (restoration reference), not a UI variant.

---

# HOMEPAGE REFERENCE CATALOG

Only **two distinct homepage variants exist as wired code** on the PRIMARY branch. Every other "home" concept found is a **static screenshot mockup** (catalogued in DOC 3, not as a coded REF-HOME). Both coded variants are reached through `client/src/App.tsx` routes and both are **production-real, live-data** surfaces (not mock playgrounds).

## REF-HOME-001 — Production Home (`HomeDashboard`)

- **File / component:** `plexus-iq-admin-review-persistence-fix:client/src/components/HomeDashboard.tsx` (exported `HomeDashboard`), rendered by `plexus-iq-admin-review-persistence-fix:client/src/pages/home.tsx` (default `Home`).
- **Route (that branch's `App.tsx`):** `/home` (also the app root: `/` → `Redirect to /home`; `/visit-patients` reuses `Home`). Guarded only by auth (`AppShell`); all roles land here.
- **Production vs preview vs playground:** **Production.** Live default landing page.
- **Screenshots:** No screenshot on the branch is confidently this exact live surface. The `attached_assets/screenshots/*Home*` set are *design explorations*, not captures of this component (see DOC 3). `attached_assets/screenshots/xmmqmqjp27_us-west-2_awsapprunner_com.png` is a deployed-app root capture and is the closest candidate (LOW confidence). USER_DECISION_REQUIRED on mapping.
- **Overall layout:** Centered single column. Outer `max-w-7xl mx-auto px-6 lg:px-10 pt-10 pb-16`, inner `max-w-5xl mx-auto`, vertical `space-y-6`.
- **Major regions (top → bottom):**
  1. Top-right action row: a single outline button **"Preview new home design"** (`Sparkles` icon) linking to `/home-preview` (→ REF-HOME-002).
  2. `<HomeLiveDashboard />` — live operational metric band.
  3. `<HomeWorldClocks />` — multi-timezone clock row.
  4. A responsive **tile grid** `grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 auto-rows-fr`.
  5. A full-width **Calendar** card (`CanonicalMonthCalendar`) with a black header + filter dropdown.
  6. Conditional **"Schedule History (N)"** button opening the sidebar, shown when `batches.length > 0`.
- **Tiles (exact set + routes — VISUAL/DESIGN vs BINDING kept separate):**
  - Row 1: **Mission Control** → `/mission-control` (`Radar`); **Patient EHR** → `/patient-directory` (`Users`); **Plexus IQ** → `/plexus-iq` (distinctive starfield/black-gradient card); **Outreach / Engagement Center** → `/engagement-center` (`Phone`).
  - Row 2: **Team Member Portals** → `/team-member-portals` (`Users2`); **Team Ops** → `/team-ops` (`Stethoscope`); **Plexus Tasks** → `/plexus-tasks` (`CheckSquare`).
  - Row 3: **Imaging Central** → `/imaging-central` (`ScanLine`, emerald accent); **Document Upload** → `/document-upload` (`Upload`); **Ancillary Documents** → `/ancillary-documents` (`FileText`).
  - Row 4: **Clinician Portal** (role-gated tile, admin/clinician only, `FileSignature`, red needs-signature badge) → `/clinician-portal`; **Clinic Onboarding** → `/clinic-onboarding` (`ClipboardCheck`); **Clinic Analytics** → `/clinic-analytics` (`BarChart3`).
- **Calendar:** `CanonicalMonthCalendar` from `@/calendar`, cells built by `buildCommandCalendarCells`. Header is solid **black** (`bg-black`) with a **Filter** dropdown (`DropdownMenu` + checkbox items) driven by `CALENDAR_FILTERS` (ids: `clinicVisits`, `qualifiedVisitPatients`, `ancillaryScheduled`, `dailyCallList`, `completedCalls`, `procedureCompleted`, `teamAvailability`). Day popover (`DayPopoverContent`) lists per-facility patient counts + ancillary dots + "View schedule →".
- **Live operational data:** Yes — `HomeLiveDashboard` (metric popovers over `useHomeStats`), the calendar (`/api/screening-batches/calendar-summary`, `/api/global-schedule-events?eventType=procedure_complete`), and `useScheduleDashboard` (`/api/schedule/dashboard`) wired in `home.tsx`. The Clinician Portal tile reads `/api/physician-portal/summary`.
- **Clocks:** `HomeWorldClocks` — default cities Manila, Dhaka, Arizona, Houston, Michigan; editable (add/remove/reorder) with `Intl.supportedValuesOf('timeZone')`.
- **Navigation:** `GlobalFloatingDock` (fixed) + `TopBanner`; `GlobalNav` sidebar rendered only on `/home` and `/clinician-portal` (`shouldShowGlobalNav`).
- **Visual density:** Airy, centered, generous padding; 122px-tall tiles.
- **Card/tile treatment:** `glass-tile glass-tile-interactive` (glassmorphism). Icons `w-9 h-9`, `text-indigo-900` (except Imaging Central emerald). Plexus IQ tile is the visual standout: `radial-gradient(ellipse_at_top_left, #1e1b4b, #000000, #0b0716)` with a starfield overlay and white text.
- **Background:** `bg-background`; content on glass tiles.
- **Typography:** Tile labels `text-[14px] font-semibold`; Plexus IQ eyebrow `uppercase tracking-[0.18em]`; calendar header `text-[18px] font-semibold`.
- **Motion/interaction:** Group-hover translate on Plexus IQ chevron; interactive glass hover; calendar filter dropdown; day popovers.
- **Distinctive visual elements:** Starfield Plexus IQ tile; solid-black calendar header; role-gated Clinician Portal tile with red badge.
- **Functional dependencies (APIs/data):** `/api/schedule/dashboard`, `/api/screening-batches/calendar-summary`, `/api/global-schedule-events`, `/api/physician-portal/summary`, `/api/home-stats` (via `HomeLiveDashboard`), `/api/auth/me`. **All of these are canonical 2K endpoints** — this variant is already bound to canonical data.
- **Has canonical 2K superseded its behavior?** No — it **is** canonical 2K behavior (0-diff except one `data-testid`).
- Flags: **SAFE_TO_REUSE_VISUALLY? YES.** **REQUIRES_FUNCTIONAL_REBINDING? NO** (already canonical). **HISTORICAL_ONLY? NO.**
- **USER_DECISION_REQUIRED** — whether this remains the homepage as-is, or whether one of the screenshot mockups (DOC 3) informs a redesign. No winner chosen.

## REF-HOME-002 — Preview Home (`HomeDashboardPreview`, "new home design")

- **File / component:** `plexus-iq-admin-review-persistence-fix:client/src/components/HomeDashboardPreview.tsx` (exported `HomeDashboardPreview`), rendered by `plexus-iq-admin-review-persistence-fix:client/src/pages/home-preview.tsx` (default `HomePreview`). Uses `HomeLiveDashboardPreview` instead of `HomeLiveDashboard`.
- **Route (that branch's `App.tsx`):** `/home-preview`.
- **Production vs preview vs playground:** **Preview** — a self-described **visual-layer-only** redesign (Task #622 per file header). Reachable in-product via the "Preview new home design" button on REF-HOME-001.
- **Screenshots:** No confident 1:1 capture on the branch; the `*Home*` mockups are separate explorations. USER_DECISION_REQUIRED.
- **Relationship to REF-HOME-001:** Structurally identical (same tiles, hrefs, `data-testid`s, role logic, data fetching, calendar wiring, filters, popovers per its own header comment and the `diff`). **Only presentation changes.**
- **Visual divergence from REF-HOME-001 (design deltas only):**
  - Plexus IQ starfield/black-gradient tile → **uniform flat navy tile** matching the other tiles.
  - Solid-black calendar header → **navy-glow header**.
  - Indigo accents / "View schedule" links → **navy/slate** system (`text-plexus-navy-800`).
  - Tiles use `preview-glass-tile preview-glass-tile-interactive` and a `preview-glass-overlay` on the day popover; borders soften (`slate-200/70`, `slate-200/60`).
  - Clinician needs-signature badge restyled from `bg-red-500` bold to `bg-plexus-navy-800` semibold, smaller; clinician subtitle line removed.
- **Live operational data / clocks / navigation / calendar:** Same wiring as REF-HOME-001 (uses `HomeLiveDashboardPreview`, same endpoints).
- **Functional dependencies:** Same canonical endpoints as REF-HOME-001.
- **Has canonical 2K superseded its behavior?** The file exists byte-identical on HEAD as well (`client/src/components/HomeDashboardPreview.tsx` and `home-preview.tsx` present on HEAD). So it is already carried in canonical as the preview surface.
- Flags: **SAFE_TO_REUSE_VISUALLY? YES.** **REQUIRES_FUNCTIONAL_REBINDING? NO** (already canonical bindings). **HISTORICAL_ONLY? NO.**
- **USER_DECISION_REQUIRED** — whether the "preview" navy/uniform-tile treatment should become the default home, remain a preview, or be discarded. No winner chosen.

> **Note on all other "Home*" names found:** `HomeAestheticMidnight`, `HomeBento`, `HomeCommandRail`, `HomeTriCockpit`, `CockpitDashboard`, `TodayAtGlance`, etc. are **static PNG mockups only** (`attached_assets/screenshots/…mockup_preview_*`). They are **not** wired homepages in this branch's code and are therefore **not** assigned REF-HOME ids. They are catalogued as visual evidence in DOC 3. Each still carries an implicit `USER_DECISION_REQUIRED` there.

## Complete home code-file inventory (primary branch) with canonical parity

Every home-related **code** file present on `plexus-iq-admin-review-persistence-fix` is listed below so the inventory is exhaustive (added in response to the Reviewer-B accounting pass, which flagged `HomeSidebar.tsx` as previously uncatalogued). "Diff vs canonical" is `git diff 08a78978 plexus-iq-admin-review-persistence-fix -- <file>`; 0 lines = byte-identical to Phase 2K HEAD. The two primary home surfaces (`HomeDashboard`, `HomeDashboardPreview`) are catalogued above as REF-HOME-001/002; the remaining files are **supporting components** of those surfaces (imported by them or by `pages/home.tsx` / `pages/home-preview.tsx`), not independent homepage variants, so they do not receive their own REF-HOME ids.

| File (branch:`client/src/components/…`) | Role | Imported by (primary branch) | Diff vs canonical HEAD | Parity finding |
|---|---|---|---|---|
| `HomeDashboard.tsx` | Production home surface → **REF-HOME-001** | `pages/home.tsx` | 13 lines | Only a `data-testid="home-dashboard"` delta (see REF-HOME-001). |
| `HomeDashboardPreview.tsx` | Preview home surface → **REF-HOME-002** | `pages/home-preview.tsx` | 0 lines | Byte-identical to canonical; already carried on HEAD. |
| `HomeLiveDashboard.tsx` | Live operational grid used by REF-HOME-001 | `HomeDashboard.tsx` | 0 lines | Byte-identical; supporting component. |
| `HomeLiveDashboardPreview.tsx` | Live grid used by REF-HOME-002 | `HomeDashboardPreview.tsx` | 0 lines | Byte-identical; supporting component. |
| `HomeSidebar.tsx` | Batch/reference left sidebar for the home views | `pages/home.tsx:45` (rendered `:488`) and `pages/home-preview.tsx` | 0 lines | Byte-identical; supporting component. **NOT** imported by `HomeDashboard.tsx` (Reviewer B's stated import mechanism was imprecise — the real importers are the `home.tsx`/`home-preview.tsx` pages). |
| `HomeWorldClocks.tsx` | World-clocks strip on the home surface | home surface | 0 lines | Byte-identical; supporting component. |

**Consequence for the "liked direction":** the entire home code cluster on the primary reference branch is byte-identical to canonical Phase 2K HEAD except the single `HomeDashboard` `data-testid`. There is **no reference-unique home code** to restore — the branch's distinct value remains its screenshot mockup library (see DOC 3). All of the above stay `VISUAL_REFERENCE_ONLY` / `USER_DECISION_REQUIRED`; none require functional rebinding.

---

# DOCK / NAVIGATION REFERENCE CATALOG

Source (all identical on PRIMARY, SECONDARY, and HEAD): `client/src/components/navigation/GlobalFloatingDock.tsx` and `client/src/lib/navigation/navigationRegistry.ts`.

## GlobalFloatingDock — placement, states, interaction (VISUAL / INTERACTION DESIGN)

- **Placement:** `fixed bottom-4 left-1/2 -translate-x-1/2 z-50` — **fixed, bottom-center**, above content, mounted once in `App.tsx` `AuthenticatedApp` (visible on all authenticated non-`/schedule/:id` routes).
- **Collapsed vs expanded:** Collapsed default (`px-2 py-1 opacity-40 scale-90`, icons `h-7 w-7`). Expanded (`px-3 py-2 opacity-100 scale-100`, icons `h-10 w-10`, labels `w-5 h-5`). `expanded = hovered || tapToggled`.
- **Hover intent:** `onMouseEnter`/`onMouseLeave`. **Hover-collapse debounce (Task #755):** leave is deferred `120ms` via `hoverLeaveTimer`, cancelled on re-enter — absorbs the "quiver" when the growing dock edge crosses a stationary cursor.
- **Mobile tap toggle:** `md:hidden` pill button (`•••` / `—`) toggles `tapToggled`.
- **Click-outside:** global `pointerdown` listener resets `tapToggled` when the click is outside `rootRef`.
- **Active state:** link items compare `location === item.href || location.startsWith(item.href + "/")`; active → `text-white` + `bg-white/15` icon chip; inactive → `text-white/80 hover:text-white`.
- **Item kinds:** `link` (wouter `<Link>`), `panel` (opens a Sheet/inline panel), `disabled` (`opacity-40 cursor-not-allowed`, `aria-disabled`). Chat is `disabled` because `CHAT_ROUTE_AVAILABLE = false`.
- **Tasks unread badge:** items with `panelId === "tasks"` show a badge from `useUnreadCount()` (`unread?.count`); pill `bg-[#7283B0]`, `ring-2 ring-slate-800`, `99+` cap.
- **Calendar sheet:** `panelId "calendar"` opens a right `Sheet` (`sm:max-w-3xl`) rendering `PlexusIQCalendar` from `/api/screening-batches/calendar-summary`; assigning a date navigates to `/plexus-iq`.
- **Tasks sheet:** `panelId "tasks"` opens a right `Sheet` (`sm:max-w-md`) rendering `TasksDockPopup`.
- **Portal inline panels:** for portal users, `PortalChatPanel`, `PortalPatientSearchPanel`, `PortalPlexusIQPanel`, `PortalTeamOpsPanel` (from `client/src/components/navigation/portal/PortalDockPanels.tsx`) open as Sheets.
- **Visual treatment / backdrop blur / opacity / scale:** `rounded-full border border-slate-600/50 bg-slate-800/85 backdrop-blur-xl shadow-lg`; collapsed opacity `0.4`/scale `0.9`, expanded opacity `1`/scale `1`; `transition-all duration-200 ease-out origin-bottom`.

## Registry item sets (OLD ROUTE / FUNCTIONAL BINDING — transcribed exactly)

Transcribed from `plexus-iq-admin-review-persistence-fix:client/src/lib/navigation/navigationRegistry.ts` (identical on SECONDARY and HEAD). `CHAT_ROUTE_AVAILABLE = false`.

### REF-DOCK-001 — `DOCK_ITEMS` (full dock; admin / biller / technician / liaison)

| id | label | Icon | kind | href / panelId | testId |
|----|-------|------|------|----------------|--------|
| `home` | Home | `Home` | link | href `/home` | `global-floating-dock-home` |
| `chat` | Chat | `MessageSquare` | disabled (`CHAT_ROUTE_AVAILABLE ? link : disabled`) | href `undefined` | `global-floating-dock-chat` |
| `tasks` | Tasks | `CheckSquare` | panel | panelId `tasks` | `global-floating-dock-tasks` |
| `plexus-iq` | Plexus IQ | `Sparkles` | link | href `/plexus-iq` | `global-floating-dock-plexus-iq` |
| `calendar` | Calendar | `CalendarDays` | panel | panelId `calendar` | `global-floating-dock-calendar` |
| `engagement` | Engagement | `TrendingUp` | link | href `/engagement-center` | `global-floating-dock-engagement` |
| `communications` | Communications | `Phone` | link | href `/scheduler-portal` | `global-floating-dock-communications` |

### REF-DOCK-002 — `PORTAL_DOCK_ITEMS` (simplified dock; scheduler / clinician)

| id | label | Icon | kind | href / panelId | testId |
|----|-------|------|------|----------------|--------|
| `portal-home` | Home | `Home` | link | href `/home` | `global-floating-dock-portal-home` |
| `portal-chat` | Chat | `MessageSquare` | panel | panelId `portal-chat` | `global-floating-dock-portal-chat` |
| `portal-search` | Patient Search | `Search` | panel | panelId `portal-search` | `global-floating-dock-portal-search` |
| `portal-tasks` | Tasks | `CheckSquare` | panel | panelId `tasks` | `global-floating-dock-portal-tasks` |
| `portal-plexus-iq` | Plexus IQ | `Sparkles` | panel | panelId `portal-plexus-iq` | `global-floating-dock-portal-plexus-iq` |
| `portal-team-ops` | Team Ops | `CalendarClock` | panel | panelId `portal-team-ops` | `global-floating-dock-portal-team-ops` |

> Note: the source comment says "Four focused items" but the array in `66f1c04b` contains **six** items. Transcribed verbatim above.

### REF-DOCK-003 — `PORTAL_DOCK_ROLES`

`new Set(["scheduler", "clinician"])` — these roles receive REF-DOCK-002; every other authenticated canonical role (**admin, biller, technician, liaison**) falls back to REF-DOCK-001. Selection in `GlobalFloatingDock` via `dockItems = PORTAL_DOCK_ROLES.has(me.role) ? PORTAL_DOCK_ITEMS : DOCK_ITEMS` (`GlobalFloatingDock.tsx:194-195`, reading `/api/auth/me`). There is no third dock-selection branch.

Also present: `GLOBAL_NAV_ROUTES = ["/home", "/clinician-portal"]` and `shouldShowGlobalNav(pathname)` (prefix match) gating the `GlobalNav` sidebar.

**Separation note (design vs binding):** The dock's *visual/interaction design* (bottom-center pill, blur, hover-intent debounce, badge, sheet/inline panels) is reusable as-is. The *route/functional binding* in the registry (`/scheduler-portal`, `/engagement-center`, `panelId` wiring) is already canonical-2K binding here — but any future re-theming must **re-verify each href against the then-current canonical route map** rather than assuming these strings. Chat remains intentionally `disabled` (`CHAT_ROUTE_AVAILABLE = false`); do not present Chat as an available route.

- **USER_DECISION_REQUIRED** — dock item set, ordering, labels, icons, portal-vs-full split, and whether Chat is ever enabled are all user decisions. No dock variant is endorsed here.

---

# TARGETED COMPARISON

Legend: "Primary" = `plexus-iq-admin-review-persistence-fix:` ; "Secondary" = `integration/restore-replit-ui-ux-canonical:` ; "Canonical" = HEAD `08a78978`. Files verified identical across branches are marked *(0-diff)*.

| Area | Current canonical files (HEAD 08a78978) | Primary-branch files | Secondary-branch files | Functional divergence | Visual divergence | What canonical 2K must preserve | Candidate visual ideas | Needs user decision? |
|------|------------------------------------------|----------------------|------------------------|-----------------------|-------------------|--------------------------------|------------------------|----------------------|
| **HOME** | `client/src/pages/home.tsx`, `components/HomeDashboard.tsx`, `HomeDashboardPreview.tsx`, `HomeLiveDashboard.tsx`, `HomeWorldClocks.tsx` | same paths *(home/live/clocks 0-diff; HomeDashboard 1 `data-testid` hunk)* | same paths *(0-diff on home/HomeDashboard)* | **None** (already canonical bindings) | HomeDashboard: only `data-testid="home-dashboard"` present in canonical. HomeDashboardPreview offers navy/uniform-tile treatment. | Live-data wiring (`/api/schedule/dashboard`, calendar-summary, global-schedule-events, home-stats), role-gated Clinician tile, calendar filters, `data-testid`s | Navy/uniform-tile "preview" look; the 37 screenshot mockups (DOC 3) as redesign inspiration | **YES** |
| **DOCK** | `components/navigation/GlobalFloatingDock.tsx`, `lib/navigation/navigationRegistry.ts` | same *(0-diff)* | same *(0-diff)* | None | None | Bottom-center pill, blur, hover-intent 120ms debounce, tasks badge, sheet/inline panels, role split, `disabled` Chat | (dock already the liked one) — theming/labels only | **YES** (item set/labels) |
| **GLOBAL NAV** | `components/GlobalNav.tsx`, `shouldShowGlobalNav` in `navigationRegistry.ts` | `components/GlobalNav.tsx` *(0-diff)* | `components/GlobalNav.tsx` *(0-diff)* | None | None | Sidebar shown only on `/home` + `/clinician-portal` | — | Only if nav surfaces change |
| **PATIENT DIRECTORY** | `pages/patient-database.tsx` (route `/patient-directory`), `components/PatientDirectoryView.tsx` | Home tile → `/patient-directory` ("Patient EHR"); `/patient-directory/live` **redirects** to `/patient-directory` | same | Old `/patient-directory/live` split is **collapsed to a redirect** in both — do NOT restore the split route as canonical | Tile label "Patient EHR" | `/patient-directory/live` → `/patient-directory` redirect; canonical single directory | Tile iconography only | Only if directory entry point changes |
| **TEAM PORTAL** | `/team-member-portals`, `/patient-care-specialist-portal`, `/ancillary-care-specialist-portal`, `/team-ops`; `PortalDockPanels.tsx` | same routes; portal dock (REF-DOCK-002) | same | None | Portal inline-panel design (Chat/Search/PlexusIQ/TeamOps Sheets) | Portal 6-item dock, inline Sheet panels, role gating | Portal panel visual treatment | **YES** (portal dock contents) |
| **CLINICIAN PORTAL** | `/clinician-portal` → `PhysicianPortalPage` (RoleGuard admin/clinician); `components/physician/DashboardHome.tsx` | same; role-gated home tile w/ `/api/physician-portal/summary` badge | same | None | Needs-signature badge count | RoleGuard admin/clinician; needs-signature badge on home tile | Badge styling (red vs navy in preview) | Only if clinician entry changes |
| **ENGAGEMENT** | `/engagement-center` → `EngagementCenterPage`; `components/navigation/EngagementPanel.tsx` | dock item `engagement` → `/engagement-center`; home tile "Outreach / Engagement Center" | same | Old `/outreach-center` **redirects** to `/scheduler-portal`; do NOT restore obsolete outreach routes | Tile label combines "Outreach / Engagement" | `/engagement-center` canonical route; outreach redirects | Tile label/icon | Only if engagement entry changes |
| **PLEXUS IQ** | `/plexus-iq` → `PlexusIQPage`; `components/plexus-iq/*` (`PlexusIQCalendar`, `PlexusIQDashboardRow`) | same; **starfield/black-gradient home tile** (distinctive) | same | `/plexus-iq-prototype` is explicitly **mock-data-only** (`VISUAL_REFERENCE_ONLY — REBIND TO CURRENT CANONICAL DATA`); `/clinical-intelligence` is a localStorage prototype | Starfield tile vs flat navy tile (preview) | Canonical `/plexus-iq` live route; keep prototype routes non-canonical | Starfield tile treatment; prototype layouts (rebind data) | **YES** (starfield vs flat) |
| **MISSION CONTROL** | `pages/mission-control.tsx` (route `/mission-control`) | same *(0-diff)*; home tile "Mission Control" (`Radar`) | present | None | `/mission-control` canonical route + home tile | Screenshot `…mission-control.png` (DOC 3) as reference | Only if mission-control redesigned |

**Do-not-restore reminders (VISUAL_REFERENCE_ONLY where relevant):**
- `/plexus-iq-prototype` and `/clinical-intelligence` are prototype/mock surfaces — treat as `VISUAL_REFERENCE_ONLY — REBIND TO CURRENT CANONICAL DATA`.
- Legacy redirects (`/patient-directory/live`, `/outreach-center`, `/outreach`, `/physician-portal`, `/schedule-dashboard`, `/ultrasound-central`, etc.) must **not** be re-expanded into standalone canonical routes.
- Chat is intentionally disabled (`CHAT_ROUTE_AVAILABLE = false`) — never present it as live.

**No winner homepage or dock variant has been chosen in this document.**
