# Phase 2L — UI Debt Map (Duplication & Inconsistency Classification)

**Status:** Documentation-only. **No application source was created, edited, or deleted** to produce this document. Nothing is standardized, removed, refactored, or fixed here. This file **classifies facts only** — it does not recommend removing or changing anything.

**Repository HEAD:** `08a78978` (branch `phase/2l-ui-discovery`).

**Scope & method.** This map builds directly on the three sibling Phase 2L discovery docs and reuses their identifiers verbatim — it does **not** re-derive surfaces from scratch:
- `docs/ui/PHASE_2L_SURFACE_INVENTORY.md` — surfaces `S001–S361`, incl. its "Cross-cutting duplicate / similar surfaces" section (patient search ×5, assignment ×3, booking dialogs ×4, calendar primitives, canonical-vs-legacy flag pairs).
- `docs/ui/PHASE_2L_COMPONENT_PATTERN_INVENTORY.md` — 34 patterns, shared-vs-bespoke file counts, a11y observations. This debt map cites its counts rather than re-counting.
- `docs/ui/PHASE_2L_ROUTE_ROLE_MAP.md` — routes `RT001–RT072`, orphan pages, PLAYGROUND/PREVIEW/LEGACY/DEAD_OR_UNREACHABLE statuses.

Each finding was **spot-checked against source** where feasible (calendar files, patient-search components, portal shells, finance pages, local `EmptyState` defs, mock/localStorage prototype pages — see "Verification log" at the end). Where a fact could not be confirmed it is marked `UNKNOWN_NEEDS_VERIFICATION`.

**Classification vocabulary (each finding gets exactly one):**

| Classification | Meaning |
|---|---|
| `FUNCTIONAL_DUPLICATION` | Two+ surfaces do the *same job* with separate implementations. |
| `VISUAL_DUPLICATION` | Same visual concept rendered by divergent styles/tokens (look-and-feel drift). |
| `INTERACTION_DUPLICATION` | Same interaction (open/confirm/select/navigate) built with different patterns/behaviors. |
| `LEGACY_ARTIFACT` | An explicitly older/legacy copy kept alongside a newer one (redirect, `Legacy*` component, "legacy" pairing). |
| `PREVIEW_ARTIFACT` | A parallel preview/redesign copy of a production surface (`*-preview`, `*Preview`). |
| `POSSIBLE_DEAD_CODE` | Surface exists in source but appears unreachable / zero importers per the route map. |
| `INTENTIONAL_ROLE_VARIANT` | Divergence that is by-design because roles/personas differ (not necessarily debt). |
| `NEEDS_USER_DECISION` | Duplication whose intent cannot be classified from source alone; a human must decide. |

> These labels describe *what a thing is*, not *what should happen to it*. No removal or consolidation is implied.

---

## Debt findings

### Group 1 — Patient-identity & profile surfaces

| DEBT ID | Title | Evidence (files + S### IDs) | Classification | Notes |
|---|---|---|---|---|
| DEBT-001 | Duplicate patient headers (≥4 implementations) | `components/patient-directory/PatientProfileHeader.tsx` (S063 sticky) · `PatientProfileDrawer` header (S068) · `components/portal/PatientDirectoryFactsCard.tsx` (S253) · `components/PatientCard.tsx` (S081) · `components/BatchHeader.tsx` (S087) / `PlexusIQActiveBatchHeader.tsx` (S103). Pattern-inventory "PATIENT HEADERS" row lists ≥4. | `VISUAL_DUPLICATION` | No unified patient-header primitive; demographic layout, badge set, and quick-action set differ per header. Some are patient-scoped, some batch-scoped. |
| DEBT-002 | Duplicated patient-search components (×5) | `components/PatientDirectoryView.tsx` (S028) · `pages/mission-control.tsx` search sheet (S043) · `components/portal/PortalPatientSearchTab.tsx` (S235) · `pages/patient-database.tsx` roster rail (S057) · `components/navigation/portal/PortalDockPanels.tsx` dock search (S005); also `features/command-center/components/PopupPatientPicker.tsx`. Surface-inventory "Patient EHR search" cluster. `command.tsx` (cmdk) available but not the basis. | `FUNCTIONAL_DUPLICATION` | Same job (search EHR/patient roster) with five bespoke result-row layouts; debounce/min-chars/empty-copy differ per surface (component inventory SEARCH row). |
| DEBT-003 | Multiple patient-profile views | `PatientProfileWorkspace.tsx`/`PatientChart.tsx` (S061/S062 workspace chart) vs `PatientProfileDrawer.tsx` (S068 live drawer, 9 tabs) vs `PatientDirectoryFactsCard.tsx` (S253 portal facts card). Surface-inventory "Patient profile view" cluster; S067 note "Duplicate profile view vs S068". | `FUNCTIONAL_DUPLICATION` | Three renderings of the patient record (full workspace, read-only drawer, portal quick-card). |
| DEBT-004 | Patient-assignment-to-scheduler UIs (×3) | `pages/home.tsx` Assign Scheduler Dialog (S026) · `components/qualification/ChangeEngagementAssignmentDialog.tsx` (S125) · engagement assignment board (S173/S175). Surface-inventory "Patient assignment to scheduler" cluster; S026/S125 notes call each other duplicates. | `INTERACTION_DUPLICATION` | Same concept (assign patient → scheduler) via three separate dialogs/boards. |

### Group 2 — Duplicate / mixed shared primitives (from Component/Pattern inventory)

| DEBT ID | Title | Evidence (files + S### IDs) | Classification | Notes |
|---|---|---|---|---|
| DEBT-005 | Two button systems (shadcn vs raw `<button>`) | `components/ui/button.tsx` (146 importers) vs 150 files using raw `<button>` (pattern inventory BUTTONS row; e.g. `RailIcon` in `pages/outreach-scheduler-portal.tsx`, `PlexusDrive.tsx`). Bespoke tiles S016/S017. | `VISUAL_DUPLICATION` | Two visual button vocabularies (tokenized vs Tailwind-literal); loading/disabled state hand-rolled per bespoke site. |
| DEBT-006 | Multiple table systems (≥3) | `components/ui/table.tsx` (6 importers) vs 26 files raw `<table>` vs `components/physician/ui/DataTable.tsx` (S274, generic sortable) vs CSS-grid "tables" (Operating Row S102, imaging tables S047/S048, MC lanes S039). Pattern-inventory TABLES row. | `VISUAL_DUPLICATION` | shadcn Table / raw table / DataTable / grid-div rows coexist; header/zebra/sort/sticky hand-rolled per system. |
| DEBT-007 | Mixed select systems (Radix vs native) | `components/ui/select.tsx` (42 importers, Radix) vs 20 files native `<select>` vs `DropdownMenu`-as-select. Pattern-inventory SELECTS row. | `VISUAL_DUPLICATION` | OS-styled native selects vs app-styled Radix render visibly differently; typeahead/keyboard differs. |
| DEBT-008 | Mixed tab systems (Radix vs hash/button-strip) | `components/ui/tabs.tsx` (12 files) vs bespoke: `pages/home.tsx` view-mode tabs, `admin-settings.tsx` `activeSection` hash tabs, engagement switcher (S168), scheduler playfield strip (S149), portal mode switcher (S214). Pattern-inventory TABS row. | `INTERACTION_DUPLICATION` | Radix roving-tabindex vs plain-button strips vs hash/query deep-links; only 2 files use `role="tab"`. |
| DEBT-009 | Duplicate status vocabulary & presentation (≥3) | `components/ui/badge.tsx` (73) vs `StatusPill` in physician `ui/primitives.tsx` (11 files) vs inline color-literal `<span>` badges; stage vectors `StageVectorView` (S219) with `available`/`upstream_flag_off`/`unavailable`/`migration_missing`. Pattern-inventory STATUS CHIPS row; state surfaces S352/S353/S360. | `VISUAL_DUPLICATION` | Pill vs badge vs dot; per-domain status words; status color→meaning mapping not centralized. |
| DEBT-010 | Duplicated cards/tiles (shadcn Card vs bespoke divs + tile families) | `components/ui/card.tsx` (89 importers) vs bespoke `rounded border` card divs; tile families `SecondaryTile`/`ClinicianPortalTile` (S016/S017), `ScheduleTile` (S024), MC `SPINE_CARDS` (S037), imaging spine (S046), engagement baskets (S182). Pattern-inventory CARDS + TILES rows. | `VISUAL_DUPLICATION` | Padding/radius/shadow differ between shadcn Card and literal-div cards; multiple bespoke tile styles per dashboard. |
| DEBT-011 | Multiple metric-card variants | `StatCard` (physician primitives, 7 files) vs Practice Pulse (S018/S034) vs MC metric sections (S042) vs outreach metrics strip (S142) vs floating metrics tile (S151) vs engagement summary strip (S170). Pattern-inventory METRICS row. | `VISUAL_DUPLICATION` | StatCard vs KPI strip vs metric section vs floating tile; number/label layout and `sourceMissing`→"N/A" handling differ. |
| DEBT-012 | Bespoke primitives overlapping shared shadcn primitives (near-unused shadcn) | shadcn primitives with 0–1 importers while bespoke equivalents exist: `radio-group.tsx` (0 importers; toggle-button "radios"), `drawer.tsx` (0; Sheet/bespoke slide-panels used), `pagination.tsx` (0; "Load more"/prev-next hand-rolled), `breadcrumb.tsx` (~1, only `PlexusDrive.tsx`; inline text crumbs elsewhere), `alert.tsx` (~1; bespoke amber/red banners S143/S155/S183/S079). Pattern-inventory "Unused-shadcn-primitive fact" + ALERTS/BREADCRUMBS/PAGINATION/RADIOS/DRAWERS rows. | `FUNCTIONAL_DUPLICATION` | Intended shared pattern re-implemented bespoke; shadcn version sits near-unused. |

### Group 3 — Overlay & navigation surfaces

| DEBT ID | Title | Evidence (files + S### IDs) | Classification | Notes |
|---|---|---|---|---|
| DEBT-013 | Multiple modal/dialog patterns for the same action | `components/ui/dialog.tsx` (55 importers) vs `alert-dialog.tsx` (1 importer, S332). Destructive confirms use Dialog in some places (S075 delete confirm) and AlertDialog in one (S332); native `window.confirm` `UNKNOWN_NEEDS_VERIFICATION`. Pattern-inventory MODALS/DIALOGS row. | `INTERACTION_DUPLICATION` | Same "confirm destructive action" built two ways (Dialog vs AlertDialog); focus/semantics differ. |
| DEBT-014 | Drawer-vs-modal / drawer-vs-sheet inconsistency | `components/ui/drawer.tsx` (0 importers) — "drawer" surfaces built on `Sheet` or bespoke slide-panels instead: `NotesPanelDrawer.tsx` (S090), `PatientJourneyDrawer.tsx` (S095), `PatientProfileDrawer.tsx` (S068), `AdminReviewAiLogicDrawer.tsx` (S124), `TaskDrawer.tsx` (S140), `CanonicalCommandCalendar` drawer mode (S109), `calendar/UniversalCalendarDrawer.tsx`. `Sheet` (S040/S043/S044/S160) also used as modal overlay. Pattern-inventory DRAWERS/SHEETS rows. | `INTERACTION_DUPLICATION` | Slide-panel behavior (direction/width/scroll-lock/focus-trap) differs; Sheet doubles as both drawer and modal. |
| DEBT-015 | Multiple filter systems | No unified filter primitive; `FilterBar` defined in 5 files (`calendar/CalendarFilterBar.tsx`, `calendar/UniversalCalendar.tsx`, `physician/engagement/PlexusEngagementPage.tsx`, `physician/finance/FinancePage.tsx`, `physician/ui/primitives.tsx`) vs `mission-control.tsx` inline filter card (S038) vs `SchedulePage.tsx` batch filter bar (S187) vs `EngagementFilterRail.tsx` (S171) vs directory chips/cooldown tiles (S058/S059). Pattern-inventory FILTERS row (note: it cites "FilterBar in 6 files"; source grep at HEAD found 5 — `UNKNOWN_NEEDS_VERIFICATION` on the 6th). | `INTERACTION_DUPLICATION` | Chip-toggle vs dropdown vs rail vs top-bar; clear-filters present in some (S186), absent in others. |
| DEBT-016 | Multiple portal shells (5) | `components/physician/ClinicianPortalShell.tsx` (S258) · `components/physician/PhysicianPortalShell.tsx` (S259, wraps S258) · `components/portal/PortalShell.tsx` · `components/portal/TeamPortalShell.tsx` (~4k lines, S213) · `features/command-center/components/CommandCenterShell.tsx`. | `FUNCTIONAL_DUPLICATION` | Five shell containers for portal/command-center surfaces; PhysicianPortalShell is a wrapper for ClinicianPortalShell. Some divergence may be persona-driven (see DEBT-018). |
| DEBT-017 | Two navigation systems (sidebar + floating dock) | `components/GlobalNav.tsx` (S002, sidebar — shown only on `/home` & `/clinician-portal` per `GLOBAL_NAV_ROUTES`) coexists with `components/navigation/GlobalFloatingDock.tsx` (S003, always mounted) + portal variant `PortalDockPanels.tsx` (S005) + `EngagementPanel.tsx` (S006). Route-map "Nav / dock visibility" section. | `INTENTIONAL_ROLE_VARIANT` | By design per route-map: sidebar only on two routes, dock everywhere; `DOCK_ITEMS` (admin/biller/technician/liaison) vs `PORTAL_DOCK_ITEMS` (scheduler/clinician), split via `PORTAL_DOCK_ROLES.has(me.role)`. Registry-driven, but two parallel nav paradigms coexist. |
| DEBT-018 | Portal role/persona shells overlap | `TeamPortalShell.tsx` drives PCS/ACS/technician/liaison personas (S213–S248) while `ClinicianPortalShell` drives the clinician portal (S258–S275); `CommandCenterShell` a third. | `INTENTIONAL_ROLE_VARIANT` | Different personas by design; flagged as related to DEBT-016. Whether the shells should share a base is a `NEEDS_USER_DECISION`-adjacent question left unclassified here. |

### Group 4 — Calendar & scheduling surfaces

| DEBT ID | Title | Evidence (files + S### IDs) | Classification | Notes |
|---|---|---|---|---|
| DEBT-019 | Multiple calendar implementations (×9 bespoke; 14 calendar files total incl. shadcn) | Verified files at HEAD: `calendar/UniversalCalendar.tsx`, `calendar/UniversalCalendarDrawer.tsx`, `calendar/views/CanonicalMonthCalendar.tsx`, `calendar/CalendarFilterBar.tsx`, `calendar/CalendarAddActionButton.tsx`, `calendar/CanonicalCalendarIcon.tsx`, `components/calendar/CanonicalCommandCalendar.tsx` (S203/S109), `components/plexus-iq/PlexusIQCalendar.tsx` (S111), `components/clinic-calendar.tsx` (`MiniCalendar`/`SlotGrid` S195/S196), `components/outreach/TriClinicCalendar.tsx` (S161), `components/portal/PatientMiniCalendar.tsx` (S251), `components/portal/leftRail/LeftRailCompactCalendar.tsx` (S252), `components/portal/CalendarQuickScheduleDialog.tsx` (S256), `features/command-center/docks/CalendarDockPopup.tsx`, plus shadcn `components/ui/calendar.tsx`. Pattern-inventory CALENDARS row; surface-inventory "Calendar primitives" cluster. | `FUNCTIONAL_DUPLICATION` | Month grid vs mini vs slot grid vs tri-clinic vs compact rail vs canonical command — day-cell styling, click-to-book vs click-to-open, and keyboard nav differ across all. Biggest single cluster. |
| DEBT-020 | Multiple booking dialogs (×4) | `components/outreach/BookingDialogs.tsx` (S162 slot/cancel/quick-book) vs `pages/appointments.tsx` inline booking dialogs (S197/S198) vs `components/portal/SchedulePatientDialog.tsx` / `CalendarQuickScheduleDialog.tsx` (S255/S256) vs `components/AppointmentModal.tsx` (S086). Surface-inventory "Booking dialogs" cluster; S162 note "Duplicate of appointments-page dialogs S224", S193 note "Dialogs duplicate S162". | `FUNCTIONAL_DUPLICATION` | Same job (book/schedule an appointment slot) via four separate dialogs; duplicate-name CONFLICT warning implemented per-dialog (S162/S358). |

### Group 5 — State surfaces (loading / empty / error / unavailable)

| DEBT ID | Title | Evidence (files + S### IDs) | Classification | Notes |
|---|---|---|---|---|
| DEBT-021 | Duplicated empty-state implementations (no shared component) | Local `EmptyState` defined in 8 files (verified at HEAD): `components/billing/CanonicalBillingPanel.tsx`, `components/patient-directory/PatientChartSections.tsx`, `components/patient-directory/PatientProfileTabs.tsx`, `components/patient/PatientJourneyDrawer.tsx`, `components/physician/ui/primitives.tsx`, `components/plexus-iq/design-prototypes/PlexusIQOperatingCanvasPrototype.tsx`, `components/portal/CaseOverview.tsx`, `pages/team-ops.tsx`; plus inline "No … yet" copy (S341–S346). Pattern-inventory EMPTY STATES row. | `FUNCTIONAL_DUPLICATION` | Eight separate `EmptyState` definitions; no shared announced (`role=status`) empty component (a11y observation in component inventory). |
| DEBT-022 | Duplicated error-state implementations | Local `ErrorState` def + inline AlertCircle patterns (S347–S351): `not-found.tsx` (S008), `admin-settings-center.tsx` "Failed to load admin settings." (S350), `AccessDeniedSection` (S348), `PlexusIQOperatingRow` "Save failed" badge (S351), toast-only errors. Pattern-inventory ERROR STATES row. | `FUNCTIONAL_DUPLICATION` | Error surfaced as 404 card vs inline AlertCircle vs toast vs badge; retry offered inconsistently; no shared announced (`role=alert`) error component. |
| DEBT-023 | Duplicated loading/skeleton implementations | shadcn `skeleton.tsx` (6 importers) vs inline `animate-pulse` divs vs `Loader2`/`RefreshCw` spinners vs "Loading…" text; `PatientChartSkeleton`/`SectionSkeleton` (S337), full-screen spinner (S009/S335), per-surface S336–S340. Pattern-inventory LOADING/SKELETON row. | `FUNCTIONAL_DUPLICATION` | Skeleton vs spinner vs text; most spinners lack `aria-busy`/`aria-live`. |

### Group 6 — Finance / billing / invoice views

| DEBT ID | Title | Evidence (files + S### IDs) | Classification | Notes |
|---|---|---|---|---|
| DEBT-024 | Legacy vs canonical clinician-portal workspaces (flag-toggled pairs) | `components/physician/finance/FinancePage.tsx` exports `FinancePage`/`LegacyFinancePage` (S261) · `orders/OrdersNotesPage.tsx` `OrdersNotesPage`/`LegacyOrdersNotesPage` (S262) · `engagement/PlexusEngagementPage.tsx` `PlexusEngagementPage`/`Legacy...` (S263) paired against `canonical/CanonicalFinancePage.tsx` (S265), `CanonicalOrdersNotesPage.tsx` (S266), `CanonicalEngagementPage.tsx` (S267). Gated by `VITE_FEATURE_CLINICIAN_PORTAL_CANONICAL_DATA`. Surface-inventory "Canonical vs legacy pairs"; S261–S263 note. | `LEGACY_ARTIFACT` | Explicit `Legacy*` components kept alongside `Canonical*` twins under a feature flag. |
| DEBT-025 | Duplicate finance / invoice views across billing pages | `pages/billing.tsx` (S291/S292/S293) · `pages/invoices.tsx` (S297–S301) · `components/billing/CanonicalBillingPanel.tsx` (S294) · `components/billing/InvoiceFinancialPanel.tsx` (S307, reused by S300 detail + S327 remittance audit) · portal `InvoiceDeskPanel.tsx` (S308 mock) / `InvoiceDraftPanel.tsx` (S309 placeholder). `BillingOverview` symbol reused across billing & invoices (S292/S298). | `FUNCTIONAL_DUPLICATION` | Overlapping billing/invoice/audit finance surfaces; `InvoiceFinancialPanel` (S307) shared, but overview/records/panel layouts duplicated across pages and portal. |
| DEBT-026 | Canonical vs legacy document/notes surfaces | `pages/documents.tsx` legacy note browser (S276/S277) vs `components/ancillary-documents/CanonicalAncillaryDocuments.tsx` canonical list (S279), gated by `VITE_FEATURE_UNIFIED_ANCILLARY_DOCUMENTS`. Surface-inventory "Canonical vs legacy pairs" (S276 vs S279). Call-result write also has legacy+canonical dual-write (S160). | `LEGACY_ARTIFACT` | Legacy facility→date→patient→service note browser kept alongside canonical keyset-paginated docs list under flag. |

### Group 7 — Preview, playground, prototype & unreachable surfaces

| DEBT ID | Title | Evidence (files + S### IDs) | Classification | Notes |
|---|---|---|---|---|
| DEBT-027 | Preview twin of Home (redesign copy) | `pages/home-preview.tsx` (S032, RT006 PREVIEW) + `components/HomeDashboardPreview.tsx` (S033, preview of S012) + `components/HomeLiveDashboardPreview.tsx` (S034, preview of S018). Route-map RT006 status PREVIEW. | `PREVIEW_ARTIFACT` | Parallel navy/slate redesign copies of Home surfaces; reachable only by direct `/home-preview` URL, not in nav. |
| DEBT-028 | Playground / prototype routes (7 PLAYGROUND + 1 PREVIEW) | Route-map PLAYGROUND rows: RT008 `/imaging-central` (S045–S050 mock), RT011/RT012 `/clinic-analytics` & `/analytics` (S051/S052 mock), RT013 `/clinic-onboarding` (S053/S054 demo), RT028 `/clinic-workflow-demo` (S055), RT040 `/clinical-intelligence` (S132 localStorage), RT041 `/plexus-iq-prototype` (S133/S134 mock); + RT006 PREVIEW `/home-preview`. Plus `components/plexus-iq/design-prototypes/PlexusIQOperatingCanvasPrototype.tsx` (S134). | `PREVIEW_ARTIFACT` | Design prototypes/demos routed and reachable but not wired to production backend (mock/localStorage per route map). Classified together as preview/prototype artifacts; several overlap the mock-data finding (DEBT-029). |
| DEBT-029 | Mock/localStorage-backed surfaces still reachable | `pages/plexus-iq-prototype.tsx` (S133, mock), `pages/plexus-bank.tsx` (S135, localStorage-backed prototype, RT049 AdminGuard), `pages/clinical-intelligence.tsx` (S132, localStorage; `FEATURE_CLINICAL_INTELLIGENCE_LIVE` OFF per `PHASE_2L_FUNCTIONAL_FREEZE.md` L255); `components/portal/InvoiceDeskPanel.tsx` (S308) & Plexus Bank mock (`usePlexusBank`). Verified: grep for `localStorage`/`mock` hits all three named pages. | `NEEDS_USER_DECISION` | Reachable in production routing but no server persistence (freeze doc confirms Clinical Intelligence stays client-only). Whether these are intentional demos or debt is not determinable from source. |
| DEBT-030 | Unreachable / orphan page components (5) | Route-map "Potential orphan pages": `pages/plexus.tsx`, `pages/admin-ops.tsx`, `pages/task-brain.tsx`, `pages/drive.tsx`, `pages/patient-directory-live.tsx` — each `DEAD_OR_UNREACHABLE` (no `<Route>` target, not a redirect target, 0 importers outside self). Related surfaces S131 (plexus wizard), S288/S289 (drive), S070 (directory-live wrapper), S329 (admin-ops). | `POSSIBLE_DEAD_CODE` | Page files exist but are not reachable per route-map grep evidence; note their *routes* redirect elsewhere (e.g. `/plexus`→`/ancillary-documents`) so the page component itself never renders. |

### Group 8 — Header, spacing & typography consistency

| DEBT ID | Title | Evidence (files + S### IDs) | Classification | Notes |
|---|---|---|---|---|
| DEBT-031 | Inconsistent page headers (shared PageHeader vs inline) | `components/PageHeader.tsx` (S031, used in 22 files) vs inline headers in `mission-control.tsx` (S036), portal shells, billing pages, admin hub. Pattern-inventory PAGE HEADERS row. | `VISUAL_DUPLICATION` | Shared PageHeader coexists with bespoke title rows; back-button placement, action-slot styling, and heading levels vary. |
| DEBT-032 | Inconsistent spacing / typography (two visual systems) | Component-inventory global snapshot: shadcn-tokenized surfaces vs Tailwind-literal bespoke surfaces (BUTTONS row "Two visual systems: shadcn tokenized vs Tailwind-literal"); bespoke cards differ in padding/radius/shadow (CARDS row); preview pages use a distinct navy/slate palette (S032–S034). | `VISUAL_DUPLICATION` | No single spacing/type scale is enforced across shadcn and hand-rolled surfaces; `UNKNOWN_NEEDS_VERIFICATION` on exact token divergence (not measured token-by-token in this pass). |
| DEBT-033 | Multiple side-rail / section-nav implementations | `components/ui/sidebar.tsx` (via `SidebarProvider`) vs scheduler left icon rail (S148 `RailIcon`) vs chart section nav rail (S064) vs tool dock rail (S221) vs left-rail calendar (S252). Pattern-inventory SIDE RAILS row. | `VISUAL_DUPLICATION` | App sidebar vs icon rail vs section-nav rail differ in width, icon treatment, and collapse behavior. |

---

## Classification tally

| Classification | Count | DEBT IDs |
|---|---|---|
| `FUNCTIONAL_DUPLICATION` | 10 | DEBT-002, DEBT-003, DEBT-012, DEBT-016, DEBT-019, DEBT-020, DEBT-021, DEBT-022, DEBT-023, DEBT-025 |
| `VISUAL_DUPLICATION` | 10 | DEBT-001, DEBT-005, DEBT-006, DEBT-007, DEBT-009, DEBT-010, DEBT-011, DEBT-031, DEBT-032, DEBT-033 |
| `INTERACTION_DUPLICATION` | 5 | DEBT-004, DEBT-008, DEBT-013, DEBT-014, DEBT-015 |
| `LEGACY_ARTIFACT` | 2 | DEBT-024, DEBT-026 |
| `PREVIEW_ARTIFACT` | 2 | DEBT-027, DEBT-028 |
| `POSSIBLE_DEAD_CODE` | 1 | DEBT-030 |
| `INTENTIONAL_ROLE_VARIANT` | 2 | DEBT-017, DEBT-018 |
| `NEEDS_USER_DECISION` | 1 | DEBT-029 |

Sum = 10 + 10 + 5 + 2 + 2 + 1 + 2 + 1 = **33**. ✔ **Total findings: 33 (DEBT-001 … DEBT-033).**

**Biggest duplication clusters (by count):**
1. Calendars — **9 bespoke implementations** (14 calendar files incl. shadcn) — DEBT-019.
2. Patient-search — **5** components — DEBT-002.
3. Portal shells — **5** — DEBT-016.
4. Booking dialogs — **4** — DEBT-020.
5. Patient headers — **≥4** — DEBT-001.
6. Empty-state defs — **8** local definitions — DEBT-021.

---

## Verification log (spot-checks performed against source at HEAD 08a78978)

| Cluster | Command basis | Result |
|---|---|---|
| Calendar files | `find client/src -iname '*calendar*.tsx'` | 14 files found; 13 bespoke + `components/ui/calendar.tsx` — matches pattern-inventory CALENDARS row. |
| Patient-search components | `test -f` on 4 cited files | All present (`PatientDirectoryView.tsx`, `PortalPatientSearchTab.tsx`, `PortalDockPanels.tsx`, `PopupPatientPicker.tsx`). |
| Portal shells | `find client/src -iname '*shell*.tsx'` | 5 shells present. |
| Finance legacy/canonical | `ls physician/finance physician/canonical` | `FinancePage.tsx` (holds `LegacyFinancePage`) + `CanonicalFinancePage.tsx`/`CanonicalOrdersNotesPage.tsx`/`CanonicalEngagementPage.tsx` present. |
| Local `EmptyState` defs | `grep -rln 'function EmptyState\|const EmptyState'` | 8 files — matches pattern-inventory EMPTY STATES row. |
| Mock/localStorage prototypes | `grep -c 'localStorage\|mock'` on 3 pages | Non-zero in `plexus-iq-prototype.tsx`, `plexus-bank.tsx`, `clinical-intelligence.tsx`; freeze doc L255 confirms Clinical Intelligence localStorage-only. |
| `FilterBar` defs | `grep -rln FilterBar` | 5 files found at HEAD (pattern inventory cites 6 → 6th marked `UNKNOWN_NEEDS_VERIFICATION`). |

**Known deltas / caveats:**
- Pattern-inventory FILTERS row cites "FilterBar in 6 files"; source grep at this HEAD returned 5 (`UNKNOWN_NEEDS_VERIFICATION` on the discrepancy).
- Booking-dialog note in surface inventory references S224 as a duplicate target of S162; this map treats S197/S198/S255/S256/S086 as the confirmed booking-dialog set (S224 cross-reference `UNKNOWN_NEEDS_VERIFICATION`).
- Exact typography/spacing token divergence (DEBT-032) was not measured token-by-token; classified from the two-visual-systems observation only.
