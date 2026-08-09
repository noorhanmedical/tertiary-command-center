# Phase 2L — Information Architecture Facts (Current State)

**Status:** DISCOVERY / DOCUMENTATION-ONLY. This document records **current facts only**. It does **not** propose an information architecture, does **not** answer the open questions it raises, and does **not** choose a navigation direction. Every claim is derived by reading source at branch `phase/2l-ui-discovery`, HEAD `08a78978`.

**Read-only guarantee:** No application source was created, edited, or deleted to produce this document.

**Sibling docs reused (IDs cited directly, not re-derived):**
- `docs/ui/PHASE_2L_ROUTE_ROLE_MAP.md` — route IDs `RT001…RT072`, redirect map, guards, `shouldShowGlobalNav`.
- `docs/ui/PHASE_2L_SURFACE_INVENTORY.md` — surface IDs `S001…S361` (S121 reserved/merged).
- `docs/ui/PHASE_2L_UI_ARCHITECTURE_MAP.md` — domain → DB chains.
- `docs/ui/PHASE_2L_REPLIT_REFERENCE_AUDIT.md` — `REF-HOME-001`, `REF-HOME-002`, `REF-DOCK-001…003`, `PORTAL_DOCK_ROLES`.

**Authoritative source files for this doc:**
- Router / shells: `client/src/App.tsx` (`AuthenticatedApp`, lines 79–328).
- Navigation registry: `client/src/lib/navigation/navigationRegistry.ts`.
- Sidebar nav items: `client/src/components/GlobalNav.tsx` (`NAV_ITEMS`, lines 36–66).
- Home tiles: `client/src/components/HomeDashboard.tsx`.
- Floating dock: `client/src/components/navigation/GlobalFloatingDock.tsx`.

**Roles (canonical, 6):** `admin`, `clinician`, `scheduler`, `biller`, `technician`, `liaison` (`shared/schema/users.ts:4`).

**Two coexisting navigation systems (established fact, cited from `PHASE_2L_ROUTE_ROLE_MAP.md` §"Nav / dock visibility" and `navigationRegistry.ts`):**
1. **GlobalNav sidebar** (`components/GlobalNav.tsx`, surface `S002`) — rendered **only** on `/home` and `/clinician-portal` per `shouldShowGlobalNav()` → `GLOBAL_NAV_ROUTES = ["/home","/clinician-portal"]` (`navigationRegistry.ts:144-149`; mounted at `App.tsx:81,90`).
2. **GlobalFloatingDock** (`components/navigation/GlobalFloatingDock.tsx`, surface `S003`) — bottom-center, `fixed`, mounted once and visible on **all** authenticated routes except the out-of-shell `/schedule/:id` (`App.tsx:88`).

---

## 1. Current top-level destinations

Two independent "top-level" sets exist because the two nav systems have different, only partly-overlapping targets.

### 1a. GlobalFloatingDock targets — `DOCK_ITEMS` (admin / biller / technician / liaison) — `navigationRegistry.ts:28-85`

> Recipients: every authenticated role **not** in `PORTAL_DOCK_ROLES` falls back to `DOCK_ITEMS` — i.e. `admin`, `biller`, `technician`, `liaison` (`dockItems = PORTAL_DOCK_ROLES.has(me.role) ? PORTAL_DOCK_ITEMS : DOCK_ITEMS`, `GlobalFloatingDock.tsx:194-195`). There is no third branch.

| Dock id | Label | Kind | Target | Route/Surface |
|---|---|---|---|---|
| `home` | Home | link | `/home` | RT005 / S011-region |
| `chat` | Chat | **disabled** | none (`CHAT_ROUTE_AVAILABLE = false`, `navigationRegistry.ts:26`) | — |
| `tasks` | Tasks | panel | opens Tasks sheet (`panelId "tasks"`, `TasksDockPopup`) | S004/S003 panel |
| `plexus-iq` | Plexus IQ | link | `/plexus-iq` | RT039 |
| `calendar` | Calendar | panel | opens Calendar sheet (`PlexusIQCalendar`) | S004 |
| `engagement` | Engagement | link | `/engagement-center` | RT045 |
| `communications` | Communications | link | `/scheduler-portal` | RT026 |

### 1b. GlobalFloatingDock targets — `PORTAL_DOCK_ITEMS` (scheduler / clinician) — `navigationRegistry.ts:90-139`

Selected when `PORTAL_DOCK_ROLES = new Set(["scheduler","clinician"])` matches `me.role` (`navigationRegistry.ts:142`; `GlobalFloatingDock.tsx`).

| Dock id | Label | Kind | Target |
|---|---|---|---|
| `portal-home` | Home | link | `/home` (RT005) |
| `portal-chat` | Chat | panel | `PortalChatPanel` sheet (S005) |
| `portal-search` | Patient Search | panel | `PortalPatientSearchPanel` sheet (S005) |
| `portal-tasks` | Tasks | panel | Tasks sheet |
| `portal-plexus-iq` | Plexus IQ | panel | `PortalPlexusIQPanel` sheet (S005) |
| `portal-team-ops` | Team Ops | panel | `PortalTeamOpsPanel` sheet (S005) |

> Source-comment discrepancy (verbatim): the comment at `navigationRegistry.ts:87-89` says "Four focused items", but the array contains **six** items.

### 1c. GlobalNav sidebar targets — `NAV_ITEMS` (`GlobalNav.tsx:36-66`), role-filtered by each item's `roles[]`

| # | Label | href | Route | roles[] |
|---|---|---|---|---|
| 1 | Home | `/home` | RT005 | admin, clinician, scheduler |
| 2 | Mission Control | `/mission-control` | RT007 | admin |
| 3 | Schedule | `/schedule` | RT014 | admin, clinician, scheduler |
| 4 | Imaging Central | `/imaging-central` | RT008 | admin, clinician, technician, liaison |
| 5 | Outreach Center | `/scheduler-portal` | RT026 | admin, clinician, scheduler |
| 6 | Ancillary Documents | `/ancillary-documents` | RT018 | admin, clinician |
| 7 | Billing | `/billing` | RT020 | admin, biller |
| 8 | Invoices | `/invoices` | RT021 | admin, biller |
| 9 | Team Ops | `/team-ops` | RT046 | admin |
| 10 | Clinic Analytics | `/clinic-analytics` | RT011 | admin |
| 11 | Clinic Onboarding | `/clinic-onboarding` | RT013 | admin |
| 12 | Patient EHR | `/patient-directory` | RT016 | admin, clinician, biller |
| 13 | Plexus Bank | `/plexus-bank` | RT049 | admin |
| 14 | Plexus Tasks | `/plexus-tasks` | RT048 | admin, clinician, scheduler, biller |
| 15 | Document Library | `/document-library` | RT050 | admin |
| 16 | Clinician Portal | `/clinician-portal` | RT031 | admin, clinician |
| 17 | Technician Portal | `/technician-portal` | RT029 | admin, technician, liaison |
| 18 | Liaison Technician Portal | `/liaison-technician-portal` | RT030 | admin, technician, liaison |
| 19 | Admin | `/admin/settings` | RT051 | admin |

### 1d. Home tiles as a de-facto "launcher" (`HomeDashboard.tsx`)

The Home page (RT005) is itself a top-level launcher: its tile grid links to `/mission-control`, `/patient-directory`, `/plexus-iq`, `/engagement-center`, `/team-member-portals`, `/team-ops`, `/plexus-tasks`, `/imaging-central`, `/document-upload`, `/ancillary-documents`, `/clinician-portal` (role-gated tile), `/clinic-onboarding`, `/clinic-analytics`, plus `/home-preview` (`HomeDashboard.tsx:234,434,453-552`; cf. REF-HOME-001 tile set).

**Fact — the three destination sets are NOT identical.** Examples of divergence:
- The **dock** exposes Engagement, Communications (=`/scheduler-portal`), Plexus IQ; the **sidebar** exposes ~19 items; the **home tiles** expose a third overlapping-but-different set (e.g. Home tiles surface `/team-member-portals` and `/document-upload`, which are in neither dock nor sidebar).
- `Patient EHR` (`/patient-directory`) is in the sidebar and home tiles, but **not** in either dock item set.
- The sidebar only actually renders on `/home` and `/clinician-portal`, so on every other route the dock + home-tile links + in-page links are the only navigation.

---

## 2. Current shells

All shells live in `client/src/App.tsx`.

| Shell | Where | Composition | Routes it wraps |
|---|---|---|---|
| **Out-of-shell route** | `App.tsx:84` | `/schedule/:id` handled by the **outer** `<Switch>` **before** the app chrome; renders `SharedSchedule` (RT001, S190) with **no** TopBanner / dock / sidebar. Page-level PIN `"1111"`. | `/schedule/:id` only |
| **AuthenticatedApp chrome shell** | `App.tsx:85-325` | `<div flex-col h-screen>` → `TopBanner` (S001) + `GlobalFloatingDock` (S003, always) + `{showGlobalNav && GlobalNav}` (S002, conditional) + scrollable content region wrapping the inner `<Switch>`. | Every authenticated route except `/schedule/:id` |
| **`SidebarProvider`-wrapped routes** | `App.tsx` per-route | Individual routes additionally wrap their page in `<SidebarProvider defaultOpen={false}>` (`SIDEBAR_STYLE`). | `/home` (104), `/home-preview` (109), `/mission-control` (114), `/imaging-central` (119), `/clinic-analytics` (133), `/analytics` (139), `/clinic-onboarding` (144), `/visit-patients` (197), `/outreach-patients` (205), `/plexus-iq` (213), `/clinical-intelligence` (220), `/team-member-portals` (229), `/patient-care-specialist-portal` (234), `/ancillary-care-specialist-portal` (238) |
| **Non-`SidebarProvider` in-shell routes** | `App.tsx` per-route | Rendered directly inside the chrome shell without a `SidebarProvider` (e.g. via `component={...}`). | e.g. `/schedule` (148), `/patient-directory` (158), `/ancillary-documents` (162), `/billing` (166), `/engagement-center` (243-245), `/plexus-iq-prototype` (225-227, also no chrome comment), `/team-ops` (246), `/plexus-tasks` (250), admin/billing pages, etc. |
| **Login shell** | `App.tsx:374-375` | `AppShell` renders `LoginPage` (S007) for unauthenticated users **before** the router mounts. Login is not a route in `AuthenticatedApp`. | unauthenticated |
| **Portal sub-shells (component-level, inside chrome shell)** | pages | `PhysicianPortalShell` (clinician portal), `ClinicWorkflowPortal` / `TeamPortalShell` (PCS/ACS/technician/liaison portals). These are page-internal shells, not App.tsx-level. See `PHASE_2L_UI_ARCHITECTURE_MAP.md` domains PCS/ACS/Clinician. | RT029, RT030, RT031, RT043, RT044 |

**Count of App.tsx-level shells:** 3 primary (out-of-shell `/schedule/:id`; the chrome shell; the login/AppShell pre-router shell), with `SidebarProvider` as a per-route wrapper variant and portal shells as page-internal sub-shells.

---

## 3. Current portal boundaries (which routes belong to which portal/domain)

Portals named in the seed: PCS, ACS, Clinician, Scheduler/Team, Admin, Finance/Billing. Mapped from `PHASE_2L_ROUTE_ROLE_MAP.md` (Portal/domain column) and `PHASE_2L_UI_ARCHITECTURE_MAP.md`.

| Portal / domain | Routes (RT / path) | Server guard |
|---|---|---|
| **PCS (Patient Care Specialist)** | RT043 `/patient-care-specialist-portal` | `PCS_ROLES = {admin, liaison}` (`pcsAcsCanonical.ts:22`) |
| **ACS (Ancillary Care Specialist)** | RT044 `/ancillary-care-specialist-portal` | `ACS_ROLES = {admin, technician}` (`pcsAcsCanonical.ts:23`) |
| **Team Member Portals hub** | RT042 `/team-member-portals` (landing → links into PCS/ACS) | none (static hub) |
| **Technician / Liaison portals** | RT029 `/technician-portal`, RT030 `/liaison-technician-portal` | `requirePortalRole = {admin, technician, liaison}` (`portal.ts:41-46`) |
| **Clinician (Physician) Portal** | RT031 `/clinician-portal` (renders `PhysicianPortalPage`) | client `RoleGuard[admin,clinician]`; server `requireClinicianOrAdmin` |
| **Scheduler / Team (Outreach + Scheduling)** | RT026 `/scheduler-portal` (renders `OutreachPage`), RT024 `/outreach/scheduler/:id`, RT014 `/schedule`, RT069 `/dashboard`, RT023 `/appointments`, RT037 `/outreach-patients` | mostly unguarded on client; server clinic-scoped |
| **Engagement** | RT045 `/engagement-center`, RT037 `/outreach-patients` | server engagement admin endpoints `requireRole("admin")` |
| **Admin** | RT051 `/admin/settings` hub (many `/admin/*` redirects fold in), RT049 `/plexus-bank`, RT050 `/document-library` | `AdminGuard` (client); several server `requireRole("admin")` |
| **Finance / Billing** | RT020 `/billing`, RT021 `/invoices` (`RoleGuard[admin,biller]`), RT056–RT062 `/billing/*` (AdminGuard) | `AdminGuard`/`RoleGuard` on client; no `requireRole` on core billing/invoice routes (`PHASE_2L_ROUTE_ROLE_MAP.md` §Server-side) |
| **Patient EHR / Directory** | RT016 `/patient-directory` (+ redirects RT003, RT015, RT017) | none on client; server clinic-scoped, activation-flag gated |
| **Documents** | RT018 `/ancillary-documents`, RT019/RT004 redirects, RT022 `/document-upload`, RT050 `/document-library` | Document Library is AdminGuard |
| **Plexus IQ** | RT039 `/plexus-iq`, RT040 `/clinical-intelligence` (prototype), RT041 `/plexus-iq-prototype` (mock) | none |
| **Imaging** | RT008 `/imaging-central` (+ RT009/RT010 redirects) | none (playground/mock) |
| **Tasks** | RT048 `/plexus-tasks` (+ RT047 redirect) | none |
| **Command center** | RT007 `/mission-control` | page unguarded; server `/api/mission-control/*` `requireRole("admin")` |

**Fact:** portal boundaries are not enforced consistently at the route/client layer. Several portals are reachable by URL by any authenticated role (no `App.tsx` guard) while their `/api/*` backends enforce role/flag gating server-side (`PHASE_2L_ROUTE_ROLE_MAP.md` §Roles & guards). PCS/ACS pages are flagged by the component scan as unwired/design-reference surfaces with canonical views default-OFF (`PHASE_2L_UI_ARCHITECTURE_MAP.md` PCS/ACS).

---

## 4. Current cross-links (which surfaces link into which)

From `PHASE_2L_SURFACE_INVENTORY.md` and grep of `Link href`/`setLocation`.

- **Home → many:** Home tiles link to `/mission-control`, `/patient-directory`, `/plexus-iq`, `/engagement-center`, `/team-member-portals`, `/team-ops`, `/plexus-tasks`, `/imaging-central`, `/document-upload`, `/ancillary-documents`, `/clinician-portal`, `/clinic-onboarding`, `/clinic-analytics`, `/home-preview` (`HomeDashboard.tsx:234,453-552`).
- **Team Member Portals hub → PCS/ACS:** `/team-member-portals` links to `/patient-care-specialist-portal` and `/ancillary-care-specialist-portal` (`team-member-portals.tsx:35,48,83`).
- **Dock → routes/panels:** `/home`, `/plexus-iq`, `/engagement-center`, `/scheduler-portal`; panel sheets for Tasks, Calendar, and (portal roles) Chat/Search/PlexusIQ/TeamOps (`navigationRegistry.ts`; `GlobalFloatingDock.tsx`).
- **Dock Calendar sheet → `/plexus-iq`:** assigning a date in the calendar sheet navigates to `/plexus-iq` (`PHASE_2L_REPLIT_REFERENCE_AUDIT.md:120`).
- **Plexus IQ page → assign:** calendar → date assignment flow (`plexus-iq.tsx`, RT039).
- **Engagement Center → assignment board** (in-page assign/cancel, no forward route) (RT045).
- **Sidebar (S002) → 19 items** on `/home` and `/clinician-portal` only.
- **Redirect-only cross-links:** 30+ legacy paths funnel into current targets (see `PHASE_2L_ROUTE_ROLE_MAP.md` §Redirect map), most notably `/admin/*`, `/billing/remittance`, `/billing/auditor`, `/audit-log`, `/call-list-audit` → `/admin/settings?tab=…`.

---

## 5. Current patient-context transitions

How a patient is carried across surfaces (from `PatientDatabasePage`/`patient-database.tsx`, `PHASE_2L_SURFACE_INVENTORY.md`, and the domain map).

- **Directory → Profile (same route, query param):** `/patient-directory` (RT016, `patient-database.tsx`) carries patient identity via **`?patientId=`** deep link. Selecting a patient calls `setLocation(\`/patient-directory?${sp.toString()}\`)` (`patient-database.tsx:205,212`) and renders the profile **in-page** via `PatientProfileWorkspace` (S061/S062) — the URL stays on `/patient-directory`; there is **no separate `/patient/:id` route**. On load the page tries to satisfy `?patientId=` from the already-loaded roster, else fetches (`patient-database.tsx:95,170`).
- **Case / procedure / billing context:** carried by **path `:id`** on **API endpoints**, not on client routes. Examples from the domain map: `/api/ancillary-cases/:id/billing-document`, `/api/ancillary-cases/:id/canonical-claim`, `/api/portal/command-center/:patientId`, `/api/acs-workflow/:id`, `/api/invoices/:id` (`PHASE_2L_UI_ARCHITECTURE_MAP.md` Billing/Claims/PCS/Invoices; `PHASE_2L_SURFACE_INVENTORY.md` S227). The corresponding **client surfaces are panels/tabs inside portal pages** (PCS/ACS `ClinicWorkflowPortal`, Clinician `PhysicianPortalShell`), reached by selecting a work-queue row, **not** by a patient-scoped client route.
- **Client routes that take `:id`:** `/schedule/:id` (RT001, batch-scoped, out of shell) and `/outreach/scheduler/:id` (RT024, scheduler/batch-scoped). Neither is a patient-EHR route.
- **Fact:** there is **no single canonical patient-context client route** (`/patient/:id` does not exist). Patient identity crosses surfaces via (a) `?patientId=` query on `/patient-directory`, (b) in-portal work-queue selection driving `/api/**/:id` fetches, or (c) the dock/portal Patient Search panel (S005/S235). Three distinct patient-search entry points exist (see §6).

---

## 6. Current duplication (summary — cited, not re-derived)

From `PHASE_2L_SURFACE_INVENTORY.md` §"Cross-cutting duplicate / similar surfaces" and this doc's nav facts.

- **2 navigation systems** coexist: GlobalNav sidebar (S002, 2 routes only) + GlobalFloatingDock (S003, all routes), with a third de-facto launcher (Home tiles). (§1 above; `navigationRegistry.ts`.)
- **≥5 patient-search entry points:** S028 (home references) · S043 (mission control) · S235 (portal) · S057 (directory rail) · global dock search S005 (`SURFACE_INVENTORY:770`).
- **≥6 calendar implementations:** S161 (TriClinic) · S195/S196 (mini/slot) · S203 (canonical command) · S111 (Plexus IQ) · S251/S252 (portal) (`SURFACE_INVENTORY:773`); also the Home `CanonicalMonthCalendar` and dock Calendar sheet.
- **3 "assign patient to scheduler" UIs:** S026 (home) · S125 (qualification) · S173/S175 (engagement) (`SURFACE_INVENTORY:769`).
- **3 patient-profile views:** S061/S062 (workspace chart) vs S068 (live drawer) vs S253 (portal facts card) (`SURFACE_INVENTORY:771`).
- **4 booking dialogs:** S162 / S197-S198 / S255-S256 / S086 (`SURFACE_INVENTORY:774`).
- **Duplicate/DNC warning badge** reused across S077/S078/S079/S155/S183 (`SURFACE_INVENTORY:772`).
- **Canonical vs legacy flag-toggled pairs:** S261–S263 vs S265–S267; S276 vs S279; S160 (`SURFACE_INVENTORY:777`).

---

## 7. Current route naming (name-vs-component mismatches)

From `App.tsx` route→component bindings and `PHASE_2L_ROUTE_ROLE_MAP.md`.

| Route path | Component actually rendered | Displayed label / concept | Mismatch |
|---|---|---|---|
| `/scheduler-portal` (RT026) | `OutreachPage` (`pages/outreach.tsx`) | Relabeled "Outreach Center" in sidebar | Path says "scheduler-portal"; renders Outreach; label is "Outreach Center". Comment (`GlobalNav.tsx:41-47`) states there is **no standalone Scheduler Portal product**. |
| `/clinician-portal` (RT031) | `PhysicianPortalPage` (`pages/physician-portal.tsx`) | "Clinician Portal" | Path/label "clinician"; component/file "physician". `/physician-portal` redirects here (RT032b). |
| `/patient-directory` (RT016) | `PatientDatabasePage` (`pages/patient-database.tsx`) | "Patient EHR" | Three names for one thing: path "patient-directory", component "PatientDatabase", label "Patient EHR". |
| `/ancillary-documents` (RT018) | `DocumentsPage` (`pages/documents.tsx`) | "Ancillary Documents" | Path/label "ancillary-documents"; component "Documents". `/documents` and `/plexus` redirect here. |
| `/liaison-technician-portal` (RT030) | `LiaisonPortalPage` (`pages/liaison-portal.tsx`) | "Liaison Technician Portal" | File "liaison-portal" vs route "liaison-technician-portal"; `/liaison-portal` redirects to it. |
| `/dashboard` (RT069) | `ScheduleDashboardPage` (`pages/schedule-dashboard.tsx`) | Schedule Dashboard | Generic path `/dashboard` renders the **Schedule** dashboard; `/schedule-dashboard` redirects here (inverse of the usual pattern). |
| `/plexus` (RT004) | redirect to `/ancillary-documents` | — | A `pages/plexus.tsx` file exists but is **dead** (not rendered by this route). |
| `/technician-central`, `/ultrasound-central` (RT009/RT010) | redirect to `/imaging-central` | Imaging Central | Old module names retained as paths. |
| `/settings` (RT071) | redirect to `/admin/settings#team` | — | Generic `/settings` funnels into Admin settings team tab. |

**Count of name-vs-component mismatches identified: 9** (the rows above; the four called out in the seed — `/scheduler-portal`→OutreachPage, `/clinician-portal`→PhysicianPortalPage, `/patient-directory`→PatientDatabasePage, `/ancillary-documents`→DocumentsPage — plus 5 additional).

---

## 8. Current dead ends / orphans

**Orphan page files (DEAD_OR_UNREACHABLE — from `PHASE_2L_ROUTE_ROLE_MAP.md` §Potential orphan pages):**

| Page file | Why orphan |
|---|---|
| `client/src/pages/plexus.tsx` | Not routed; `/plexus` redirects to `/ancillary-documents`. 0 importers. |
| `client/src/pages/admin-ops.tsx` | `/admin-ops` redirects to admin settings. 0 importers. |
| `client/src/pages/task-brain.tsx` | `/task-brain` redirects to `/plexus-tasks`. 0 importers. |
| `client/src/pages/drive.tsx` | No `/drive` route exists. 0 importers. |
| `client/src/pages/patient-directory-live.tsx` | `/patient-directory/live` redirects to `/patient-directory`. 0 importers (inner component reused elsewhere). |

**Dead-end / no-forward-navigation surfaces (routes reachable but with no onward navigation):**
- `/plexus-iq-prototype` (RT041) — mock-only prototype, no forward links (`App.tsx:224-227`).
- `/clinical-intelligence` (RT040) — localStorage prototype, no forward links.
- `/clinic-analytics` + `/analytics` (RT011/RT012) — static/computed, no fetch, no forward links (`UI_ARCHITECTURE_MAP` Analytics).
- `/clinic-onboarding` (RT013) — static/computed checklist, no forward links.
- `/imaging-central` (RT008) — playground/mock, no `/api/*`, no forward links.
- `/clinic-workflow-demo` (RT028) — demo, not in nav.
- `/home-preview` (RT006) — reachable only via the "Preview new home design" button; not in nav.
- **Direct-URL-only routes** (no nav/dock/tile entry, reachable only by typing the URL): `/document-upload` (RT022), `/appointments` (RT023), `/patient-intake` (RT033), `/outreach-patients` (RT037), `/dashboard` (RT069), `/billing/readiness`, `/billing/invoice-batches`, `/billing/invoice-review`, `/billing/invoice-delivery`, `/billing/reports` (RT056–RT062) — Entry-point column = "Direct/link" in `PHASE_2L_ROUTE_ROLE_MAP.md`.

**Count of orphan page files: 5. Count of dead-end / no-forward or direct-URL-only surfaces enumerated above: ~17** (7 named playground/preview/demo + ~10 direct-URL-only).

---

## 9. Current paths that require excessive navigation (multi-hop)

Described factually with hop counts (a "hop" = one user navigation action).

- **Reaching a specific patient's EHR profile from a non-`/home`, non-`/clinician-portal` route:** the sidebar (which contains "Patient EHR") is **hidden** on that route (`shouldShowGlobalNav`). Path: (1) dock/TopBanner "Home" → `/home`, (2) Home tile "Patient EHR" → `/patient-directory`, (3) search/select patient → `?patientId=` in-page. **3 hops** minimum when starting outside `/home`/`/clinician-portal`; **2 hops** from Home (tile → select).
- **Reaching a patient inside PCS/ACS work context:** (1) Home tile "Team Member Portals" → `/team-member-portals`, (2) hub link → `/patient-care-specialist-portal` (or ACS), (3) select work-queue row → in-portal panel (`/api/portal/command-center/:patientId`). **3 hops** from Home.
- **Reaching a patient's billing/invoice from directory:** no direct link exists between `/patient-directory` and `/invoices`/`/billing`; the user must navigate separately (dock/sidebar or direct URL) to the billing surface and re-locate the patient/case there — patient context is **not carried** across the directory→billing boundary (see §5; billing surfaces key off `/api/**/:id`, not the directory's `?patientId=`). **≥2 independent hops, no context carry.**
- **Reaching Admin logs (e.g. audit):** legacy deep links (`/audit-log`, `/call-list-audit`, `/billing/remittance`) redirect into `/admin/settings?tab=logs&log=…`; from a cold start an admin goes Home → sidebar "Admin" → tab "logs" → sub-log. **3 hops** (`PHASE_2L_ROUTE_ROLE_MAP.md` RT051 tab children).
- **General fact:** because the persistent sidebar only appears on 2 of ~40 in-shell routes, most cross-domain navigation forces a return trip through `/home` (or reliance on the dock's ~7 items), inflating hop counts for any destination not in the dock.

---

# QUESTIONS FOR THE USER

> **This section lists open information-architecture decisions as QUESTIONS ONLY. They are intentionally NOT answered here. Every item below is a decision the USER will make in the future navigation-design phase. Nothing in this document proposes or selects an answer.**

1. **PCS vs ACS discoverability:** Should PCS (`/patient-care-specialist-portal`, RT043) and ACS (`/ancillary-care-specialist-portal`, RT044) remain **separately discoverable** top-level destinations, or be consolidated?
2. **Clinician Portal as top-level:** Should the Clinician Portal (`/clinician-portal`, RT031) be a **top-level destination**, or remain a role-gated tile/sidebar item?
3. **Patient EHR as primary entry:** Should Patient EHR (`/patient-directory`, RT016) become the **primary patient-context entry point** (e.g. a canonical `/patient/:id` context), given there is currently no patient-scoped client route (§5)?
4. **Which Replit home variant:** Which exact Replit home variant is preferred — **REF-HOME-001** (production `HomeDashboard`, starfield/black tiles) vs **REF-HOME-002** (`HomeDashboardPreview`, navy/uniform tiles)? (See `PHASE_2L_REPLIT_REFERENCE_AUDIT.md`; all marked USER_DECISION_REQUIRED.)
5. **Dock behavior to preserve:** Which exact dock behaviors should be preserved (bottom-center pill, hover-intent 120ms debounce, collapsed/expanded scale-opacity, tasks unread badge, calendar/tasks sheets, click-outside reset, mobile tap toggle)? (`REF-DOCK-001…003`.)
6. **Role-specific docks:** Should role-specific docks remain? The **current** split is: `PORTAL_DOCK_ROLES = {scheduler, clinician}` receive the 6-item `PORTAL_DOCK_ITEMS`; every other authenticated role — **admin, biller, technician, liaison** — falls back to `DOCK_ITEMS`. Whether that split should stay, or `technician`/`liaison`/`biller` should get a tailored dock, is `USER_DECISION_REQUIRED` (the current implementation is not changed by this discovery).
7. **Dock vs sidebar relationship:** Should the dock **replace** or **complement** the persistent GlobalNav sidebar (currently the sidebar renders on only `/home` and `/clinician-portal`)?
8. **Chat:** Should Chat ever be enabled (`CHAT_ROUTE_AVAILABLE` is currently `false`; the dock item is `disabled`)?
9. **Route naming:** Should the 9 name-vs-component mismatches (§7) be renamed/aligned (e.g. `/scheduler-portal`→OutreachPage, `/clinician-portal`→PhysicianPortalPage, `/patient-directory`→PatientDatabasePage/"Patient EHR", `/ancillary-documents`→DocumentsPage, `/dashboard`→ScheduleDashboardPage)?
10. **Duplication consolidation:** Which of the duplicated surfaces (§6) should be unified — the ≥5 patient-search entries, ≥6 calendars, 3 assign-to-scheduler UIs, 3 profile views, 4 booking dialogs?
11. **Orphans:** Should the 5 orphan page files (§8) be deleted, revived, or left? (This document does not propose deletion.)
12. **Dead ends / direct-URL-only routes:** Should the ~17 dead-end / direct-URL-only surfaces (§8) receive nav entry points, be demoted, or be removed?
13. **Home as launcher:** Should Home remain a de-facto third launcher (tile grid, §1d) in addition to sidebar + dock, or should launcher responsibility be consolidated?
14. **Multi-hop reduction:** Should the multi-hop patient/case/billing paths (§9) — especially the lack of patient-context carry across directory→billing and the sidebar being hidden on ~38 of ~40 routes — be addressed, and how?
15. **Team Member Portals hub:** Should `/team-member-portals` (RT042) remain a separate hub page that links into PCS/ACS, or be collapsed into the destinations it links to?

---

**End of factual mapping. No IA, no recommendations, and no decisions are made in this document.**
