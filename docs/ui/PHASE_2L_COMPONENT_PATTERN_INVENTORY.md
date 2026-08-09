# Phase 2L — Component / Pattern Inventory

**Status:** Documentation-only. No application source was created, edited, or deleted to produce this document.
**Repository HEAD:** `08a78978` (branch `phase/2l-ui-discovery`).
**Scope:** A factual catalog of repeated visual/interaction primitives in the client SPA (`client/src`), comparing the shared shadcn primitive (`client/src/components/ui/*`) against bespoke re-implementations. This is an inventory, not a design review. Nothing here is standardized, removed, or fixed. Standardization candidates are **labeled only**. Where a fact could not be confirmed from source it is marked `UNKNOWN_NEEDS_VERIFICATION`.

**Companion docs (read first, IDs reused):**
- `docs/ui/PHASE_2L_SURFACE_INVENTORY.md` — surfaces `S001–S361`.
- `docs/ui/PHASE_2L_ROUTE_ROLE_MAP.md` — routes `RT001–RT072`, orphan pages.

## Method

Counts are file-level (`rg -l …`, number of distinct files) unless noted. "Shared primitive importers" counts files importing the shadcn primitive from `@/components/ui/<name>`. "Bespoke" counts files that use a native/hand-rolled equivalent instead, with `client/src/components/ui/**` excluded from bespoke greps. Representative grep recipes are given per row. All paths below are relative to `client/src/` unless absolute.

Repo scale for context: `find client/src -name '*.tsx'` → **340** `.tsx` files.

### Global primitive-usage snapshot (file counts)

| Primitive | shadcn file | Shared importers | Bespoke / native re-impl | Grep basis |
|---|---|---|---|---|
| Button | `components/ui/button.tsx` | 146 | 150 files use raw `<button>` (outside `ui/`) | `rg -l '@/components/ui/button"'` vs `rg -l '<button' --glob '!components/ui/**'` |
| Input | `components/ui/input.tsx` | 76 | 14 files use raw `<input …>` | `rg -l '@/components/ui/input"'` vs `rg -l '<input '` |
| Select | `components/ui/select.tsx` | 42 | 20 files use native `<select>` | `rg -l '@/components/ui/select"'` vs `rg -l '<select'` |
| Checkbox | `components/ui/checkbox.tsx` | 11 | 9 files use `type="checkbox"` | `rg -l '@/components/ui/checkbox"'` vs `rg -l 'type="checkbox"'` |
| Radio | `components/ui/radio-group.tsx` | **0** | 1 file uses `type="radio"` | `rg -l 'ui/radio-group'` → 0 |
| Table | `components/ui/table.tsx` | 6 | 26 files use raw `<table>` | `rg -l '@/components/ui/table"'` vs `rg -l '<table'` |
| Card | `components/ui/card.tsx` | 89 | many bespoke card `<div>`s (not counted individually) | `rg -l '@/components/ui/card"'` |
| Badge | `components/ui/badge.tsx` | 73 | `StatusPill` in 11 files (physician primitives) | `rg -l '@/components/ui/badge"'`, `rg -l 'StatusPill'` |
| Tabs | `components/ui/tabs.tsx` | 12 (`<Tabs`) / 12 (`TabsList`) | many `activeTab`/`activeSection` button-strip tabs | `rg -l '<Tabs'` vs `rg -l 'activeTab'` (8) + `activeSection` (2) |
| Dialog | `components/ui/dialog.tsx` | 55 | — | `rg -l '@/components/ui/dialog"'` |
| Sheet | `components/ui/sheet.tsx` | 12 | — | `rg -l '@/components/ui/sheet"'` |
| Drawer | `components/ui/drawer.tsx` | **0** | `Sheet`/`Dialog` used for drawer-like surfaces instead | `rg -l 'ui/drawer'` → 0 |
| Popover | `components/ui/popover.tsx` | 19 | — | `rg -l '@/components/ui/popover"'` |
| Tooltip | `components/ui/tooltip.tsx` | 5 | — | `rg -l '@/components/ui/tooltip"'` |
| Alert-dialog | `components/ui/alert-dialog.tsx` | 1 | native `window.confirm`/inline confirm dialogs elsewhere (`UNKNOWN_NEEDS_VERIFICATION` count) | `rg -l '@/components/ui/alert-dialog"'` |
| Alert | `components/ui/alert.tsx` | **~1** | bespoke amber/red banner `<div>`s (e.g. S143, S155, S183) | `rg -l 'from "@/components/ui/alert"'` → 0 exact / 1 path-substring |
| Skeleton | `components/ui/skeleton.tsx` | 6 | inline skeleton `<div className="animate-pulse">` in many files | `rg -l '@/components/ui/skeleton"'` |
| Breadcrumb | `components/ui/breadcrumb.tsx` | **~1** (`PlexusDrive.tsx` only) | inline "A / B / C" text crumbs elsewhere | `rg -l '<Breadcrumb'` → 1 |
| Pagination | `components/ui/pagination.tsx` | **0** | keyset "Load more" / prev-next buttons hand-rolled | `rg -l 'ui/pagination'` → 0 |
| Toast | `components/ui/toast.tsx` + `toaster.tsx` | `useToast` in 98 files | — (single shared system) | `rg -l 'useToast'` |
| Command (cmdk) | `components/ui/command.tsx` | 1 importer; `<Command` used in 15 files | — | `rg -l 'ui/command'` (1) / `rg -l '<Command'` (15) |

> **Unused-shadcn-primitive fact:** `radio-group`, `drawer`, `breadcrumb`, `pagination`, and (near-)`alert` primitives exist in `components/ui/` but have 0–1 importers. Their intended patterns are re-implemented bespoke elsewhere. See DEBT map for classification.

---

## Per-pattern detail

Table columns: **Pattern | # impl | Shared primitive file | Bespoke implementations (files) | Variants | Visual inconsistencies | Interaction inconsistencies | A11y concerns (static) | Standardization candidate (LABEL ONLY)**.

### BUTTONS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| shared 146 files / bespoke 150 files | `components/ui/button.tsx` (`buttonVariants`: default/destructive/outline/secondary/ghost/link; sizes sm/lg/icon) | 150 files with raw `<button>` (icon rails e.g. `pages/outreach-scheduler-portal.tsx` `RailIcon`; `PlexusDrive.tsx`; many dashboard tiles) | `Button` variant/size matrix vs ad-hoc `className` buttons; `SecondaryTile`/`ClinicianPortalTile` clickable cards (S016/S017) | Two visual systems: shadcn tokenized vs Tailwind-literal buttons | Some bespoke buttons lack `disabled`/pending styling that `Button` provides; loading state hand-rolled per site | Raw `<button>` frequently icon-only; `aria-label` present in only 58 files repo-wide; icon rails rely on tooltips not labels | **Yes** — largest primitive split |

### INPUTS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| shared 76 / bespoke 14 | `components/ui/input.tsx` | 14 files raw `<input>` | `Input` vs raw text inputs; `textarea.tsx` separate | Focus ring/border differ between `Input` and raw inputs | Debounce/validation handled per-site | Raw inputs sometimes without associated `<Label htmlFor>` (`label.tsx` exists but pairing not enforced) | Yes (low volume) |

### SELECTS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| shared 42 / native 20 | `components/ui/select.tsx` (Radix) | 20 files native `<select>` | Radix Select vs native `<select>` vs `DropdownMenu`-as-select | Native selects render OS-styled, Radix selects app-styled — visibly different | Keyboard/typeahead differs (Radix custom vs native) | Native `<select>` keyboard-accessible by default; Radix relies on library ARIA | **Yes** — mixed select systems |

### CHECKBOXES
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| shared 11 / native 9 | `components/ui/checkbox.tsx` (Radix) | 9 files `type="checkbox"` | Radix Checkbox vs native | Native vs styled check differ | — | Native checkboxes lack visible focus consistency w/ Radix ones | Yes (low volume) |

### RADIOS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| shared 0 / native 1 | `components/ui/radio-group.tsx` (present, **0 importers**) | 1 file `type="radio"`; radio-like choices often built with toggle buttons/`ToggleGroup` | Segmented-button "radios" vs native radio | — | Toggle-button single-select doesn't announce as radiogroup | Bespoke single-select via buttons has no `role="radiogroup"` | Yes — primitive unused |

### DATE PICKERS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| multiple | `components/ui/calendar.tsx` (react-day-picker) | Date entry also via native `<input type="date">`, `Popover`+`Calendar`, and per-calendar day-cell pickers (see CALENDARS row) | Popover-calendar (e.g. New Schedule Dialog S025) vs native date input vs custom month grids | Day-cell styling differs across calendar implementations | Some pickers commit on click, others require confirm | Day grids: some cells are `<div onClick>` not `<button>` (`UNKNOWN_NEEDS_VERIFICATION` per calendar) | **Yes** — tied to CALENDARS cluster |

### SEARCH
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| ≥5 patient-search UIs | none dedicated; `components/ui/command.tsx` (cmdk) available | `PatientDirectoryView` (S028), `mission-control.tsx` search sheet (S043), `PortalPatientSearchTab` (S235), `patient-database.tsx` roster rail (S057), dock `PortalDockPanels` search (S005), `features/command-center/components/PopupPatientPicker.tsx` | Input-in-sheet vs inline rail vs cmdk-style picker | Result-row layout differs per surface | Debounce, min-chars, empty-copy differ per site | Some result lists are clickable `<div>`s; empty/error copy inconsistent | **Yes** — patient search ×5+ (see DEBT-002) |

### FILTERS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| many | none unified; `FilterBar` defined in 6 files; `CalendarFilterBar.tsx` | `mission-control.tsx` inline filter card (S038), `SchedulePage.tsx` batch filter bar (S187), `EngagementFilterRail.tsx` (S171), directory chips/cooldown tiles (S058/S059), physician `FilterBar` primitive (S275) | Chip-toggle vs dropdown vs rail vs segmented | Filter chrome differs (rail vs top bar vs chips) | Clear-filters present in some (S186) not others | Chip toggles sometimes non-button | **Yes** — multiple filter systems (DEBT-008) |

### TABLES
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| shared 6 / raw 26 + physician DataTable | `components/ui/table.tsx` | 26 files raw `<table>`; `components/physician/ui/DataTable.tsx` (generic sortable, 4 files); many CSS-grid "tables" (Operating Row S102, Imaging tables S047/S048, MC lanes S039) | shadcn `Table` vs raw `<table>` vs `DataTable` vs grid-div rows | Header/zebra/border styling varies widely | Sorting/selection/sticky-header hand-rolled per table | Grid-div "rows" lack `role="row"`/`role="cell"`; raw tables may miss `<th scope>` | **Yes** — ≥3 table systems (DEBT-003) |

### CARDS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| 89 importers + many bespoke | `components/ui/card.tsx` (Card/Header/Title/Content/Footer) | Bespoke card `<div className="rounded border …">` throughout; `PatientCard.tsx` (S081), `PatientDirectoryFactsCard.tsx` (S253), portal StatCard/`primitives.tsx` (S275), preview cards (S033/S034) | shadcn Card vs literal-div card; StatCard metric variant | Padding/radius/shadow differ between shadcn and bespoke | Clickable cards vs static cards inconsistent | Clickable cards sometimes `<div onClick>` not button/link | Yes |

### TILES
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| many | none | `SecondaryTile`/`ClinicianPortalTile` (S016/S017), `ScheduleTile` (S024), Mission Control `SPINE_CARDS` (S037), Imaging spine cards (S046), Engagement baskets (S182), preview tiles | Dashboard tile vs metric tile vs nav tile | Tile sizes/colors differ per dashboard | Some tiles navigate, some open panels | Clickable tiles as `<div>` | Yes |

### TABS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| shadcn 12 / bespoke button-strips ~8+ | `components/ui/tabs.tsx` (Radix) | Home view-mode tabs (`pages/home.tsx`), admin `activeSection` hash tabs (`admin-settings.tsx`), engagement view switcher (S168), scheduler playfield tab strip (S149), portal mode switcher (S214) | Radix Tabs vs URL/hash tabs vs button-strip vs pill nav | Underline vs pill vs segmented styling | Radix roving-tabindex vs plain buttons; deep-link (hash/query) only on some | Bespoke tab strips: only 2 files use `role="tab"`; most lack tablist ARIA | **Yes** — mixed tab systems |

### BADGES
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| shared 73 | `components/ui/badge.tsx` | color-literal `<span>` badges; `DuplicateWarningBadge` (S077) | Badge variants vs literal spans | Palette differs (see STATUS CHIPS) | mostly non-interactive | badge-as-button (S077 → audit) not always a button | Yes |

### STATUS CHIPS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| ≥3 vocabularies | `Badge`; `StatusPill` (physician `primitives.tsx`, 11 files) | `StatusPill` vs `Badge` vs inline colored spans; stage vectors (`StageVectorView` S219) with `available`/`upstream_flag_off`/`unavailable`/`migration_missing` | Pill vs badge vs dot; per-domain status words | Status color→meaning mapping not centralized | mostly static | Color-only status without text label in some dot indicators | **Yes** — duplicate status vocab (DEBT-004) |

### PAGE HEADERS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| shared `PageHeader` in 22 files + many inline | `components/PageHeader.tsx` (S031; light/dark) | Inline headers in `mission-control.tsx` (S036), portal shells, billing pages, admin hub | Shared PageHeader vs bespoke title rows | Back-button placement, action-slot styling vary | Back nav present in some inline headers, absent in others | Heading levels not consistently `<h1>` | **Yes** — inconsistent page headers (DEBT-007) |

### PATIENT HEADERS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| ≥4 | none unified | `PatientProfileHeader.tsx` (S063 sticky), `PatientProfileDrawer` header (S068), `PatientDirectoryFactsCard.tsx` (S253 portal), `PatientCard.tsx` (S081), `BatchHeader.tsx`/`PlexusIQActiveBatchHeader.tsx` (batch context) | Sticky chart header vs drawer header vs portal facts card vs qualification card | Demographic layout, badge set, quick-actions differ | Quick-action sets differ per header | Avatar via `PatientSilhouette` (SVG, non-interactive) consistent; header actions vary | **Yes** — duplicate patient headers (DEBT-001) |

### SIDE RAILS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| several | `components/ui/sidebar.tsx` (used via `SidebarProvider`) | Scheduler left icon rail (S148 `RailIcon`), chart section nav rail (S064), tool dock rail (S221), left-rail calendar (S252) | App sidebar vs icon rail vs section nav rail | Width/icon treatment differ | Collapse behavior differs | Icon-only rail buttons rely on tooltip, not `aria-label` | Yes |

### LEFT NAV
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| 1 primary + registry | `components/GlobalNav.tsx` (S002) | — | Collapsible left nav w/ badge counts | Shown only on `/home`,`/clinician-portal` (`GLOBAL_NAV_ROUTES`) | Role-filtered items | badge counts announced? `UNKNOWN_NEEDS_VERIFICATION` | Maybe (works, see DEBT-011 nav systems) |

### TOP NAV
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| 1 | `components/TopBanner.tsx` (S001) | — | Animated dark banner: logo/role/home/logout | Always-on auth shell | logout must POST then clear cache (must-not-change) | — | No (single impl) |

### FLOATING DOCK
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| 1 + portal variant | `components/navigation/GlobalFloatingDock.tsx` (S003) | Portal dock panels `PortalDockPanels.tsx` (S005); `EngagementPanel.tsx` (S006); `features/command-center/docks/CalendarDockPopup.tsx` | `DOCK_ITEMS` (admin/biller/technician/liaison) vs `PORTAL_DOCK_ITEMS` (scheduler/clinician); split via `PORTAL_DOCK_ROLES.has(me.role)` | dock link vs panel items | Chat item disabled (`CHAT_ROUTE_AVAILABLE=false`) | Dock buttons: `aria-label` `UNKNOWN_NEEDS_VERIFICATION` | Partial (registry-driven) |

### DRAWERS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| several, but not via `drawer.tsx` | `components/ui/drawer.tsx` (**0 importers**) + `components/ui/sheet.tsx` | `NotesPanelDrawer.tsx` (S090), `PatientJourneyDrawer.tsx` (S095), `PatientProfileDrawer.tsx` (S068), `AdminReviewAiLogicDrawer.tsx` (S124), `TaskDrawer.tsx` (S140), `CanonicalCommandCalendar` drawer mode (S109), `calendar/UniversalCalendarDrawer.tsx` | "Drawer" surfaces built on `Sheet` or bespoke slide-panels, not the vaul `Drawer` | Slide direction/width differ | Some drawers block scroll, some don't | Focus trap inconsistent between Sheet-drawers and bespoke ones | **Yes** — drawer vs sheet inconsistency (DEBT-006) |

### SHEETS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| shared 12 | `components/ui/sheet.tsx` | Mission Control lane/search/chat sheets (S040/S043/S044), disposition sheet (S160) | Side sheet used both as "drawer" and as "modal overlay" | side/size vary | overlaps DRAWERS usage | Radix-provided focus mgmt | Overlaps DRAWERS — see DEBT-006 |

### MODALS / DIALOGS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| shared 55 `Dialog` / 1 `AlertDialog` | `components/ui/dialog.tsx`, `alert-dialog.tsx` | Confirmations via `Dialog` (S075 delete confirm), `AlertDialog` (S332), and possibly native confirm (`UNKNOWN_NEEDS_VERIFICATION`) | Dialog vs AlertDialog vs Sheet-as-modal (S043) | Booking/scheduling dialogs ×4 (S086/S162/S197-198/S255-256) | Confirm-destructive uses Dialog in some, AlertDialog in one | Some destructive confirms are plain Dialog not AlertDialog | **Yes** — multiple modal patterns (DEBT-005) |

### POPOVERS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| shared 19 | `components/ui/popover.tsx`; `hover-card.tsx` | Metric popovers (S019), day popover (S015), calendar filter dropdown (S014 via DropdownMenu), run selector (S117) | Popover vs HoverCard vs DropdownMenu for similar overlays | trigger/arrow styling differ | click vs hover trigger differs | HoverCard content not keyboard-reachable | Yes (low priority) |

### TOOLTIPS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| shared 5 | `components/ui/tooltip.tsx` | `title=` attributes elsewhere (`UNKNOWN` count) | Radix Tooltip vs native `title` | delay/positioning differ | Radix keyboard-focus vs native hover-only | Icon buttons relying on `title` not focusable-tooltip | Yes |

### BREADCRUMBS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| ~1 | `components/ui/breadcrumb.tsx` (used only in `PlexusDrive.tsx`) | Inline "A / B / C" text crumbs, and facility→date→patient→service nesting shown as collapsible groups (S276) rather than breadcrumbs | Real breadcrumb (drive) vs inline text | — | Drive breadcrumb clickable; text crumbs static | Inline crumbs not `nav[aria-label=breadcrumb]` | **Yes** — primitive nearly unused |

### PAGINATION
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| 0 shared | `components/ui/pagination.tsx` (**0 importers**) | Keyset/infinite "Load more" (canonical docs S279 `/infinite`), activity-feed paging (S185), prev/next buttons | Load-more vs cursor vs prev/next | Button styling per site | infinite scroll vs explicit page | No pagination landmark; "Load more" buttons vary | **Yes** — primitive unused |

### EMPTY STATES
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| ≥8 local defs | **none shared** | Local `EmptyState` defined in 8 files: `team-ops.tsx`, `CanonicalBillingPanel.tsx`, `PatientProfileTabs.tsx`, `PatientChartSections.tsx`, `CaseOverview.tsx`, `PatientJourneyDrawer.tsx`, `physician/ui/primitives.tsx`, `PlexusIQOperatingCanvasPrototype.tsx`; plus inline "No … yet" copy everywhere (S341–S346) | icon+title+subtext vs plain text vs card | Copy tone/format differs per surface | Some empties offer a CTA, most don't | Empty copy not `role=status`/announced | **Yes** — multiple empty patterns (DEBT-013) |

### ERROR STATES
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| ≥1 local `ErrorState` + inline | **none shared** | 1 local `ErrorState` def; inline AlertCircle patterns (S347–S351): `not-found.tsx`, `admin-settings-center.tsx` "Failed to load admin settings.", `AccessDeniedSection` (S348), toast-only errors (S351) | 404 card vs inline AlertCircle vs toast vs "Save failed" badge | Retry offered in some, not others | error surfaced as toast vs inline vs badge inconsistently | error text not always `role=alert` | **Yes** — multiple error patterns (DEBT-013) |

### LOADING / SKELETON STATES
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| shared skeleton 6 files; ≥1 `LoadingState` | `components/ui/skeleton.tsx` | inline `animate-pulse` divs; `Loader2`/`RefreshCw` spinners; `PatientChartSkeleton`/`SectionSkeleton` (S337); full-screen spinner (S009); per-surface (S335–S340) | Skeleton vs spinner vs "Loading…" text | shimmer vs spin vs text | some block UI, some inline | spinners lack `aria-busy`/`aria-live` in most | **Yes** — mixed loading patterns (DEBT-013) |

### ALERTS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| shared alert ~1 | `components/ui/alert.tsx` (near-unused) | Bespoke amber/red banners: uncovered-clinics warning (S143), duplicate banners (S155/S183/S079), engagement handoff bar | shadcn Alert vs literal colored banner | palette/icon inconsistent | dismiss vs persistent differ | banners not `role=alert`/`role=status` | **Yes** — primitive under-used |

### TOASTS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| 1 system, 98 callers | `components/ui/toast.tsx` + `toaster.tsx`; `useToast` (98 files) | — (single system) | default/destructive variants | success vs error toast copy varies | consistent API | Radix toast has live-region | No (single impl) — good baseline |

### METRICS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| many | `StatCard` (physician primitives, 7 files) | Practice Pulse (S018/S034), MC metric sections (S042), outreach metrics strip (S142), floating metrics tile (S151), daily targets (S152), engagement summary strip (S170) | StatCard vs KPI strip vs metric section vs floating tile | number/label layout differ | some metrics click to breakdown (S019), some static | `sourceMissing`→"N/A" handling varies | **Yes** — metric card variants |

### TIMELINES
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| several | none | `CommunicationTimeline.tsx` (S093), patient call history (S249), call-list timelines (S154), audit trail (S076), StepTimeline wizard (S088) | comms timeline vs call-attempt timeline vs step wizard | dot/line styling differ | expand/collapse differs | timeline items ordering announced? no | Yes |

### ACTIVITY FEEDS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| ≥2 | none | Engagement team-metrics feed (S185, paginated), distribution live feed (S177) | paginated feed vs live poll feed | row layout differs | pagination vs live-poll | live updates not announced (`aria-live`) | Yes |

### CALENDARS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| **≥13 calendar files** | `components/ui/calendar.tsx` (react-day-picker) + `calendar/views/CanonicalMonthCalendar.tsx` | `calendar/UniversalCalendar.tsx`, `calendar/UniversalCalendarDrawer.tsx`, `calendar/CalendarFilterBar.tsx`, `calendar/CalendarAddActionButton.tsx`, `calendar/CanonicalCalendarIcon.tsx`, `components/calendar/CanonicalCommandCalendar.tsx` (S203/S109), `components/plexus-iq/PlexusIQCalendar.tsx` (S111), `components/clinic-calendar.tsx` (`MiniCalendar`/`SlotGrid` S195/S196), `components/outreach/TriClinicCalendar.tsx` (S161), `components/portal/PatientMiniCalendar.tsx` (S251), `components/portal/leftRail/LeftRailCompactCalendar.tsx` (S252), `components/portal/CalendarQuickScheduleDialog.tsx` (S256), `features/command-center/docks/CalendarDockPopup.tsx` | month grid vs mini vs slot grid vs tri-clinic vs compact rail vs canonical command | day-cell size/color/status-dot styling differ across all | click-to-book vs click-to-open-day vs assign-unscheduled differ | Day cells: some `<div onClick>` not `<button>`; keyboard nav inconsistent | **Yes** — calendars ×13 files (DEBT-009, biggest cluster) |

### WORK QUEUES
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| many | none | MC operational lanes (S039), imaging work queue (S047), engagement worklist (S172), call list panel (S154), billing readiness/delivery queues (S295/S305), portal work-queue composition (S215), queue filter tabs (S231) | table-lane vs card-row vs list-row queues | row density/status styling differ | bulk-action toolbars in some (S174), not others | grid-row queues lack table semantics | **Yes** — overlaps TABLES/FILTERS |

### COMMAND BARS
| # impl | Shared primitive | Bespoke | Variants | Visual | Interaction | A11y | Std candidate |
|---|---|---|---|---|---|---|---|
| cmdk 1 importer / `<Command` 15 files | `components/ui/command.tsx` (cmdk) | Mission Control command bar concept (spine + search/chat triggers, S036); `PopupPatientPicker.tsx`; scheduler mission-control bar (S159, action buttons) | cmdk palette vs action-button bar | palette vs button-bar visuals | keyboard palette vs mouse bar | cmdk keyboard-first; button bars mouse-oriented | Yes |

---

## Accessibility observations (static, repo-wide)

- `aria-label` appears in **58** of 340 `.tsx` files; many icon-only buttons (150 files use raw `<button>`) rely on tooltips/`title` instead.
- `role="button"` appears in **6** files and `role="tab"` in **2** — bespoke clickables/tab strips largely lack ARIA roles.
- `<div onClick>` clickables appear in **7** files (grep `<div[^>]*onClick`); broader `onClick` usage spans 207 files (mix of buttons and divs — not all are non-button clickables).
- No shared, announced (`role=status`/`role=alert`/`aria-live`) Empty/Error/Loading component exists; state surfaces are hand-rolled per domain (see companion inventory §State-pattern surfaces, S335–S361).

## Pattern count

**34 patterns** inventoried (the full list requested), each with shared-vs-bespoke counts and standardization labels. Standardization is **labeled only** — no changes were made.
