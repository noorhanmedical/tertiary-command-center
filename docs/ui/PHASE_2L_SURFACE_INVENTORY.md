# Phase 2L — UI Surface Inventory

**Status:** Documentation-only. No application source was created, edited, or deleted to produce this document.
**Repository HEAD:** `08a78978` (branch `phase/2l-ui-discovery`).
**Scope:** A factual map of every distinct user-interaction *surface* in the client SPA (`client/src`). This is a mapping, not a design review — no redesign recommendations, no decisions. Where a fact could not be confirmed from source it is marked `UNKNOWN_NEEDS_VERIFICATION`.

## What a "surface" means here

A surface is any distinct user-interaction unit, not just a route: PAGE, TAB, PANEL, DRAWER, SHEET, MODAL/DIALOG, POPOVER, TABLE, FILTER_RAIL, SEARCH, PATIENT_HEADER / PATIENT_PROFILE, WORKSPACE, CALENDAR, QUEUE, DASHBOARD_TILE, METRIC_PANEL, STATUS_PANEL, DOCUMENT_VIEWER, SIGNATURE, BILLING/CLAIM/INVOICE/PAYMENT views, and state surfaces (LOADING / EMPTY / ERROR / UNAVAILABLE / CONFLICT), plus TOAST_ALERT and role/mobile-specific variants.

## How surfaces were discovered

1. **Routing spine first.** `client/src/App.tsx` (`AuthenticatedApp`) was read in full to enumerate routed pages, redirects, and role guards (`AdminGuard`, `RoleGuard`). Navigation registries (`client/src/lib/navigation/navigationRegistry.ts`) were read for dock/nav surfaces and their role scoping.
2. **Domain fan-out.** Seven read-only `Explore` agents swept the page set (60 files in `client/src/pages`) plus every component domain under `client/src/components/{admin,ancillary-documents,billing,calendar,canonical,careSpecialist,engagement,navigation,outreach,patient,patient-directory,physician,plexus,plexus-iq,portal,qualification,ui,workflow}` and `client/src/features/{command-center,plexus-tasks,schedule}`. Each agent enumerated pages, tabs, tables, drawers, modals, filter rails, patient headers, calendars, queues, dashboard tiles, and state surfaces, citing exact source file + React symbol.
3. **Shadcn primitive usage** (`client/src/components/ui/*`) was grepped (`<Dialog|<Sheet|<Drawer|<Popover|<Tabs|useToast|<AlertDialog|Skeleton|isLoading|isError`, plus "unavailable"/"migration"/"conflict" copy) to locate modal/drawer/sheet/popover/tab surfaces and state patterns per domain.
4. **Feature flags** were read from `client/src/lib/*Flag.ts` and page-level `import.meta.env` checks to record which surfaces are flag-gated.

**Caveats.** Prototype/mock routes (`/plexus-iq-prototype`, `clinic-analytics`, `clinic-onboarding`, `imaging-central`, `clinic-workflow-demo`, `home-preview`) are cataloged and flagged as mock/prototype. `TeamPortalShell.tsx` is very large (~4k lines); its child surfaces are enumerated but some deep interactions carry `UNKNOWN_NEEDS_VERIFICATION`. State surfaces are captured by *pattern per domain* (representative instances), not exhaustively per skeleton.

## S-ID namespace

This document owns the `S###` namespace for the Phase 2L doc set. IDs are stable and sequential: **S001–S361** (S121 is a reserved/merged placeholder, folded into S099). Other Phase 2L docs should reference these IDs.

## Feature flags referenced (all Vite `import.meta.env`, `"1"/"true"/"yes"` = on)

| Flag env var | Source | Gates |
|---|---|---|
| `VITE_FEATURE_CLINICIAN_PORTAL_CANONICAL_DATA` | `lib/clinicianPortalCanonicalFlag.ts` | Clinician portal canonical data panels |
| `VITE_FEATURE_PCS_CANONICAL_VIEW` | `lib/pcsCanonicalViewFlag.ts` | PCS canonical lifecycle view |
| `VITE_FEATURE_ACS_CANONICAL_VIEW` | `lib/acsCanonicalViewFlag.ts` | ACS canonical lifecycle view |
| `VITE_FEATURE_CANONICAL_INVOICES` | `lib/canonicalInvoicesFlag.ts` | Canonical invoices UI |
| `VITE_FEATURE_CANONICAL_CLAIMS` | `lib/canonicalClaimsFlag.ts` | Canonical claims UI |
| `VITE_FEATURE_CANONICAL_PAYMENTS` | `lib/canonicalPaymentsFlag.ts` | Canonical payments UI |
| `VITE_FEATURE_CANONICAL_APPOINTMENT` | `lib/canonicalAppointmentUiFlag.ts` | Canonical appointment summaries |
| `VITE_FEATURE_CANONICAL_PROCEDURE_NOTE` | `lib/procedureLifecycleFlag.ts` | Canonical procedure-note UI |
| `VITE_FEATURE_CANONICAL_ORDER_NOTE` | `lib/unifiedAncillaryDocumentsFlag.ts` | Canonical order-note UI |
| `VITE_FEATURE_UNIFIED_ANCILLARY_DOCUMENTS` | `lib/unifiedAncillaryDocumentsFlag.ts` | Unified ancillary documents list |
| `VITE_USE_ENGAGEMENT_CANONICAL_CALL_RESULTS_UI` / `VITE_LEGACY_CALL_RESULT_ROLLBACK` | `lib/engagementCanonicalCallResultsUiFlag.ts` | Engagement canonical call-result capture |
| `VITE_FEATURE_ENGAGEMENT_MULTI_LIST_REPOSITORY` | `pages/engagement-center.tsx` | Engagement Repository tab |
| `VITE_FEATURE_ENGAGEMENT_RECENT_LISTS` | `pages/engagement-center.tsx` | "Most Recently Sent" section |
| `VITE_USE_STRUCTURED_CALL_RESULT_SELECTOR` | `components/outreach/DispositionSheet.tsx` | Structured disposition selector |
| `PHASE_1_PATIENT_EHR_ACTIVATION` | patient-directory activation | Live patient-directory search + duplicate banners |
| `CHAT_ROUTE_AVAILABLE` (`= false`) | `lib/navigation/navigationRegistry.ts` | Global dock "Chat" item (disabled) |

## Roles

Four session roles: `admin`, `clinician`, `scheduler`, `biller` (plus portal personas patientCareSpecialist / ancillaryCareSpecialist / technician / liaison mapped through workspace role, and a physician/clinician portal). Route guards: `AdminGuard` (admin only) and `RoleGuard(...roles)` in `App.tsx`. "Implicit" role gating below means the surface is reachable only via an admin/biller-guarded route but the component itself does not re-check.

---

## Routing spine (from `App.tsx`)

Canonical routed pages and their guards (redirect-only routes omitted from the S-ID inventory but noted):

| Route | Page component | Guard |
|---|---|---|
| `/home`, `/visit-patients` | `Home` | none |
| `/home-preview` | `HomePreview` | none (preview) |
| `/mission-control` | `MissionControlPage` | none |
| `/imaging-central` (aliases `/ultrasound-central`, `/technician-central`) | `ImagingCentralPage` | none (mock) |
| `/clinic-analytics`, `/analytics` | `ClinicAnalyticsPage` | none (mock) |
| `/clinic-onboarding` | `ClinicOnboardingPage` | none (mock) |
| `/schedule`, `/schedule/:id` | `SchedulePage` / `SharedSchedule` | none / PIN |
| `/patient-directory` (alias `/patient-directory/live`→redirect, `/archive`, `/patient-database`) | `PatientDatabasePage` | none |
| `/ancillary-documents` (alias `/documents`, `/plexus`) | `DocumentsPage` | none |
| `/billing` | `BillingPage` | none (implicit admin/biller) |
| `/invoices` | `InvoicesPage` | `RoleGuard[admin,biller]` |
| `/document-upload` | `DocumentUploadPage` | none |
| `/appointments` | `AppointmentsPage` | none |
| `/scheduler-portal` (alias `/outreach`, `/outreach-center`) | `OutreachPage` | none |
| `/outreach/scheduler/:id` | `OutreachSchedulerPortalPage` | scheduler match |
| `/outreach-patients` (alias `/outreach-qualification`) | `OutreachQualificationPage` | none |
| `/technician-portal` | `TechnicianPortalPage` | none |
| `/liaison-technician-portal` (alias `/liaison-portal`) | `LiaisonPortalPage` | none |
| `/clinician-portal` (alias `/physician-portal`) | `PhysicianPortalPage` | `RoleGuard[admin,clinician]` |
| `/patient-intake` (alias `/qualification`) | `QualificationPage` | none |
| `/plexus-iq` | `PlexusIQPage` | none |
| `/clinical-intelligence` | `ClinicalIntelligencePage` | none (localStorage prototype) |
| `/plexus-iq-prototype` | `PlexusIqPrototypePage` | none (mock prototype) |
| `/team-member-portals` | `TeamMemberPortalsPage` | none |
| `/patient-care-specialist-portal` | `PatientCareSpecialistPortalPage` | none |
| `/ancillary-care-specialist-portal` | `AncillaryCareSpecialistPortalPage` | none |
| `/engagement-center` | `EngagementCenterPage` | none |
| `/team-ops` | `TeamOpsPage` | none (implicit admin) |
| `/plexus-tasks` (alias `/task-brain`) | `PlexusTasksPage` | none |
| `/plexus-bank` | `PlexusBankPage` | `AdminGuard` |
| `/document-library` | `DocumentLibraryPage` | `AdminGuard` |
| `/admin/settings` (+`?tab=`,`?log=`; many `/admin/*` redirects) | `AdminSettingsPage` | `AdminGuard` |
| `/billing/readiness` | `BillingReadinessPage` | `AdminGuard` |
| `/billing/invoice-batches` | `InvoiceBatchesPage` | `AdminGuard` |
| `/billing/invoice-review` | `InvoiceReviewPage` | `AdminGuard` |
| `/billing/invoice-delivery` | `InvoiceDeliveryPage` | `AdminGuard` |
| `/billing/reports` | `BillingReportsPage` | `AdminGuard` |
| `/dashboard` (alias `/schedule-dashboard`) | `ScheduleDashboardPage` | none |
| `/login` (unauthenticated) | `LoginPage` | public |
| `*` | `NotFound` | public |

Global chrome (present on the authenticated shell): `TopBanner`, `GlobalFloatingDock`, and `GlobalNav` (shown only on `/home` and `/clinician-portal` per `GLOBAL_NAV_ROUTES`).

---

## Domain A — Global chrome & navigation

**Core table**

| S-ID | Name | Kind | Route | File | Symbol | Roles | Purpose |
|---|---|---|---|---|---|---|---|
| S001 | Top Banner | PANEL/HEADER | all (auth) | `components/TopBanner.tsx` | `TopBanner` | all | Animated dark banner: logo, role label, home link, logout |
| S002 | Global Nav Sidebar | NAV/SIDEBAR | `/home`,`/clinician-portal` | `components/GlobalNav.tsx` | `GlobalNav` | all (role-filtered items) | Collapsible left nav with badge counts |
| S003 | Global Floating Dock | DOCK | all (auth) | `components/navigation/GlobalFloatingDock.tsx` | `GlobalFloatingDock` | all; portal variant for scheduler/clinician | Floating quick-action dock (link + panel items) |
| S004 | Dock Calendar Panel | PANEL/POPUP | all | `components/navigation/GlobalFloatingDock.tsx` | `DockCalendarPanel` | all | Embeds `PlexusIQCalendar` in dock sheet |
| S005 | Portal Dock Panels | PANEL/POPUP | all (portal roles) | `components/navigation/portal/PortalDockPanels.tsx` | `PortalChatPanel`,`PortalPatientSearchPanel`,`PortalPlexusIQPanel`,`PortalTeamOpsPanel` | scheduler,clinician | Role-scoped dock panels |
| S006 | Engagement Nav Panel | PANEL | dock | `components/navigation/EngagementPanel.tsx` | `EngagementPanel` | all | Engagement/outreach quick panel (UNKNOWN_NEEDS_VERIFICATION detail) |
| S007 | Login Page | PAGE | `/login` | `pages/login.tsx` | `LoginPage` | public | Username/password auth |
| S008 | Not Found Page | ERROR_STATE/PAGE | `*` | `pages/not-found.tsx` | `NotFound` | public | 404 card |
| S009 | App Auth Loading | LOADING_STATE | all | `App.tsx` | `AppShell` (spinner) | public | Full-screen spinner while `/api/auth/me` resolves |
| S010 | Default-admin Toast | TOAST_ALERT | post-login | `App.tsx` | `handleLogin` toast | admin | Warns when logged in as default admin/admin |

**Details table**

| S-ID | APIs / queryKeys | Parent | Children | Shared components | State coverage | Duplicates / notes |
|---|---|---|---|---|---|---|
| S001 | none (props) | AppShell | — | — | — | Must not change: logout POSTs `/api/auth/logout` then clears query cache |
| S002 | `/api/schedule/today-summary`, `/api/plexus/tasks/unread-count`, `/api/plexus/tasks/overdue` | AppShell | S002 nav items | Sidebar | loading: badges cached | Only rendered on `GLOBAL_NAV_ROUTES` |
| S003 | `/api/auth/me` (portal vs admin dock) | AppShell | S004,S005 | Sheet, dock registry | badge for tasks | `DOCK_ITEMS` vs `PORTAL_DOCK_ITEMS`; `CHAT_ROUTE_AVAILABLE=false` disables Chat |
| S004 | `/api/screening-batches/calendar-summary` | S003 | `PlexusIQCalendar` (S170) | — | delegated | Shares calendar with Plexus IQ |
| S005 | portal search/chat/tasks endpoints | S003 | — | Sheet | UNKNOWN_NEEDS_VERIFICATION | Mirrors portal tabs S24x |
| S006 | UNKNOWN_NEEDS_VERIFICATION | S003 | — | — | UNKNOWN_NEEDS_VERIFICATION | — |
| S007 | `POST /api/auth/login` | AppShell | — | Card, Input | error: "Invalid username or password" | Public; sets session |
| S008 | none | Switch fallback | — | Card, AlertCircle | is the error state | — |
| S009 | `/api/auth/me` | App | — | spinner | this *is* the loading surface | — |
| S010 | none | AppShell | — | Toaster | — | Must not change: only fires for username `admin` |

---

## Domain B — Home / Mission Control / Imaging (Home & command dashboards)

**Core table**

| S-ID | Name | Kind | Route | File | Symbol | Roles | Purpose |
|---|---|---|---|---|---|---|---|
| S011 | Home Page | PAGE | `/home`,`/visit-patients` | `pages/home.tsx` | `Home` | all | Tabbed home (home/history/references/schedule modes) |
| S012 | Home Dashboard | DASHBOARD_TILE/WORKSPACE | `/home` | `components/HomeDashboard.tsx` | `HomeDashboard` | all | Weekly schedule dashboard: clinic tabs, calendar, tiles |
| S013 | Home Clinic Tabs | TAB | `/home` | `components/HomeDashboard.tsx` | inline tabs | all | Per-clinic patient/ancillary tabs |
| S014 | Calendar Filter Dropdown | FILTER_RAIL/POPOVER | `/home` | `components/HomeDashboard.tsx` | DropdownMenu | all | Toggle calendar event types |
| S015 | Day Popover | POPOVER | `/home` | `components/HomeDashboard.tsx` | `DayPopoverContent` | all | Calendar-day schedules + patient count |
| S016 | Secondary Tiles | DASHBOARD_TILE | `/home` | `components/HomeDashboard.tsx` | `SecondaryTile` | all | Links to Mission Control/Imaging/Analytics/Onboarding/Clinician |
| S017 | Clinician Portal Tile | DASHBOARD_TILE | `/home` | `components/HomeDashboard.tsx` | `ClinicianPortalTile` | clinician | Signature-count badge tile |
| S018 | Practice Pulse | METRIC_PANEL | `/home` | `components/HomeLiveDashboard.tsx` | `HomeLiveDashboard` | all | Live call/patient/ancillary metrics |
| S019 | Metric Stat Popover | POPOVER | `/home` | `components/HomeLiveDashboard.tsx` | `MetricStat` | all | Time-windowed metric breakdown (today/7d/30d) |
| S020 | Upcoming Ancillary Badge | DASHBOARD_TILE/BADGE | `/home` | `components/HomeLiveDashboard.tsx` | `UpcomingBadge` | all | Count of upcoming ancillary procedures |
| S021 | Home Sidebar | SIDEBAR/PANEL | `/home` | `components/HomeSidebar.tsx` | `HomeSidebar` | all | Schedule history list, multi-select, create/delete |
| S022 | World Clocks Widget | PANEL | `/home` | `components/HomeWorldClocks.tsx` | `HomeWorldClocks` | all | Draggable multi-timezone clocks |
| S023 | Timezone Edit Dialog | MODAL | `/home` | `components/HomeWorldClocks.tsx` | Dialog | all | Add/remove/reorder timezones |
| S024 | Upcoming Appointments Tile | DASHBOARD_TILE | `/home` | `components/ScheduleTile.tsx` | `ScheduleTile` | all | Upcoming ancillary appointments grouped by date |
| S025 | New Schedule Dialog | MODAL | `/home` | `pages/home.tsx` | inline Dialog | all | Create screening batch (date + facility) |
| S026 | Assign Scheduler Dialog | MODAL | `/home` | `pages/home.tsx` | inline Dialog | all | Manual scheduler assignment for a batch |
| S027 | Patient History Tab | TAB | `/home` | `pages/home.tsx` | inline (view=history) | all | Test-history import/search/delete |
| S028 | References Tab (Patient Directory View) | TAB | `/home` | `components/PatientDirectoryView.tsx` | `PatientDirectoryView` | all | EHR reference lookup + import |
| S029 | Schedule Build View | TAB/WORKSPACE | `/home` | `components/qualification/VisitBuildPane.tsx` (via home) | `VisitBuildPane` | all | Patient batch builder + analysis |
| S030 | Schedule Results View | TAB/WORKSPACE | `/home` | `components/ResultsView.tsx` | `ResultsView` | all | Analyzed patient results/readiness |
| S031 | Page Header (light/dark) | HEADER | many | `components/PageHeader.tsx` | `PageHeader` | all | Shared page header w/ back + actions |
| S032 | Home Preview Page | PAGE | `/home-preview` | `pages/home-preview.tsx` | `HomePreview` | all | Navy/slate visual redesign preview of Home |
| S033 | Home Dashboard Preview | DASHBOARD_TILE | `/home-preview` | `components/HomeDashboardPreview.tsx` | `HomeDashboardPreview` | all | Preview variant of S012 |
| S034 | Practice Pulse Preview | METRIC_PANEL | `/home-preview` | `components/HomeLiveDashboardPreview.tsx` | `HomeLiveDashboardPreview` | all | Preview variant of S018 |
| S035 | Mission Control Page | PAGE/DASHBOARD | `/mission-control` | `pages/mission-control.tsx` | `MissionControlPage` | all | Ops command center: lanes, metrics, queues |
| S036 | MC Page Header | HEADER | `/mission-control` | `pages/mission-control.tsx` | `PageHeader` (inner) | all | Refresh, facility scope, access preview, search/chat triggers |
| S037 | Execution Spine Cards | DASHBOARD_TILE | `/mission-control` | `pages/mission-control.tsx` | `SPINE_CARDS` grid | all | 10 clickable queue metric tiles |
| S038 | MC Search & Filters | FILTER_RAIL | `/mission-control` | `pages/mission-control.tsx` | inline Card | all | Search + status/priority/owner/queue filters |
| S039 | Operational Lanes Table | TABLE | `/mission-control` | `pages/mission-control.tsx` | inline Table | all | Case lanes w/ status, priority, blocker, due |
| S040 | Lane Workbench Sheet | SHEET | `/mission-control` | `pages/mission-control.tsx` | inline SheetContent | all | Case detail + triage hand-off buttons |
| S041 | Role Queues Grid | DASHBOARD_TILE | `/mission-control` | `pages/mission-control.tsx` | inline cards | all | Scheduler/biller/clinician queue counts |
| S042 | Operations Metric Sections | METRIC_PANEL | `/mission-control` | `pages/mission-control.tsx` | `MetricSection` | all | Calls/Patient Svc/Finance/Ops/Ancillary + RingCentral status |
| S043 | MC Global Patient Search Sheet | SHEET/SEARCH | `/mission-control` | `pages/mission-control.tsx` | inline SheetContent | all | Patient EHR search overlay |
| S044 | Plexus Chat Sheet | SHEET | `/mission-control` | `pages/mission-control.tsx` | inline SheetContent | all | Chat overlay placeholder ("not connected") |
| S045 | Imaging Central Page | PAGE | `/imaging-central` | `pages/imaging-central.tsx` | default export | all | Ultrasound execution center (mock data) |
| S046 | Imaging Spine Cards | DASHBOARD_TILE | `/imaging-central` | `pages/imaging-central.tsx` | inline cards | all | Coverage/completed/readiness metric tiles |
| S047 | Imaging Work Queue Table | TABLE | `/imaging-central` | `pages/imaging-central.tsx` | inline Table | all | Patient imaging assignments |
| S048 | Imaging Coverage Table | TABLE | `/imaging-central` | `pages/imaging-central.tsx` | inline Table | all | Technician coverage by date/location |
| S049 | Technician Roster Card | PANEL | `/imaging-central` | `pages/imaging-central.tsx` | inline Card | all | Technician list w/ shift/capacity |
| S050 | Imaging Workbench Sheet | SHEET | `/imaging-central` | `pages/imaging-central.tsx` | inline SheetContent | all | Selected work-queue row detail + actions |
| S051 | Clinic Analytics Page | PAGE | `/clinic-analytics`,`/analytics` | `pages/clinic-analytics.tsx` | default export | all | Clinic due-diligence scoring (mock) |
| S052 | Clinic Analytics Cards/Tables | METRIC_PANEL/TABLE | `/clinic-analytics` | `pages/clinic-analytics.tsx` | inline (payor mix, meds/ICD/CPT tables, financial/demographics/capacity/team/AI/revenue cards) | all | ~12 mock analytic panels |
| S053 | Clinic Onboarding Page | PAGE | `/clinic-onboarding` | `pages/clinic-onboarding.tsx` | default export | all | Implementation readiness console (mock) |
| S054 | Onboarding Sections Accordion | TAB/ACCORDION | `/clinic-onboarding` | `pages/clinic-onboarding.tsx` | Accordion | all | 25 checklist sections + go-live signoff |
| S055 | Clinic Workflow Demo Page | PAGE | `/clinic-workflow-demo` | `pages/clinic-workflow-demo.tsx` | `ClinicWorkflowDemoPage` | all | Wrapper for `WorkflowSandbox` demo |

**Details table (Domain B)**

| S-ID | APIs / queryKeys | Parent | Children | Shared components | State coverage | Duplicates / notes |
|---|---|---|---|---|---|---|
| S011 | `/api/screening-batches`, `/api/test-history`, `/api/schedule/dashboard`, `/api/schedule/analysis-status` | route | S012,S021,S027–S030 | Tabs, StepTimeline | loading via `useScreeningBatches` | Journey: intake→schedule |
| S012 | `/api/schedule/dashboard` | S011 | S013–S017,S018,S022,S024 | CanonicalMonthCalendar | loading: `dashboardLoading` skeleton; empty calendar | Preview twin S033 |
| S015 | calendar summary | S012 | — | Popover | empty if no data | — |
| S017 | `/api/physician-portal/summary` | S012 | — | — | badge hidden if 0 | clinician-only |
| S018 | `/api/home-stats` (`useHomeStats`) | S012 | S019,S020 | Popover | loading: `homeStatsLoading` skeleton | Preview twin S034 |
| S021 | `/api/screening-batches` | S011 | schedule list items | Sidebar | loading spinner; empty "No schedules yet" | — |
| S024 | `/api/appointments?upcoming=true` | S012 | — | — | loading skeleton; empty "No appointments scheduled" | — |
| S025 | `POST /api/screening-batches` | S011 | — | Dialog, Calendar | pending during create | — |
| S026 | `/api/scheduling/assign` | S011 | — | Dialog | empty: no schedulers alert | Duplicate of engagement assignment (S30x) concept |
| S029 | `/api/screening-batches/{id}`, `/api/patients`, `/api/analysis` | S011 | AppointmentModal | — | analysis progress bar; import pending | Shared with outreach S154 |
| S030 | `/api/screening-batches/{id}` | S011 | PdfPatientSelectDialog, NotesPanelDrawer, PatientDetailDialog | — | loading skeleton | Shared with plexus-iq day modal |
| S035 | `/api/mission-control/spine`, `/api/plexus/patients/search`, `/api/auth/me` | route | S036–S044 | Sheet, Table | loading skeleton grid; isError card; empty lanes | — |
| S037 | spine data | S035 | — | Card | `sourceMissing`→"N/A" | UNAVAILABLE via sourceMissing |
| S040 | none yet (toast hand-off) | S035 | — | Sheet | display-only | Must-not-change: hand-off currently fires toast only |
| S042 | spine sections | S035 | — | — | `sourceMissing`→"No data available yet"; RingCentral not-connected | UNAVAILABLE_STATE |
| S043 | `/api/plexus/patients/search` | S035 | — | Sheet | loading skeleton rows; isError; empty | Duplicate of S028/global search |
| S044 | none | S035 | — | Sheet | UNAVAILABLE ("Assistant not connected yet") | — |
| S045–S050 | mock arrays (no API) | route | — | Table, Sheet | skeleton/empty per queue | Mock/demo module |
| S051–S052 | mock (client) | route | — | Table, Progress, Chart | none (demo) | Mock/demo |
| S053–S054 | mock (`generateChecklist`) | route | — | Accordion, Progress | none (demo) | Mock/demo |
| S055 | UNKNOWN_NEEDS_VERIFICATION | route | `WorkflowSandbox` | — | UNKNOWN_NEEDS_VERIFICATION | Demo/sandbox |

---

## Domain C — Patient Directory / EHR

Journey stage: **Directory / EHR (cross-cutting patient record)**. Role gating on chart sections is data-driven via `usePatientDirectorySectionAccess()` (hidden/summary/full per role).

**Core table**

| S-ID | Name | Kind | Route | File | Symbol | Roles | Purpose |
|---|---|---|---|---|---|---|---|
| S056 | Patient Database Page | PAGE | `/patient-directory` | `pages/patient-database.tsx` | `PatientDatabasePage` | all | Clinic-grouped roster + profile workspace |
| S057 | Patient Roster Rail | FILTER_RAIL/SEARCH | `/patient-directory` | `pages/patient-database.tsx` | inline aside | all | Searchable clinic-grouped patient list |
| S058 | Cooldown Summary Tiles | FILTER_RAIL | `/patient-directory` | `pages/patient-database.tsx` | inline | all | Quick-filter by cooldown window |
| S059 | Clinic Filter Chips | FILTER_RAIL | `/patient-directory` | `pages/patient-database.tsx` | inline | all | Toggle clinic filter |
| S060 | Import History Dialog | MODAL | `/patient-directory` | `pages/patient-database.tsx` | Dialog | all | Upload/paste test-history import |
| S061 | Patient Profile Workspace | WORKSPACE/PATIENT_PROFILE | `/patient-directory` | `components/patient-directory/PatientProfileWorkspace.tsx` | `PatientProfileWorkspace` | all (section-gated) | Full lazy-loaded patient chart |
| S062 | Patient Chart | WORKSPACE | `/patient-directory` | `components/patient-directory/PatientChart.tsx` | `PatientChart` | all (section-gated) | Sticky header + scrollable sections + nav |
| S063 | Patient Profile Header (sticky) | PATIENT_HEADER | `/patient-directory` | `components/patient-directory/PatientProfileHeader.tsx` | `PatientProfileHeader` | all | Demographics + status badges + quick actions |
| S064 | Chart Section Nav (rail) | NAV/FILTER_RAIL | `/patient-directory` | `components/patient-directory/PatientChart.tsx` | inline nav | all | Collapsible section jump nav (desktop) |
| S065 | Chart Section Nav (mobile pills) | NAV/MOBILE_SPECIFIC | `/patient-directory` | `components/patient-directory/PatientChart.tsx` | inline pills | all | Horizontal pill nav on mobile/tablet |
| S066 | Chart Sections | PANEL | `/patient-directory` | `components/patient-directory/PatientChartSections.tsx` | `OverviewSection`,`CooldownSection`,+20 section cards | all (section-gated) | Per-category clinical section cards |
| S067 | Patient Profile Tabs | TAB | `/patient-directory` | `components/patient-directory/PatientProfileTabs.tsx` | `PatientProfileTabs` | all | 8 tabs: Overview/Clinical/Plexus IQ/Calls/Scheduling/Documents/Timeline/Billing |
| S068 | Patient Profile Drawer | DRAWER | `/patient-directory` (live scaffold) | `components/patient-directory/PatientProfileDrawer.tsx` | `PatientProfileDrawer` | all | Read-only 9-tab profile side sheet |
| S069 | Patient Directory Scaffold Page | PAGE | (reusable) | `components/patient-directory/PatientDirectoryPage.tsx` | `PatientDirectoryPage` | all | Search + list scaffold (fixture-driven) |
| S070 | Patient Directory Live Page | PAGE | `/patient-directory/live`→redirect | `components/patient-directory/PatientDirectoryLivePage.tsx` | `PatientDirectoryLivePage` | all | Route-connected wrapper w/ live search |
| S071 | Bulk Import Dialog | MODAL | `/patient-directory` | `components/patient-directory/PatientDirectoryActions.tsx` | `BulkImportDialog` | all (admin match-review) | Two-mode import + preview/match/approve |
| S072 | DNC / Cooldown Dialog | MODAL | `/patient-directory` | `components/patient-directory/PatientDirectoryActions.tsx` | `DncCooldownDialog` | all | Set/clear Do-Not-Contact & cooldown |
| S073 | Add Prior Test Dialog | MODAL | `/patient-directory` | `components/patient-directory/PatientDirectoryActions.tsx` | `AddPriorTestDialog` | all | Record a prior ancillary test |
| S074 | Recent Imports Panel | PANEL | `/patient-directory` | `components/patient-directory/RecentImportsPanel.tsx` | `RecentImportsPanel` | all (admin review/delete) | Last 30 import batches + admin actions |
| S075 | Import Batch Delete Confirm | MODAL/CONFLICT | `/patient-directory` | `components/patient-directory/RecentImportsPanel.tsx` | Dialog | admin | Soft-delete batch (14-day restore) |
| S076 | Patient Audit Trail Modal | MODAL | `/patient-directory` | `components/patient-directory/PatientAuditTrailModal.tsx` | `PatientAuditTrailModal` | all | Chronological audit events + dup warnings |
| S077 | Duplicate Warning Badge | BADGE/CONFLICT | cross-cutting | `components/patient-directory/DuplicateWarningBadge.tsx` | `DuplicateWarningBadge`,`DuplicateWarningSummary` | all | Duplicate/DNC/cooldown warning chip → audit |
| S078 | Admin Review Duplicate Guard | CONFLICT | cross-cutting | `components/patient-directory/AdminReviewDuplicateGuard.tsx` | `AdminReviewDuplicateGuard` | admin | Hard-block approval on DNC/cooldown |
| S079 | Engagement Handoff Duplicate Bar | CONFLICT/BANNER | outreach/engagement | `components/patient-directory/EngagementHandoffDuplicateBar.tsx` | `EngagementHandoffDuplicateBar` | all | Duplicate warning at engagement handoff |
| S080 | Section Access Admin Panel | TABLE/ADMIN | admin settings | `components/admin/PatientDirectorySectionAccessPanel.tsx` | `PatientDirectorySectionAccessPanel` | admin | Role×section access matrix editor |
| S081 | Patient Card | CARD | qualification/schedule | `components/PatientCard.tsx` | `PatientCard` | all | Qualification card w/ actions menu |
| S082 | Patient Detail Dialog | MODAL | qualification/schedule | `components/PatientDetailDialog.tsx` | `PatientDetailDialog` | all | Patient profile + ancillary reasoning entry |
| S083 | Patient Edit Dialog | MODAL | qualification/schedule | `components/PatientEditDialog.tsx` | `PatientEditDialog` | all | Edit screening details + clinical data |
| S084 | Clinical Data Editor | FORM | in S083 | `components/ClinicalDataEditor.tsx` | `ClinicalDataEditor` | all | Multi-row prior-test history editor |
| S085 | PDF Patient Select Dialog | MODAL | qualification/schedule | `components/PdfPatientSelectDialog.tsx` | `PdfPatientSelectDialog` | all | Multi-select patients for PDF export |
| S086 | Appointment Modal | MODAL | home/schedule | `components/AppointmentModal.tsx` | `AppointmentModal` | all | Single-patient appointment scheduling |
| S087 | Batch Header | HEADER | schedule | `components/BatchHeader.tsx` | `BatchHeader` | all | Batch name/clinician/status/progress |
| S088 | Step Timeline | NAV | schedule/qualification | `components/StepTimeline.tsx` | `StepTimeline` | all | Home→Build→Results wizard nav |
| S089 | Editable Screening Form Modal | MODAL | documents/screening | `components/EditableScreeningFormModal.tsx` | `EditableScreeningFormModal` | all | Edit screening conditions + generate docs |
| S090 | Notes Panel Drawer | DRAWER | schedule/results | `components/NotesPanelDrawer.tsx` | `NotesPanelDrawer` | all | Generated-notes editor + mark complete |
| S091 | Completed Tests Dialog | MODAL | in S090 / schedule | `features/schedule/CompletedTestsDialog.tsx` | `CompletedTestsDialog` | all | Select completed tests → generate docs |
| S092 | Patient Silhouette | ICON | cross-cutting | `components/PatientSilhouette.tsx` | `PatientSilhouette` | all | Gender avatar SVG (non-interactive) |
| S093 | Communication Timeline | PANEL/TIMELINE | patient/workflow | `components/patient/CommunicationTimeline.tsx` | `CommunicationTimeline` | all | Read-only comms timeline |
| S094 | Document Readiness Panel | PANEL/TABLE | patient/workflow | `components/patient/DocumentReadinessPanel.tsx` | `DocumentReadinessPanel` | all | Doc readiness checks by service |
| S095 | Patient Journey Drawer | DRAWER | patient/workflow, outreach | `components/patient/PatientJourneyDrawer.tsx` | `PatientJourneyDrawer` | all | Full patient packet/journey side sheet |
| S096 | Procedure Complete Button | BUTTON | patient/workflow | `components/patient/ProcedureCompleteButton.tsx` | `ProcedureCompleteButton` | all | Mark procedure complete (mutation) |

**Details table (Domain C)**

| S-ID | APIs / queryKeys | Parent | Children | Shared components | State coverage | Duplicates / notes |
|---|---|---|---|---|---|---|
| S056 | `/api/patients/database`, `/api/patients/database/cooldown-summary`, `/api/patients/database/resolve/:id` | route | S057–S061 | Skeleton | loading skeleton; empty roster; profile not-found/empty | — |
| S061 | many lazy per-section queries (docs, calls, billing, execution-cases, appointments) | S056 | S062 | Skeleton | per-section skeleton; `profileQuery.isError` "Failed to load patient profile" | Section access gated |
| S062 | (section-managed) | S061 | S063–S067 | `PatientChartSkeleton`,`SectionSkeleton`,`AccessDeniedSection`,`SectionSummaryCard` | loading skeleton; ERROR: AccessDeniedSection; summary vs full | — |
| S066 | per-section | S062 | — | SectionCard | empty per section ("No qualifying ancillary tests yet" etc.) | 20+ section cards |
| S067 | props (parent queries) | S062 | — | Tabs | per-tab loading (`callsLoading`,`documentsLoading`,`billingLoading`); empty per tab | Duplicate profile view vs S068 (workspace vs live-drawer) |
| S068 | none (snapshot prop) | S069 | 9 tab panels | Sheet, Tabs | empty "Select a patient..."; per-tab empties | Alt profile surface (live scaffold) |
| S070 | `patient-directory-activation-reachable`, `patient-directory-search` | route→redirect | S069,S071–S074 | — | UNAVAILABLE when `PHASE_1_PATIENT_EHR_ACTIVATION` off (empty) | Route now redirects to S056 |
| S071 | `importPreview()`,`importConfirm()` | S070/S056 | — | Dialog | busy flag; error toast | admin match-review; non-admin submit-for-approval |
| S074 | `listImportBatches()`,`deleteImportBatch()` | S070/S056 | S075 | — | loading spinner; empty "No imports yet" | admin-only review/delete |
| S076 | none (events prop) | S069 | — | Dialog | empty "No audit events available yet"; UNAVAILABLE when flag off | — |
| S077 | none | many surfaces | → S076 | Badge, Tooltip | — | CONFLICT surface reused in Plexus IQ, Admin Review, engagement, call lists |
| S078 | `/api/patient-directory/duplicate-warning-facts` | admin approval (S166) | — | — | hard-block "Approve" (CONFLICT) | — |
| S080 | `/api/patient-directory/section-access` (GET/PUT) | admin settings | — | Table, Select | loading spinner; isError | admin locks own column to "full" |
| S089 | `POST` screening data | documents/billing | — | Dialog | — | Reused across documents, billing, screening |
| S095 | `fetchPatientPacket()` | workflow, outreach | JourneyBody | Sheet | LoadingState/ErrorState/EmptyState | Shared with outreach current-call/canonical-case |
| S096 | `markProcedureCompleteApi()` | workflow | — | — | isPending; disabled; error toast | invalidates multiple query keys |

---

## Domain D — Plexus IQ / Qualification / Clinical Intelligence / Tasks

Journey stage: **Qualification / Admin Review**.

**Core table**

| S-ID | Name | Kind | Route | File | Symbol | Roles | Purpose |
|---|---|---|---|---|---|---|---|
| S097 | Plexus IQ Page | PAGE | `/plexus-iq` | `pages/plexus-iq.tsx` | `PlexusIQPage` | all (admin/clinician-oriented) | Qualification workspace: operating list, calendar, batches |
| S098 | Plexus IQ Workspace | PANEL/TAB | `/plexus-iq` | `components/plexus-iq/PlexusIQWorkspace.tsx` | `PlexusIQWorkspace` | all | 4 tabs: Needs Completion/Finalized/Scheduled/All |
| S099 | Operating List | PANEL | `/plexus-iq` | `components/plexus-iq/operating/PlexusIQOperatingList.tsx` | `PlexusIQOperatingList` | all | Facility-first date-accordion patient list |
| S100 | Operating List Bar | FILTER_RAIL/TOOLBAR | `/plexus-iq` | `components/plexus-iq/operating/PlexusIQListBar.tsx` | `PlexusIQListBar` | all | Facility select, view toggles, actions |
| S101 | Operating Date Panel | PANEL | `/plexus-iq` | `components/plexus-iq/operating/PlexusIQDatePanel.tsx` | `PlexusIQDatePanel` | all | Batches grouped by date (accordion) |
| S102 | Operating Row | TABLE/ROW | `/plexus-iq` | `components/plexus-iq/operating/PlexusIQOperatingRow.tsx` | `PlexusIQOperatingRow` | all | Patient status grid row + inline actions |
| S103 | Active Batch Header | HEADER/STATUS_PANEL | `/plexus-iq` | `components/plexus-iq/PlexusIQActiveBatchHeader.tsx` | `PlexusIQActiveBatchHeader` | all | Persistent active-batch context strip |
| S104 | Add Patient Hub | MODAL | `/plexus-iq` | `components/plexus-iq/PlexusIQAddPatientHub.tsx` | `PlexusIQAddPatientHub` | all | 3-tile entry (Visit/Outreach/BatchFlow) |
| S105 | Add Patient Modal | MODAL | `/plexus-iq` | `components/plexus-iq/PlexusIQAddPatientModal.tsx` | `PlexusIQAddPatientModal` | all | Single-patient add form |
| S106 | Bulk Import Modal | MODAL | `/plexus-iq` | `components/plexus-iq/PlexusIQBulkImportModal.tsx` | `PlexusIQBulkImportModal` | all | Two-step paste/upload → preview import |
| S107 | Batch Flow Dialog | MODAL | `/plexus-iq` | `components/plexus-iq/PlexusIQBatchFlowDialog.tsx` | `PlexusIQBatchFlowDialog` | all | Start New / Resume / History |
| S108 | Assign Date Dialog | MODAL | `/plexus-iq` | `components/plexus-iq/PlexusIQAssignDateDialog.tsx` | `PlexusIQAssignDateDialog` | all | Schedule unscheduled batch |
| S109 | Calendar Drawer | DRAWER/CALENDAR | `/plexus-iq` | `components/calendar/CanonicalCommandCalendar.tsx` | `CanonicalCommandCalendar` (mode=drawer) | all | Month grid + unscheduled assign |
| S110 | Day Modal | MODAL | `/plexus-iq` | `components/plexus-iq/PlexusIQDayModal.tsx` | `PlexusIQDayModal` | all | Calendar-day results (facility tabs → ResultsView) |
| S111 | Plexus IQ Calendar | CALENDAR | `/plexus-iq`, dock | `components/plexus-iq/PlexusIQCalendar.tsx` | `PlexusIQCalendar` | all | Month grid w/ per-day counts/status dots |
| S112 | Recently Deleted Shelf | PANEL/TABLE | `/plexus-iq` | `components/plexus-iq/PlexusIQRecentlyDeleted.tsx` | `PlexusIQRecentlyDeleted` | admin | Soft-deleted patients (14-day restore) |
| S113 | Qualification Jobs Status | STATUS_PANEL | `/plexus-iq` | `components/plexus-iq/PlexusIQQualificationJobsStatus.tsx` | `PlexusIQQualificationJobsStatus` | admin | Active async qualification jobs banner |
| S114 | Single Qualification Job Status | STATUS_PANEL | `/plexus-iq` | `components/plexus-iq/PlexusIQQualificationJobStatus.tsx` | `PlexusIQQualificationJobStatus` | admin | Single-job progress |
| S115 | Recent Qualification Cards | PANEL | `/plexus-iq` | `components/plexus-iq/PlexusIQRecentQualificationCards.tsx` | `PlexusIQRecentQualificationCards` | all | Recent qualification result cards |
| S116 | Dashboard Row | ROW | `/plexus-iq` | `components/plexus-iq/PlexusIQDashboardRow.tsx` | `PlexusIQDashboardRow` | all | Batch dashboard row |
| S117 | Run Selector | SELECTOR/POPOVER | `/plexus-iq` | `components/plexus-iq/PlexusIQRunSelector.tsx` | `PlexusIQRunSelector` | all | Pick batch/run to focus |
| S118 | Run Comparison Selector | SELECTOR | admin review | `components/plexus-iq/RunComparisonSelector.tsx` | `RunComparisonSelector` | admin | Compare prior runs |
| S119 | Packet Patient Selection Dialog | MODAL | `/plexus-iq` | `components/plexus-iq/PacketPatientSelectionDialog.tsx` | `PacketPatientSelectionDialog` | admin | Multi-select for PDF packet |
| S120 | Packet QA Blocking Dialog | MODAL/CONFLICT | `/plexus-iq` | `components/plexus-iq/PacketQaBlockingDialog.tsx` | `PacketQaBlockingDialog` | admin | Blocks PDF export on QA issues |
| S121 | Add Patient Hub (batch)  — Operating List container | (see S099) | — | — | — | — | (dup guard note) |
| S122 | Admin Review Dialog | MODAL | qualification | `components/qualification/AdminReviewDialog.tsx` | `AdminReviewDialog` | admin | Full review: ancillary tabs, evidence, approval |
| S123 | Admin Approval Control | MODAL | qualification | `components/qualification/AdminApprovalControl.tsx` | `AdminApprovalControl` | admin | Quick approval status flip (+ dup guard) |
| S124 | Admin Review AI Logic Drawer | DRAWER | in S122 | `components/qualification/AdminReviewAiLogicDrawer.tsx` | `AdminReviewAiLogicDrawer` | admin/clinician | AI evidence review + rule builder (localStorage) |
| S125 | Change Engagement Assignment Dialog | MODAL | qualification/engagement | `components/qualification/ChangeEngagementAssignmentDialog.tsx` | `ChangeEngagementAssignmentDialog` | admin | Reassign patient to scheduler |
| S126 | Admin Approval Control chip | BADGE | qualification | `components/qualification/AdminApprovalControl.tsx` | chip | admin | Approval status chip → S123 |
| S127 | Qualification Landing (Patient Intake) | PAGE | `/patient-intake` | `pages/qualification.tsx` | `QualificationPage` | all | Visit/Outreach entry tiles |
| S128 | Outreach Qualification Page | PAGE | `/outreach-patients` | `pages/outreach-qualification.tsx` | `OutreachQualificationPage` | clinician | Outreach build/results workspace |
| S129 | Visit Build Pane | PANEL/WORKSPACE | qualification/home/outreach | `components/qualification/VisitBuildPane.tsx` | `VisitBuildPane` | all | Import + patient-list builder + analysis |
| S130 | Qualification Patient Cards Pane | PANEL | `/plexus-iq`,outreach | `components/qualification/QualificationPatientCardsPane.tsx` | `QualificationPatientCardsPane` | all | Qualification result cards grid |
| S131 | Plexus Documents Wizard | PAGE/FORM | `/plexus`→redirect | `pages/plexus.tsx` | `PlexusPage` | clinician | 4-step doc generator (patient→service→screening→docs) |
| S132 | Clinical Intelligence Page | PAGE | `/clinical-intelligence` | `pages/clinical-intelligence.tsx` | `ClinicalIntelligencePage` | all | Governance/knowledge prototype (localStorage) |
| S133 | Plexus IQ Prototype Page | PAGE | `/plexus-iq-prototype` | `pages/plexus-iq-prototype.tsx` | `PlexusIqPrototypePage` | all | Design prototype (mock data) |
| S134 | Plexus IQ Operating Canvas Prototype | PANEL | prototype | `components/plexus-iq/design-prototypes/PlexusIQOperatingCanvasPrototype.tsx` | prototype | all | Mock operating canvas |
| S135 | Plexus Bank Page | PAGE | `/plexus-bank` | `pages/plexus-bank.tsx` | `PlexusBankPage` | admin | Plexus Bank hub (modules: core/comp/ops/ui) |
| S136 | Plexus Tasks Page | PAGE | `/plexus-tasks` | `pages/plexus-tasks.tsx` | `PlexusTasksPage` | all | Asana-style task workspace |
| S137 | Plexus Tasks Workspace | WORKSPACE/TABLE | `/plexus-tasks` | `features/plexus-tasks/PlexusTasksWorkspace.tsx` | `PlexusTasksWorkspace` | all | 3-zone: views / status board / detail |
| S138 | Tasks Dock Popup | DOCK_POPUP/TAB | all (dock) | `features/plexus-tasks/TasksDockPopup.tsx` | `TasksDockPopup` | all | My Work/Urgent/Due mini task widget |
| S139 | Create Task Modal | MODAL/FORM | tasks | `components/plexus/CreateTaskModal.tsx` | `CreateTaskModal` | all | Quick task create form |
| S140 | Task Drawer | DRAWER | tasks/outreach | `components/plexus/TaskDrawer.tsx` | `TaskDrawer` | all | Task detail + collaborators |

**Details table (Domain D)**

| S-ID | APIs / queryKeys | Parent | Children | Shared components | State coverage | Feature flags | Duplicates / notes |
|---|---|---|---|---|---|---|---|
| S097 | `/api/screening-batches`, `/api/screening-batches/calendar-summary`, `/api/global-schedule-events` | route | S098,S103,S104,S109,S112,S113 | Skeleton | batch-detail loading; empty workspace | — | — |
| S098 | `/api/screening-batches` summary + detail | S097 | S099 | Tabs | per-tab empty/loading | — | — |
| S102 | none (display) | S099 | — | — | ERROR: "Save failed" badge per patient | — | — |
| S109 | calendar-summary, global-schedule-events | S097 | S110,S111 | Drawer, Calendar | loading | — | Same calendar as dock S004 |
| S110 | `/api/screening-batches/{id}` per batch | S109 | ResultsView (S030) | Tabs | loading; empty "No batches for this date" | — | Reuses ResultsView |
| S112 | `/api/plexus-iq/recently-deleted`, restore POST | S097 | — | — | hidden if empty; loading; restore | — | — |
| S113 | poll `/api/plexus-iq/qualification-jobs/{jobId}` (2500ms) | S097 | S114 | — | always-on when jobs active | — | — |
| S122 | `/api/patient-screenings/{id}` mutations, regenerate | S099/S102 | S124, ancillary tabs, ICD popover | Tabs, Popover | regenerate loading; no-siblings edge; ERROR toast | — | Ancillary tabs BrainWave/VitalWave/Ultrasound |
| S123 | `POST /api/patient-screenings/{id}/admin-approval` | S081/S102 | → S078 | Dialog | duplicate hard-block (CONFLICT); loading | — | — |
| S124 | localStorage Clinical Intelligence store | S122 | evidence popovers | Drawer, Popover | — | — | no server writes yet |
| S125 | `/api/patients/{id}/engagement-assignment` (GET options/POST) | S081/S102 | — | Dialog | options loading | — | Duplicate of home assign S026 & engagement S30x |
| S128 | `/api/screening-batches`, `/api/patient-screenings` | route | S129 or S030 | — | analysis progress bar; batch loading | — | Build vs results toggle |
| S131 | `/api/generate-justification` | route→redirect | 4-step forms | — | generation loading; per-step validation | — | — |
| S132 | localStorage | route | — | — | prototype | — | UNAVAILABLE copy present |
| S135 | Plexus Bank mock store (`usePlexusBank`) | route (AdminGuard) | modules-core/comp/ops/ui | — | UNKNOWN_NEEDS_VERIFICATION | — | mock-backed |
| S137 | `/api/plexus/*` tasks/comments/projects | S136 | S139,S140 | — | loading/empty per view | — | — |
| S138 | `/api/plexus/tasks/my-work|urgent|overdue`, POST | dock | — | Tabs | loading/empty per tab | — | Mirrors S137 in mini form |
| S139 | `POST /api/plexus/tasks`, `/api/plexus/patients/search` | tasks entry points | — | Dialog | patient search loading; validation | — | — |

Note: S121 is intentionally reserved/merged into the Operating List (S099) — no separate surface. Kept for stable numbering.

---

## Domain E — Outreach / Scheduler Portal

Journey stage: **Outreach / Scheduling**.

**Core table**

| S-ID | Name | Kind | Route | File | Symbol | Roles | Purpose |
|---|---|---|---|---|---|---|---|
| S141 | Outreach Center | PAGE/DASHBOARD | `/scheduler-portal` | `pages/outreach.tsx` | `OutreachPage` | all (manager) | Manager call metrics + scheduler coverage |
| S142 | Outreach Metrics Strip | METRIC_PANEL | `/scheduler-portal` | `pages/outreach.tsx` | inline | all | 6-card KPI banner |
| S143 | Uncovered Clinics Warning | ERROR_STATE/BANNER | `/scheduler-portal` | `pages/outreach.tsx` | inline | all | Amber warning: facilities with no scheduler |
| S144 | Scheduler Tile Grid | TABLE | `/scheduler-portal` | `pages/outreach.tsx` | `SchedulerTileCard` | all | Compact scheduler cards → open portal |
| S145 | Manager Inbox / Marketing / Reassignment / Follow-up / Role Mix | PANEL/QUEUE | `/scheduler-portal` | `pages/outreach.tsx` | inline placeholders | all | Placeholder ops tiles/queues |
| S146 | Scheduler Portal Page | PAGE/WORKSPACE | `/outreach/scheduler/:id` | `pages/outreach-scheduler-portal.tsx` | `OutreachSchedulerPortalPage` | scheduler match | Full-screen call workspace |
| S147 | Scheduler Portal Header | HEADER | `/outreach/scheduler/:id` | `pages/outreach-scheduler-portal.tsx` | inline | scheduler | Name/facility/back/shortcuts |
| S148 | Left Icon Rail | RAIL | `/outreach/scheduler/:id` | `pages/outreach-scheduler-portal.tsx` | inline (`RailIcon`) | scheduler | Schedule/Tasks/Email/Materials/Messages icons+popovers |
| S149 | Playfield Tabs Strip | TAB | `/outreach/scheduler/:id` | `pages/outreach-scheduler-portal.tsx` | inline | scheduler | Open-tab bar (Call/Calendar/Email...) |
| S150 | Expanded Section View | PANEL | `/outreach/scheduler/:id` | `components/outreach/ExpandedSectionView.tsx` | `ExpandedSectionView` | scheduler | Full-width expanded tab content |
| S151 | Floating Metrics Tile | METRIC_PANEL | `/outreach/scheduler/:id` | `components/outreach/FloatingMetricsTile.tsx` | `FloatingMetricsTile` | scheduler | Calls/reached/scheduled/conversion tile |
| S152 | Daily Targets Tile | METRIC_PANEL | `/outreach/scheduler/:id` | `components/outreach/DailyTargetsTile.tsx` | `DailyTargetsTile` | scheduler | KPI progress bars |
| S153 | Floating AI Bar | POPOVER | `/outreach/scheduler/:id` | `components/outreach/AiBar.tsx` | `AiBar` | scheduler | Suggestive call-context panel |
| S154 | Call List Panel | PANEL/QUEUE | `/outreach/scheduler/:id` | `components/outreach/CallListPanel.tsx` | `CallListPanel` | scheduler | Right-rail priority call queue |
| S155 | Call List Duplicate Banner | CONFLICT/BANNER | `/outreach/scheduler/:id` | `components/outreach/CallListDuplicateBanner.tsx` | `CallListDuplicateBanner` | scheduler | EHR-activation duplicate warning |
| S156 | Canonical Cases Section | PANEL | `/outreach/scheduler/:id` | `components/outreach/CallListPanel.tsx` | inline | scheduler | Canonical-only execution cases |
| S157 | Canonical Row Actions | MENU | `/outreach/scheduler/:id` | `components/outreach/CanonicalRowActions.tsx` | `CanonicalRowActions` | scheduler | Inline case actions |
| S158 | Current Call Card | CARD | `/outreach/scheduler/:id` | `components/outreach/CurrentCallCard.tsx` | `CurrentCallCard` | scheduler | Selected-patient call card + script |
| S159 | Mission Control Bar | BUTTON_BAR | `/outreach/scheduler/:id` | `components/outreach/MissionControlBar.tsx` | `MissionControlBar` | scheduler | Disposition/Book/Skip actions |
| S160 | Disposition Sheet | SHEET | `/outreach/scheduler/:id` | `components/outreach/DispositionSheet.tsx` | `DispositionSheet` | scheduler | Call-outcome selector + notes |
| S161 | Tri-Clinic Calendar | CALENDAR | `/outreach/scheduler/:id` | `components/outreach/TriClinicCalendar.tsx` | `TriClinicCalendar` | scheduler | Multi-clinic booking calendar |
| S162 | Booking Dialogs | MODAL | `/outreach/scheduler/:id` | `components/outreach/BookingDialogs.tsx` | `SlotBookingDialog`,`CancelAppointmentDialog`,`PatientQuickBookDialog` | scheduler | Slot booking / cancel / quick-book |
| S163 | Email Composer | FORM | `/outreach/scheduler/:id` | `components/outreach/EmailComposer.tsx` | `EmailComposer` | scheduler | Inline email compose |
| S164 | Materials Panel | PANEL | `/outreach/scheduler/:id` | `components/outreach/MaterialsPanel.tsx` | `MaterialsPanel` | scheduler | Marketing materials list |
| S165 | Communication Hub | PANEL | `/outreach/scheduler/:id` | `components/outreach/CommunicationHub.tsx` | `CommunicationHub` | scheduler | Messaging hub (minimal) |
| S166 | Shortcuts Dialog | MODAL | `/outreach/scheduler/:id` | `pages/outreach-scheduler-portal.tsx` | inline Dialog | scheduler | Keyboard shortcuts help |

**Details table (Domain E)**

| S-ID | APIs / queryKeys | Parent | Children | Shared components | State coverage | Feature flags | Duplicates / notes |
|---|---|---|---|---|---|---|---|
| S141 | `/api/outreach/dashboard` | route | S142–S145 | Card | loading skeleton grid; empty schedulers | — | — |
| S143 | dashboard | S141 | — | Alert | conditional (UNAVAILABLE coverage) | — | Links to `/settings` |
| S146 | `/api/outreach/scheduler/{id}`, `/api/engagement/assignment-board` | route | S147–S166 | Sheet, Dialog | loading spinner; not-found | — | scheduler-match gated |
| S148 | appointments, tasks, email feeds | S146 | S161 (schedule popover), S140 (tasks) | Popover | popover state; badge counts | — | — |
| S154 | `sortedCallList`, `callsByPatient`, `/api/engagement/execution-cases` | S146 | S155,S156,call rows, timelines | — | scrollable; timeline expand | — | — |
| S155 | derived | S154 | — | — | CONFLICT banner (conditional) | `PHASE_1_PATIENT_EHR_ACTIVATION` | Duplicate of S079 concept |
| S156 | `/api/engagement/execution-cases` | S154 | CanonicalAppointmentSummary (S208), S157, S095 | — | collapse toggle | `VITE_FEATURE_CANONICAL_APPOINTMENT` | canonical-only |
| S158 | `latestCallByPatient[selectedId]` | S146 | script popup, reassignment badge | — | empty when no selection | — | Must-not-change: phone `tel:` link |
| S160 | `/api/outreach/calls` (legacy) + `engagementCallResultEndpoint()` (canonical) | S146 | outcome grid, structured selector, callback picker | Sheet | selection state | `VITE_USE_STRUCTURED_CALL_RESULT_SELECTOR`; dual-write | Must-not-change: dual-write legacy+canonical |
| S162 | `/api/appointments` POST, `/api/appointments/{id}` PATCH | S146 | patient search, slot grid | Dialog | duplicate-name warning (CONFLICT) | — | Duplicate of appointments-page dialogs S224 |

---

## Domain F — Engagement Center

Journey stage: **Engagement / Assignment**. Assignment-management views largely admin-scoped.

**Core table**

| S-ID | Name | Kind | Route | File | Symbol | Roles | Purpose |
|---|---|---|---|---|---|---|---|
| S167 | Engagement Center Page | PAGE | `/engagement-center` | `pages/engagement-center.tsx` | `EngagementCenterPage` | all/admin (per tab) | Multi-tab assignment/metrics dashboard |
| S168 | View Switcher | TAB | `/engagement-center` | `pages/engagement-center.tsx` | inline | all | Repository/Pool/Call Results/Call Settings tabs |
| S169 | Header Filters (Pool) | FILTER_RAIL | `/engagement-center` | `pages/engagement-center.tsx` | inline | all | Clinic/team/status + search |
| S170 | Summary Strip (Pool) | METRIC_PANEL | `/engagement-center` | `pages/engagement-center.tsx` | inline | all | Ready/Due/Follow-up/Callbacks/Blocked counts |
| S171 | Smart Filter Rail | FILTER_RAIL | `/engagement-center` | `components/engagement/EngagementFilterRail.tsx` | `EngagementFilterRail` | all | Grouped smart filters w/ counts |
| S172 | Assignment Worklist | TABLE/QUEUE | `/engagement-center` | `components/engagement/EngagementAssignmentBoard.tsx` | `EngagementWorklist` | all | Case rows + assign/bulk actions |
| S173 | Scheduler Picker | POPOVER | `/engagement-center` | `components/engagement/EngagementAssignmentBoard.tsx` | `SchedulerPicker` | all | Coverage-aware scheduler dropdown |
| S174 | Bulk Action Toolbar | BUTTON_BAR | `/engagement-center` | `components/engagement/EngagementAssignmentBoard.tsx` | inline | all | Batch assign/cancel |
| S175 | Case Detail Panel | PANEL | `/engagement-center` | `components/engagement/EngagementCasePanel.tsx` | `EngagementCasePanel` | all | Selected-case detail + assign + journey |
| S176 | Auto-Distribute Dialog | MODAL | `/engagement-center` | `pages/engagement-center.tsx` | Dialog wrapping `EngagementDistributionPanel` | admin | Capacity-aware bulk distribution |
| S177 | Distribution Panel | PANEL | `/engagement-center` | `components/engagement/EngagementDistributionPanel.tsx` | `EngagementDistributionPanel` | admin | Preview/apply member allocations + live feed |
| S178 | Repository Tab | PANEL | `/engagement-center` | `components/engagement/EngagementRepository.tsx` | `EngagementRepository` | all | Engagement-list repositories |
| S179 | Call Settings Tab | PANEL/FORM | `/engagement-center` | `components/engagement/EngagementCallSettings.tsx` | `EngagementCallSettings` | admin | Call targets/tiers/member KPIs/PTO |
| S180 | Coverage Summary | PANEL/TABLE | `/engagement-center` | `components/engagement/CoverageSummary.tsx` | `CoverageSummary` | admin | Facility×member coverage matrix |
| S181 | Call Results (Team Metrics) Tab | PANEL/METRIC_PANEL | `/engagement-center` | `components/engagement/EngagementTeamMetrics.tsx` | `EngagementTeamMetrics` | admin | Live team call metrics + activity feed |
| S182 | Engagement Baskets | DASHBOARD_TILE | `/engagement-center` (flagged) | `components/engagement/EngagementBaskets.tsx` | `EngagementBaskets` | all | 9-basket operational tile grid |
| S183 | Engagement Duplicate Banner | CONFLICT/BANNER | `/engagement-center` | `components/engagement/EngagementDuplicateBanner.tsx` | `EngagementDuplicateBanner` | all | Duplicate warning |
| S184 | Engagement Documents | PANEL | `/engagement-center` | `components/engagement/EngagementDocuments.tsx` | `EngagementDocuments` | all | Case documents view (UNKNOWN_NEEDS_VERIFICATION detail) |
| S185 | Engagement Team Metrics Activity Feed | LIST | `/engagement-center` | `components/engagement/EngagementTeamMetrics.tsx` | activity feed | admin | Paginated activity events |

**Details table (Domain F)**

| S-ID | APIs / queryKeys | Parent | Children | State coverage | Feature flags | Duplicates / notes |
|---|---|---|---|---|---|---|
| S167 | `/api/engagement/assignment-board`, `/api/outreach/schedulers` | route | S168–S182 | tab-scoped loading/empty | `VITE_FEATURE_ENGAGEMENT_MULTI_LIST_REPOSITORY` (Repository tab) | — |
| S172 | assignment-board | S167 | S173,S174 | loading; row selection | — | — |
| S175 | assignment-board + assign mutation | S167 | S173, journey timeline, S208 | panel visibility | `VITE_FEATURE_CANONICAL_APPOINTMENT` (summaries) | Assign duplicates S026/S125 |
| S177 | `/api/engagement/distribution/preview|apply|live|member-cases` | S176 | member grid, unplaced, live feed | preview/apply loading; live poll | — | — |
| S178 | `fetchRepositoryLists()` | S167 | list cards | tab visibility | `VITE_FEATURE_ENGAGEMENT_RECENT_LISTS` ("Most Recently Sent") | — |
| S179 | `/api/engagement/call-settings` | S167 | tier editor, member grid, PTO picker, dry-run preview, S180 | form/dirty state | — | admin-only |
| S181 | `/api/engagement/team-metrics` (short-poll), `/api/engagement/activity-feed` (paged) | S167 | member grid, disposition breakdown, S185 | live poll; pagination | — | admin-only |
| S182 | `/api/engagement/baskets` | S167 | basket tiles, premium cards | — | `FEATURE_ENGAGEMENT_BASKETS` (phase 3+) | — |
| S183 | derived | many | — | CONFLICT (conditional) | — | Duplicate of S079/S155 |

---

## Domain G — Scheduler / Team / Calendar

Journey stage: **Scheduling / Operations**.

**Core table**

| S-ID | Name | Kind | Route | File | Symbol | Roles | Purpose |
|---|---|---|---|---|---|---|---|
| S186 | Schedule Page (Batches) | PAGE | `/schedule` | `pages/SchedulePage.tsx` | `SchedulePage` | all (implicit admin) | Screening-batch management + filters |
| S187 | Batch Filter Bar | FILTER_RAIL | `/schedule` | `pages/SchedulePage.tsx` | inline | all | Clinic/status/scheduler/date filters |
| S188 | Batch List Table | TABLE | `/schedule` | `pages/SchedulePage.tsx` | inline | all | Batch rows w/ status/scheduler badges |
| S189 | Shared Schedule Page | PAGE | `/schedule/:id` | `pages/shared-schedule.tsx` | `SharedSchedule` | public+PIN | PIN-gated batch detail (public link) |
| S190 | PIN Entry Dialog | MODAL/UNAVAILABLE_STATE | `/schedule/:id` | `pages/shared-schedule.tsx` | inline | public | PIN unlock gate |
| S191 | Shared Schedule Patient List | TABLE | `/schedule/:id` | `pages/shared-schedule.tsx` | inline | public | Expandable patient/test list |
| S192 | Qualification Reasoning Dialog | MODAL | shared/detail views | `features/schedule/QualificationReasoningDialog.tsx` | `QualificationReasoningDialog` | all | Per-test reasoning (understanding, talking points, ICD, pearls) |
| S193 | Appointments Page | PAGE | `/appointments` | `pages/appointments.tsx` | `AppointmentsPage` | all | Clinic-tabbed appointment management |
| S194 | Clinic Tabs (Appointments) | TAB | `/appointments` | `pages/appointments.tsx` | inline / `ClinicTab` | all | Per-facility appointment view |
| S195 | Mini Calendar | CALENDAR | appointments/scheduler | `components/clinic-calendar.tsx` | `MiniCalendar` | all | Compact month calendar |
| S196 | Slot Grid | GRID/CALENDAR | appointments | `components/clinic-calendar.tsx` | `SlotGrid` | all | Time-slot grid (book/cancel) |
| S197 | Appointments Booking Dialog | MODAL | `/appointments` | `pages/appointments.tsx` | inline Dialog | all | Book slot (patient-name entry) |
| S198 | Appointments Cancel Dialog | MODAL | `/appointments` | `pages/appointments.tsx` | inline Dialog | all | Cancel appointment |
| S199 | Schedule Dashboard Page | PAGE/DASHBOARD | `/dashboard` | `pages/schedule-dashboard.tsx` | `ScheduleDashboardPage` | all | Week-view clinic schedule dashboard |
| S200 | Schedule Dashboard Week View | CALENDAR | `/dashboard` | `pages/schedule-dashboard.tsx` | inline | all | Week grid + daily snapshots + committed list |
| S201 | Team Ops Page | PAGE/DASHBOARD | `/team-ops` | `pages/team-ops.tsx` | `TeamOpsPage` | all (implicit admin) | Team scheduling/PTO/analytics |
| S202 | Team Ops Calendar/Grid | CALENDAR/TABLE | `/team-ops` | `pages/team-ops.tsx` | inline | admin | Week/month team availability + service breakdown |
| S203 | Canonical Command Calendar | CALENDAR | plexus-iq/portal | `components/calendar/CanonicalCommandCalendar.tsx` | `CanonicalCommandCalendar` | all | Shared month calendar (drawer/inline modes) |
| S204 | Completed Tests Dialog | MODAL | schedule | `features/schedule/CompletedTestsDialog.tsx` | `CompletedTestsDialog` | all | (also S091) mark tests complete |
| S205 | Schedule Tile (Home) | DASHBOARD_TILE | home | `components/ScheduleTile.tsx` | `ScheduleTile` | all | (also S024) |
| S206 | Canonical Appointment Summary | PANEL | outreach/engagement/portals | `components/canonical/CanonicalAppointmentSummary.tsx` | `CanonicalAppointmentSummary` | all | Per-service appointment status line |

**Details table (Domain G)**

| S-ID | APIs / queryKeys | Parent | State coverage | Feature flags | Duplicates / notes |
|---|---|---|---|---|---|
| S186 | `/api/screening-batches`, `/api/outreach/schedulers` | route | loading; empty; clear-filters conditional | — | — |
| S189 | `/api/screening-batches/{id}` | route | PIN gate; export; PDF dialog (S085) | — | Reuses S192, S085 |
| S190 | none (local PIN, default "1111") | S189 | is the UNAVAILABLE/locked state; error on wrong PIN | — | Must-not-change: PIN gate before batch data |
| S193 | `/api/appointments?facility={f}` | route | active clinic tab; loading | — | Dialogs duplicate S162 |
| S195/S196 | appointments prop | S193/S194, S161 | slot selection; disabled booked | — | Shared calendar primitives |
| S199 | `/api/schedule-dashboard` | route | loading; week navigation | — | — |
| S201 | `/api/team-ops/*` (UNKNOWN_NEEDS_VERIFICATION) | route | view mode; editing; EmptyState present | — | — |
| S206 | projection prop | S156,S175 | conditional history/readiness indicators | `VITE_FEATURE_CANONICAL_APPOINTMENT` | — |

---

## Domain H — PCS / ACS / Clinician & Team Portals

Journey stage: **Care coordination / Execution**. Portal role via workspace role; canonical views flag-gated.

**Core table**

| S-ID | Name | Kind | Route | File | Symbol | Roles | Purpose |
|---|---|---|---|---|---|---|---|
| S207 | Team Member Portals Landing | PAGE | `/team-member-portals` | `pages/team-member-portals.tsx` | `TeamMemberPortalsPage` | all | Portal selector (PCS/ACS) |
| S208 | PCS Portal Page | PAGE | `/patient-care-specialist-portal` | `pages/patient-care-specialist-portal.tsx` | `PatientCareSpecialistPortalPage` | PCS | PCS workspace entry |
| S209 | ACS Portal Page | PAGE | `/ancillary-care-specialist-portal` | `pages/ancillary-care-specialist-portal.tsx` | `AncillaryCareSpecialistPortalPage` | ACS | ACS workspace entry |
| S210 | Technician Portal Page | PAGE | `/technician-portal` | `pages/technician-portal.tsx` | `TechnicianPortalPage` | technician | Technician workspace entry (legacy) |
| S211 | Liaison Portal Page | PAGE | `/liaison-technician-portal` | `pages/liaison-portal.tsx` | `LiaisonPortalPage` | liaison | Liaison workspace entry (legacy) |
| S212 | Clinic Workflow Portal Adapter | ADAPTER | portals | `components/workflow/ClinicWorkflowPortal.tsx` | `ClinicWorkflowPortal` | portal roles | Routes to TeamPortalShell / PortalShell |
| S213 | Team Portal Shell | SHELL/WORKSPACE | portals | `components/portal/TeamPortalShell.tsx` | `TeamPortalShell` | PCS/ACS/tech/liaison | Multi-tab workspace w/ dock, tray, widgets |
| S214 | Workspace Mode Switcher | HEADER/TAB | portals | `components/portal/WorkspaceModeSwitcher.tsx` | `WorkspaceModeSwitcher` | portal | Clinic Schedule/Ancillary Schedule/Call List modes |
| S215 | Work Queue Composition | PANEL | portals | `components/careSpecialist/WorkspaceWorkQueueComposition.tsx` | `WorkspaceWorkQueueComposition` | portal | Sticky header + canonical section + mode body |
| S216 | Canonical Lifecycle Section | PANEL | portals | `components/careSpecialist/CanonicalLifecycleSection.tsx` | `CanonicalLifecycleSection` | PCS/ACS | Read-only canonical stage vectors |
| S217 | Canonical PCS View | PANEL | portals | `components/careSpecialist/CanonicalPcsPage.tsx` | `CanonicalPcsView` | PCS/liaison | Patient-grouped episodes + stage vectors |
| S218 | Canonical ACS View | PANEL | portals | `components/careSpecialist/CanonicalAcsPage.tsx` | `CanonicalAcsView` | ACS/tech | Per-case stage vectors |
| S219 | Stage Vector View | ROW | portals | `components/careSpecialist/StageVectorView.tsx` | `StageVectorView` | portal | 10-stage read-only workflow display |
| S220 | Workspace Canonical Header | HEADER | portals | `components/careSpecialist/WorkspaceCanonicalHeader.tsx` | `WorkspaceCanonicalHeader` | portal | Canonical section header |
| S221 | Tool Dock | DOCK | portals | `components/portal/tools/ToolDock.tsx` | `ToolDock` | portal | Left-rail tool launcher |
| S222 | Communication Tray | TRAY | portals | `components/portal/tools/CommunicationTray.tsx` | `CommunicationTray` | portal | Direct messages / team chat |
| S223 | Workspace Settings Dialog | MODAL | portals | `components/portal/tools/WorkspaceSettingsDialog.tsx` | `WorkspaceSettingsDialog` | portal | Per-user workspace prefs |
| S224 | Playground Widget Layer | PANEL | portals | `components/portal/tools/workspaceWidgets.tsx` | `PlaygroundWidgetLayer` | portal | Draggable floating widgets |
| S225 | Call Workspace | WORKSPACE | portals | `components/portal/CallWorkspace.tsx` | `CallWorkspace` | portal | Call-list row workspace + dispositions |
| S226 | Scheduling Workspace | WORKSPACE/CALENDAR | portals | `components/portal/SchedulingWorkspace.tsx` | `SchedulingWorkspace` | portal | Big-calendar ancillary scheduling |
| S227 | Patient Command Canvas | WORKSPACE | portals | `components/portal/PatientCommandCanvas.tsx` | `PatientCommandCanvas` | portal | Unified patient action center |
| S228 | Portal Patient Directory | WORKSPACE | portals | `components/portal/PortalPatientDirectory.tsx` | `PortalPatientDirectory` | portal | Full EHR chart from portal (wraps S061) |
| S229 | Selected Case Overview | PANEL | portals | `components/portal/SelectedCaseOverview.tsx` | `SelectedCaseOverview` | portal | Single-case detail + ancillary docs |
| S230 | Case Overview | PANEL | portals | `components/portal/CaseOverview.tsx` | `CaseOverview` | portal | Case detail display (read-only) |
| S231 | Queue Filter Tabs | FILTER_RAIL | portals | `components/portal/QueueFilterTabs.tsx` | `QueueFilterTabs` | portal | Follow-up disposition filter tabs |
| S232 | Compact Call/Clinic/Ancillary Rows | ROW | portals | `components/portal/CompactCallRow.tsx` | `CompactCallRow`,`CompactClinicRow`,`CompactAncillaryRow` | portal | Right-panel list rows |
| S233 | Call Row Quick Actions | MENU | portals | `components/portal/CallRowQuickActions.tsx` | `CallRowQuickActions` | portal | Row action menu |
| S234 | My Patients Tab | TAB | portals | `components/portal/PortalMyPatientsTab.tsx` | `PortalMyPatientsTab` | portal | Recently-touched patients |
| S235 | Patient Search Tab | TAB/SEARCH | portals | `components/portal/PortalPatientSearchTab.tsx` | `PortalPatientSearchTab` | portal | Facility-constrained search |
| S236 | Plexus Tasks Tab | TAB | portals | `components/portal/PortalPlexusTasksTab.tsx` | `PortalPlexusTasksTab` | portal | Canonical task feed |
| S237 | Document Library Tab | TAB | portals | `components/portal/PortalDocumentLibraryTab.tsx` | `PortalDocumentLibraryTab` | portal | Read-only doc library browse |
| S238 | Email Composer Tab | TAB/FORM | portals | `components/portal/PortalEmailComposerTab.tsx` | `PortalEmailComposerTab` | portal | Email composition |
| S239 | Templates & Resources Tab | TAB | portals | `components/portal/PortalTemplatesResourcesTab.tsx` | `PortalTemplatesResourcesTab` | portal | Staff resources/templates |
| S240 | Marketing Tab | TAB | portals | `components/portal/PortalMarketingTab.tsx` | `PortalMarketingTab` | portal | Patient-facing brochures |
| S241 | Quick Note Tool | TAB | portals | `components/portal/QuickNoteTool.tsx` | `QuickNoteTool` | portal | Write patient note |
| S242 | Internal Contacts Tool | TAB | portals | `components/portal/InternalContactsTool.tsx` | `InternalContactsTool` | portal | Internal team contacts |
| S243 | Calls Repository Panel | TAB | portals | `components/portal/CallsRepositoryPanel.tsx` | `CallsRepositoryPanel` | portal | Worked-call archive + recall |
| S244 | Ancillary Doc Modals | MODAL/SIGNATURE | portals | `components/portal/AncillaryDocModals.tsx` | `AncillaryDocModals` | ACS/tech | Consent/screening/report workflows |
| S245 | Signature Pad | SIGNATURE | portals | `components/portal/SignaturePad.tsx` | `SignaturePad` | portal | Canvas signature capture |
| S246 | Report Upload Panel | PANEL | portals | `components/portal/ReportUploadPanel.tsx` | `ReportUploadPanel` | ACS/tech | Upload report + mark readiness |
| S247 | ACS Workflow Panel | PANEL | portals | `components/portal/AcsWorkflowPanel.tsx` | `AcsWorkflowPanel` | ACS | ACS execution-case status snapshot |
| S248 | Ancillary Readiness Row | ROW | portals | `components/portal/AncillaryReadinessRow.tsx` | `AncillaryReadinessRow` | portal | Case readiness row |
| S249 | Patient Call History Panel | PANEL | portals | `components/portal/PatientCallHistoryPanel.tsx` | `PatientCallHistoryPanel` | portal | Call-attempt timeline |
| S250 | Patient Notes Panel | PANEL | portals | `components/portal/PatientNotesPanel.tsx` | `PatientNotesPanel` | portal | Read-only quick-note list |
| S251 | Patient Mini Calendar | SIDEBAR/CALENDAR | portals | `components/portal/PatientMiniCalendar.tsx` | `PatientMiniCalendar` | portal | Compact left-rail calendar |
| S252 | Left Rail Compact Calendar | SIDEBAR/CALENDAR | portals | `components/portal/leftRail/LeftRailCompactCalendar.tsx` | `LeftRailCompactCalendar` | portal | Collapsed-rail calendar |
| S253 | Patient Directory Facts Card | CARD/PATIENT_HEADER | portals | `components/portal/PatientDirectoryFactsCard.tsx` | `PatientDirectoryFactsCard` | portal | Quick-ref patient demographics |
| S254 | Log Communication Dialog | MODAL | portals | `components/portal/LogCommunicationDialog.tsx` | `LogCommunicationDialog` | portal | Multi-type comms logger |
| S255 | Schedule Patient Dialog | MODAL | portals | `components/portal/SchedulePatientDialog.tsx` | `SchedulePatientDialog` | portal | Fast popup scheduling |
| S256 | Calendar Quick Schedule Dialog | MODAL | portals | `components/portal/CalendarQuickScheduleDialog.tsx` | `CalendarQuickScheduleDialog` | portal | Quick schedule from calendar |
| S257 | Portal Messages Panel/Window | PANEL/WINDOW | portals | `components/portal/messaging/PortalMessagesPanel.tsx`,`PortalMessagesWindow.tsx` | `PortalMessagesPanel`,`PortalMessagesWindow` | portal | Direct-message list + chat window |
| S258 | Clinician Portal Shell | SHELL | `/clinician-portal` | `components/physician/ClinicianPortalShell.tsx` | `ClinicianPortalShell` | admin,clinician | Physician portal container + search + role selector |
| S259 | Physician Portal Shell | SHELL | `/clinician-portal` | `components/physician/PhysicianPortalShell.tsx` | `PhysicianPortalShell` | admin,clinician | Wrapper for S258 |
| S260 | Command Center Dashboard Home | PAGE/DASHBOARD_TILE | `/clinician-portal` | `components/physician/DashboardHome.tsx` | `DashboardHome` | clinician | 3-tile command center |
| S261 | Finance Workspace | TAB | `/clinician-portal` | `components/physician/finance/FinancePage.tsx` | `FinancePage`/`LegacyFinancePage` | finance role | Financial metrics/claims/invoices (mock or canonical) |
| S262 | Orders & Notes Workspace | TAB | `/clinician-portal` | `components/physician/orders/OrdersNotesPage.tsx` | `OrdersNotesPage`/`LegacyOrdersNotesPage` | clinician | Notes/orders/signatures |
| S263 | Plexus Engagement Workspace | TAB | `/clinician-portal` | `components/physician/engagement/PlexusEngagementPage.tsx` | `PlexusEngagementPage`/`Legacy...` | clinician | Call list/engagement/escalations |
| S264 | Canonical Overview Panel | PANEL | `/clinician-portal` | `components/physician/CanonicalOverviewPanel.tsx` | `CanonicalOverviewPanel` | clinician | Unified live-data rows (Finance/Orders/Engagement) |
| S265 | Canonical Finance Page | PAGE | `/clinician-portal` | `components/physician/canonical/CanonicalFinancePage.tsx` | `CanonicalFinancePage` | finance role | Operational readiness (no financials) |
| S266 | Canonical Orders & Notes Page | PAGE | `/clinician-portal` | `components/physician/canonical/CanonicalOrdersNotesPage.tsx` | `CanonicalOrdersNotesPage` | clinician | Unified documents table |
| S267 | Canonical Engagement Page | PAGE | `/clinician-portal` | `components/physician/canonical/CanonicalEngagementPage.tsx` | `CanonicalEngagementPage` | clinician | Ancillary cases + memberships |
| S268 | Canonical Financial Ledger Panel | PANEL/PAYMENT_VIEW | `/clinician-portal` | `components/physician/canonical/CanonicalFinancialLedgerPanel.tsx` | `CanonicalFinancialLedgerPanel` | finance role | Ledger transactions/adjustments/payments |
| S269 | Financial Health Tab | TAB/BILLING_VIEW | `/clinician-portal` | `components/physician/FinancialHealthTab.tsx` | `FinancialHealthTab` | finance role | Practice + Plexus finance metrics |
| S270 | Finance Tab Disabled | UNAVAILABLE_STATE | `/clinician-portal` | `components/physician/FinanceTabDisabled.tsx` | `FinanceTabDisabled` | clinician | Finance access-restricted card |
| S271 | Signatures Tab | TAB/SIGNATURE | `/clinician-portal` | `components/physician/SignaturesTab.tsx` | `SignaturesTab` | clinician | Signature queue + sign dialog |
| S272 | Reports Tab | TAB | `/clinician-portal` | `components/physician/ReportsTab.tsx` | `ReportsTab` | clinician | Result-upload status table |
| S273 | Ancillary Metrics Tab | TAB/METRIC_PANEL | `/clinician-portal` | `components/physician/AncillaryMetricsTab.tsx` | `AncillaryMetricsTab` | clinician | Per-service stage funnel |
| S274 | Physician DataTable | TABLE | `/clinician-portal` | `components/physician/ui/DataTable.tsx` | `DataTable` | clinician | Generic sortable table |
| S275 | Physician UI Primitives | COMPONENT | `/clinician-portal` | `components/physician/ui/primitives.tsx` | `StatCard`,`StatusPill`,`FilterBar`,etc. | clinician | Reusable portal primitives |

**Details table (Domain H) — key rows**

| S-ID | APIs / queryKeys | Parent | State coverage | Feature flags | Notes |
|---|---|---|---|---|---|
| S213 | `/api/portal/today`, `/api/portal/team-members`, `/api/admin-settings/effective`, `/api/portal/my-facilities` + mode feeds | S212 | multi-mode persisted prefs; loading/error/empty per feed | — | ~4k-line shell; some deep flows UNKNOWN_NEEDS_VERIFICATION |
| S216 | `/api/pcs-canonical-view` or `/api/acs-canonical-view` (cursor) | S215 | loading/error/**migration error**/**disabled**/empty | `VITE_FEATURE_PCS_CANONICAL_VIEW`,`VITE_FEATURE_ACS_CANONICAL_VIEW` | Rich UNAVAILABLE/CONFLICT vocabulary |
| S219 | server-computed | S217/S218 | per-stage: available/**upstream_flag_off**/**unavailable**/**migration_missing** | flag-gated | CONFLICT: "current: (integrity)" badge |
| S227 | `/api/portal/command-center/:patientId`, `/api/acs-workflow/:id`, `/api/patient-notes`, `/api/portal/communication-timeline` | S213 | multi-panel loading/error | — | Composes S246,S247,S249,S250,S093 |
| S228 | `/api/patients/database/resolve/:patientScreeningId` | S213 | resolve loading/error | — | Wraps S061 |
| S244 | `/api/portal/uploads`,`/api/portal/sign-consent`,`/api/case-document-readiness/complete` | S213 | mode/instance state; loading/error | — | procedure actions gated ACS/tech; uses S245 |
| S258 | `/api/auth/me`, `/api/clinician-portal/*` | route (RoleGuard) | global nav state | — | — |
| S261–S263 | `/api/clinician-portal/finance|notes|orders|engagement` | S258/S260 | mock OR canonical (flag) | `VITE_FEATURE_CLINICIAN_PORTAL_CANONICAL_DATA` | Legacy vs canonical duplicate pairs |
| S265 | `/api/clinician-portal/canonical-finance` | S261 | RestrictedAccessCard if no finance access | canonical flag | UNAVAILABLE: RestrictedAccessCard |
| S268 | `useCanonicalFinancialLedger()` | S265 | UNKNOWN_NEEDS_VERIFICATION | `VITE_FEATURE_CANONICAL_PAYMENTS`/claims (UNKNOWN which) | Phase 2J ledger |
| S270 | none | S258 | is the UNAVAILABLE surface | — | — |

---

## Domain I — Documents / Ancillary Documents / Drive

Journey stage: **Documentation**.

**Core table**

| S-ID | Name | Kind | Route | File | Symbol | Roles | Purpose |
|---|---|---|---|---|---|---|---|
| S276 | Ancillary Documents Page | PAGE | `/ancillary-documents` | `pages/documents.tsx` | `DocumentsPage` | all | Facility→date→patient→service note browser |
| S277 | Note Viewer | DOCUMENT_VIEWER/SHEET | `/ancillary-documents` | `pages/documents.tsx` | inline | all | Expandable note sections + copy/print |
| S278 | Document Section Card | DOCUMENT_VIEWER/CARD | documents/results/billing | `components/DocumentSection.tsx` | `DocumentSection` | all | Note section display + copy/print |
| S279 | Canonical Ancillary Documents List | PAGE/TABLE | `/ancillary-documents` (flagged) | `components/ancillary-documents/CanonicalAncillaryDocuments.tsx` | `CanonicalAncillaryDocumentsList` | all | Keyset-paginated canonical docs + filters |
| S280 | Ancillary Documents Card (compact) | CARD | patient EHR/portals | `components/ancillary-documents/CanonicalAncillaryDocuments.tsx` | `AncillaryDocumentsCard` | all | Compact docs by case/service |
| S281 | Ancillary Documents Summary (tiny) | BADGE | ACS/PCS | `components/ancillary-documents/CanonicalAncillaryDocuments.tsx` | `AncillaryDocumentsSummary` | all | Badge-only doc status |
| S282 | Document Upload Page | PAGE | `/document-upload` | `pages/document-upload.tsx` | `DocumentUploadPage` | all | Upload report/consent/screening PDFs (OCR) |
| S283 | Upload Cards | CARD/FORM | `/document-upload` | `pages/document-upload.tsx` | `UploadCard` | all | Per-doc-type upload w/ OCR name extract |
| S284 | Document Library Page | PAGE | `/document-library` | `pages/document-library.tsx` | `DocumentLibraryPage` | admin | Bookshelf library browse/upload/version |
| S285 | Book Spine + Popover | BUTTON/POPOVER | `/document-library` | `pages/document-library.tsx` | `BookSpine` | admin | Document details + actions |
| S286 | Version List | PANEL | `/document-library` | `pages/document-library.tsx` | `VersionList` | admin | Document version history |
| S287 | Library Upload Dialog | MODAL | `/document-library` | `pages/document-library.tsx` | Dialog | admin | Add document to library |
| S288 | Drive Page | PAGE | `/drive` (unrouted?) | `pages/drive.tsx` | `DrivePage` | UNKNOWN_NEEDS_VERIFICATION | Google Drive wrapper |
| S289 | Plexus Drive Browser | DOCUMENT_VIEWER/PANEL | drive | `components/PlexusDrive.tsx` | `PlexusDrive` | UNKNOWN_NEEDS_VERIFICATION | Drive folder browse/search/move |
| S290 | Drive Move File Dialog | MODAL | drive | `components/PlexusDrive.tsx` | Dialog + `FolderTreePicker` | — | Move file (folder-tree picker) |

Note: `/drive` is not in `App.tsx`'s routed switch — `DrivePage`/`PlexusDrive` may be embedded rather than routed (UNKNOWN_NEEDS_VERIFICATION).

## Domain J — Billing / Claims / Invoices / Payments

Journey stage: **Billing / Revenue**. Nearly all admin/biller-gated.

**Core table**

| S-ID | Name | Kind | Route | File | Symbol | Roles | Purpose |
|---|---|---|---|---|---|---|---|
| S291 | Billing Page | PAGE/BILLING_VIEW | `/billing` | `pages/billing.tsx` | `BillingPage` | admin/biller | Overview + Records tabs |
| S292 | Billing Overview Tab | TAB/METRIC_PANEL | `/billing` | `pages/billing.tsx` | `BillingOverview` | admin/biller | Balance/facility/aging summary |
| S293 | Billing Records Tab | TAB/TABLE | `/billing` | `pages/billing.tsx` | `BillingRecords` | admin/biller | Searchable billing records table |
| S294 | Canonical Billing Panel | PANEL | billing pages | `components/billing/CanonicalBillingPanel.tsx` | `CanonicalBillingPanel` | admin/biller | 4-section pipeline (package/payment/paid/missing docs) |
| S295 | Billing Readiness Page | PAGE/QUEUE | `/billing/readiness` | `pages/billing-readiness.tsx` | `BillingReadinessPage` | admin | Readiness snapshots + filters |
| S296 | Billing Reports Page | PAGE/METRIC_PANEL | `/billing/reports` | `pages/billing-reports.tsx` | `BillingReportsPage` | admin | EOD/weekly/monthly report cards |
| S297 | Invoices Page | PAGE/INVOICE_VIEW | `/invoices` | `pages/invoices.tsx` | `InvoicesPage` | admin/biller | Invoice overview/list + detail |
| S298 | Invoices Overview Tab | TAB | `/invoices` | `pages/invoices.tsx` | `BillingOverview` (invoices) | admin/biller | Outstanding by clinic/aging bucket |
| S299 | Invoices List Tab | TAB/TABLE | `/invoices` | `pages/invoices.tsx` | `InvoicesList` | admin/biller | Filterable invoice table |
| S300 | Invoice Detail View | INVOICE_VIEW | `/invoices` | `pages/invoices.tsx` | `InvoiceDetail` | admin/biller | Line items/payments/aging + actions |
| S301 | Create Invoice Dialog | MODAL | `/invoices` | `pages/invoices.tsx` | `CreateInvoiceDialog` | admin/biller | Create invoice from records |
| S302 | Invoice Batches Page | PAGE/TABLE | `/billing/invoice-batches` | `pages/invoice-batches.tsx` | `InvoiceBatchesPage` | admin | Batch preview builder |
| S303 | Invoice Review Page | PAGE/CLAIM_VIEW | `/billing/invoice-review` | `pages/invoice-review.tsx` | `InvoiceReviewPage` | admin | Draft→review→approve workflow |
| S304 | Invoice Review Void Dialog | MODAL | `/billing/invoice-review` | `pages/invoice-review.tsx` | inline | admin | Void invoice w/ reason |
| S305 | Invoice Delivery Page | PAGE/QUEUE | `/billing/invoice-delivery` | `pages/invoice-delivery.tsx` | `InvoiceDeliveryPage` | admin | Approval-gated delivery queue |
| S306 | Invoice Delivery Events Card | PANEL | `/billing/invoice-delivery` | `pages/invoice-delivery.tsx` | inline | admin | Delivery event log |
| S307 | Invoice Financial Panel | PAYMENT_VIEW/PANEL | remittance/invoices | `components/billing/InvoiceFinancialPanel.tsx` | `InvoiceFinancialPanel` | admin/biller | Payment/adjustment/denial/remittance forms + history |
| S308 | Invoice Desk Panel (portal) | PANEL/INVOICE_VIEW | portals | `components/portal/InvoiceDeskPanel.tsx` | `InvoiceDeskPanel` | portal (restricted) | Mock invoice create/send/notes |
| S309 | Invoice Draft Panel | PANEL/UNAVAILABLE_STATE | portals | `components/portal/InvoiceDraftPanel.tsx` | `InvoiceDraftPanel` | portal | Placeholder invoice draft (flag off) |
| S310 | Report Upload Panel (billing angle) | PANEL | portals | `components/portal/ReportUploadPanel.tsx` | `ReportUploadPanel` | ACS | (also S246) upload → readiness |

**Details table (Domains I+J) — key rows**

| S-ID | APIs / queryKeys | State coverage | Feature flags | Notes |
|---|---|---|---|---|
| S276 | `/api/generated-notes`, `/api/screening-batches` | loading spinner; empty "No ancillary documents yet" | — | Collapsible facility/date/patient/service groups |
| S279 | `/api/ancillary-documents`, `/api/ancillary-documents/infinite` | loading; empty "No canonical documents" | `VITE_FEATURE_UNIFIED_ANCILLARY_DOCUMENTS` | — |
| S282/S283 | `/api/documents/ocr-name`, `/api/documents/upload` | OCR "Extracting patient name…"; success card; upload-failed toast | — | — |
| S284 | `/api/documents-library/meta|.../versions/{id}|/upload` | RefreshCw spinner; "Shelf is empty" per kind | — | admin-only |
| S291 | `/api/billing-records`, `/api/invoice-links/{id}`, `/api/aging`, `/api/generated-notes` | RefreshCw spinner; empty card | — | implicit admin/biller |
| S295 | `invoice-readiness` | loading; empty "No readiness snapshots match this filter"; ERROR "Failed to load readiness snapshots" | — | — |
| S296 | `eod`,`weekly`,`monthly` | loading per report; "—" for missing | — | — |
| S297 | `/api/invoices/aging|/api/invoices|/api/invoices/{id}` | RefreshCw; empty "No invoices yet"/"No outstanding balances"; "Invoice not found" | `VITE_FEATURE_CANONICAL_INVOICES` (canonical variant) | — |
| S300 | `/api/invoices/{id}(+payments/adjustments/denials)` | loading; not-found | canonical claims/payments flags | line items/payments/aging tabs |
| S303 | `invoices-all`, `/api/invoices/drafts/batch`, submit/approve/void/revise | loading; empty "No invoices yet" | `VITE_FEATURE_CANONICAL_CLAIMS` | approval workflow |
| S305 | `invoice-delivery-queue|events`, queue/send/remind | loading; empty "No invoices in this delivery state" | — | status tabs |
| S307 | `invoice-financial-events` (+payments/adjustments/denials/remittances POST) | loading "Loading…"; "none" empty lists | `VITE_FEATURE_CANONICAL_PAYMENTS` | Reused by remittance-audit (S325) |
| S308 | Plexus Bank mock (`usePlexusBank`) | — | — | mock-backed |
| S309 | none | is the UNAVAILABLE surface | `VITE_USE_INVOICE_UI` (off) | — |

---

## Domain K — Settings / Admin

Journey stage: **Administration**. All `AdminGuard`-gated. `AdminSettingsPage` is a hub with hash `#tab` sections and `?log=` sub-tabs; the former standalone pages are now embedded.

**Core table**

| S-ID | Name | Kind | Route | File | Symbol | Roles | Purpose |
|---|---|---|---|---|---|---|---|
| S311 | Admin Settings Hub | PAGE/TAB | `/admin/settings` | `pages/admin-settings.tsx` | `AdminSettingsPage` | admin | Unified admin hub (5 tabs) |
| S312 | System Settings Tab | TAB | `?tab=system` | `pages/admin-settings.tsx` | `activeSection="system"` | admin | AI models, qual modes, ops rules, test fixture |
| S313 | Billing Settings Tab | TAB | `?tab=billing` | `pages/admin-settings.tsx` | `activeSection="billing"` | admin | Pricing/invoice schedules/reminders |
| S314 | Team Settings Tab | TAB | `?tab=team` | `pages/admin-settings.tsx` | `activeSection="team"` | admin | Users/roles/passwords/call-list distribution |
| S315 | Facility Settings Tab | TAB | `?tab=facility` | `pages/admin-settings.tsx` | `activeSection="facility"` | admin | Stovetop heat tuning |
| S316 | Logs & Audits Tab | TAB | `?tab=logs` | `pages/admin-settings.tsx` | `activeSection="logs"` | admin | 6 log sub-tabs via `?log=` |
| S317 | Admin Settings Center | PANEL | `#system` | `pages/admin-settings-center.tsx` | `AdminSettingsCenterPage` | admin | Effective settings + per-domain edit rows |
| S318 | Qualification Mode Settings | PANEL | `#system` | `components/QualificationModeSettings.tsx` | `QualificationModeSettings` | admin | Per-facility qual mode |
| S319 | Admin Users | PANEL/TABLE | `#team` | `pages/admin-users.tsx` | `AdminUsersPage` | admin | Create/list/deactivate/delete users |
| S320 | Stovetop Heat Settings | PANEL | `#facility` | `pages/stovetop-heat-settings.tsx` | `StovetopHeatSettingsPage` | admin | Per-facility heat knob |
| S321 | Billing Settings Page | PANEL | `#billing` | `pages/billing-settings.tsx` | `BillingSettingsPage` | admin/biller | Effective billing policy + rows |
| S322 | Audit Log | PANEL/TABLE | `?log=audit` | `pages/audit-log.tsx` | `AuditLogPage` | admin | CRUD compliance trail |
| S323 | Analysis Jobs | PANEL/TABLE | `?log=analysis-jobs` | `pages/admin-analysis-jobs.tsx` | `AdminAnalysisJobsPage` | admin | Batch analysis run history |
| S324 | Outbox | PANEL/TABLE | `?log=outbox` | `pages/admin-outbox.tsx` | `AdminOutboxPage` | admin | Drive/Sheet upload queue (live 5s) |
| S325 | Billing Auditor | PANEL/TABLE | `?log=billing-auditor` | `pages/billing-auditor.tsx` | `BillingAuditorPage` | admin | Read-only billing queues |
| S326 | Call List Audit | PANEL/TABLE | `?log=call-list-audit` | `pages/call-list-audit.tsx` | `CallListAuditPage` | admin | Scheduler mapping validation + dry-run |
| S327 | Remittance Audit | PANEL | `?log=remittance` | `pages/remittance-audit.tsx` | `RemittanceAuditPage` | admin/biller | Invoice-ID lookup → S307 |
| S328 | Admin Hub Page | PAGE/DASHBOARD_TILE | `/admin`→redirect | `pages/admin.tsx` | `AdminPage` | admin | Card-grid hub (legacy) |
| S329 | Admin Ops Page | PAGE | `/admin-ops`→redirect | `pages/admin-ops.tsx` | `AdminOpsPage` | admin | Card hub (deprecated) |
| S330 | Settings Page (legacy) | PAGE | `/settings`→redirect | `pages/settings.tsx` | components (`SchedulerTeamSection`,`CallListDistributionCard`,`ChangePasswordCard`,`OperationalRuleSections`) | admin | Legacy settings sections (now embedded) |
| S331 | Add User Dialog | MODAL | `#team` | `pages/admin-users.tsx` | Dialog | admin | Create user |
| S332 | User Delete/Deactivate Confirm | MODAL/CONFLICT | `#team` | `pages/admin-users.tsx` | AlertDialog | admin | Confirm delete/deactivate ("username taken" conflict) |
| S333 | Test Fixture Card | PANEL | `#system`,`/admin` | `pages/admin-settings.tsx`/`admin.tsx` | `TestFixtureCard` | admin | Run/auto-upload/cleanup fixture |
| S334 | Invoice Reminder Settings Card | PANEL | `#billing` | `pages/admin-settings.tsx` | `InvoiceReminderSettingsCard` | admin | Overdue invoice reminder schedule |

**Details table (Domain K) — key rows**

| S-ID | APIs / queryKeys | State coverage | Notes |
|---|---|---|---|
| S311 | per-tab | hash+query nav; per-section loading/error | 13 legacy admin pages consolidated here |
| S317 | `/api/admin-settings/effective|/list`, PATCH `/{id}` | loading Loader2; ERROR AlertCircle "Failed to load admin settings" | source badges (test_type/facility/user/global/default) |
| S319 | `/api/users` (+POST/DELETE/PATCH deactivate) | loading; empty "No users yet."; CONFLICT "username already taken" | — |
| S321 | `/api/billing-policy/effective|/settings`, PATCH | loading "Loading billing policy…"; ERROR AlertCircle | — |
| S322 | `/api/audit-log(+/users)` | loading spinner | filters user/entity/date |
| S324 | `/api/outbox(+/drain|/retry-failed)`, DELETE | loading; live refetch 5s; status badges | — |
| S325 | `/api/billing-auditor/summary|/worklist/{queueId}` | loading; empty "No items in this queue." | queue tabs |
| S326 | `/api/admin/call-list-audit(+/dry-run)` | loading; visibility badges (visible/overdue/missing_user_mapping = CONFLICT-ish) | — |
| S327 | via S307 | conditional (valid invoice ID) | prompt card when empty |

---

## State-pattern surfaces (representative per domain)

Not exhaustive — one or two representative instances per pattern per domain. `client/src/components/ui/` provides the primitives (`skeleton.tsx`, `alert.tsx`, `alert-dialog.tsx`, `toast.tsx`/`toaster.tsx`, `dialog.tsx`, `sheet.tsx`, `drawer.tsx`, `popover.tsx`, `tabs.tsx`, `table.tsx`, `hover-card.tsx`, `command.tsx`). No dedicated shared `EmptyState`/`Skeleton` app component exists; teams build these inline (physician `ui/primitives.tsx` and careSpecialist views define local `EmptyState`/state helpers).

| S-ID | Pattern | Domain | Representative surface (file · symbol) | Notes |
|---|---|---|---|---|
| S335 | LOADING_STATE | Global | `App.tsx` AppShell spinner (S009) | Full-screen auth spinner |
| S336 | LOADING_STATE | Home | `HomeDashboard.tsx` dashboard skeleton; `HomeLiveDashboard.tsx` `homeStatsLoading` | — |
| S337 | LOADING_STATE | Patient Directory | `PatientChart.tsx` `PatientChartSkeleton`,`SectionSkeleton` | Seeded-name instant skeleton |
| S338 | LOADING_STATE | Plexus IQ | `PlexusIQDayModal.tsx` Loader2; operating skeleton rows | — |
| S339 | LOADING_STATE | Billing/Invoices | `pages/invoices.tsx`,`billing-readiness.tsx` Loader2 | — |
| S340 | LOADING_STATE | Portals | `TeamPortalShell` feeds; `CanonicalOverviewPanel` loading | — |
| S341 | EMPTY_STATE | Mission Control | `mission-control.tsx` lanes empty (CircleDashed) | — |
| S342 | EMPTY_STATE | Patient Directory | `PatientProfileTabs.tsx` per-tab empties ("No documents on file" etc.) | — |
| S343 | EMPTY_STATE | Engagement | `EngagementRepository`/worklist empties | — |
| S344 | EMPTY_STATE | Billing | `billing-auditor.tsx` "No items in this queue."; `invoices` "No invoices yet" | — |
| S345 | EMPTY_STATE | Admin | `admin-users.tsx` "No users yet." | — |
| S346 | EMPTY_STATE | Team Ops | `team-ops.tsx` EmptyState | — |
| S347 | ERROR_STATE | Global | `not-found.tsx` (S008) | 404 card |
| S348 | ERROR_STATE | Patient Directory | `PatientChartSections.tsx` `AccessDeniedSection`; profile "Failed to load patient profile" | Access-denied on hidden section |
| S349 | ERROR_STATE | Billing | `billing-readiness.tsx`/`billing-settings.tsx` AlertCircle | — |
| S350 | ERROR_STATE | Admin | `admin-settings-center.tsx` AlertCircle "Failed to load admin settings." | — |
| S351 | ERROR_STATE | Plexus IQ | `AdminReviewDialog` regenerate-failure toast; `PlexusIQOperatingRow` "Save failed" badge | — |
| S352 | UNAVAILABLE_STATE | Mission Control | `mission-control.tsx` `sourceMissing`→"N/A"/"No data available yet"; RingCentral not-connected; Chat "not connected yet" | — |
| S353 | UNAVAILABLE_STATE | Portals (canonical) | `StageVectorView` per-stage `upstream_flag_off`/`unavailable`/`migration_missing`; `CanonicalLifecycleSection` disabled/migration copy | Richest UNAVAILABLE vocabulary |
| S354 | UNAVAILABLE_STATE | Clinician portal | `FinanceTabDisabled` (S270); `CanonicalFinancePage` RestrictedAccessCard | — |
| S355 | UNAVAILABLE_STATE | Patient Directory | `PatientAuditTrailModal` "endpoint unavailable" when flag off | `PHASE_1_PATIENT_EHR_ACTIVATION` |
| S356 | UNAVAILABLE_STATE | Portals (billing) | `InvoiceDraftPanel` placeholder (S309) | `VITE_USE_INVOICE_UI` off |
| S357 | CONFLICT_STATE | Patient Directory | `DuplicateWarningBadge`/`AdminReviewDuplicateGuard`/`EngagementHandoffDuplicateBar` (S077–S079) | Duplicate/DNC/cooldown |
| S358 | CONFLICT_STATE | Outreach/Engagement | `CallListDuplicateBanner` (S155), `EngagementDuplicateBanner` (S183); booking duplicate-name warning (S162) | — |
| S359 | CONFLICT_STATE | Admin | `admin-users.tsx` "username already taken" (S332) | — |
| S360 | CONFLICT_STATE | Portals (canonical) | `StageVectorView` "current: (integrity)" badge | Data-integrity conflict |
| S361 | TOAST_ALERT | Global | `Toaster` (`components/ui/toaster.tsx`); default-admin toast (S010) | `useToast` used across mutations |

---

## Cross-cutting duplicate / similar surfaces (for downstream de-dup analysis)

- **Patient assignment to scheduler:** S026 (home) · S125 (qualification) · S173/S175 (engagement). Same concept, three UIs.
- **Patient EHR search:** S028 (home references) · S043 (mission control) · S235 (portal) · S057 (directory rail) · global dock search (S005).
- **Patient profile view:** S061/S062 (workspace chart) vs S068 (live drawer) vs S253 (portal facts card).
- **Duplicate/DNC warning:** S077 badge reused as S078, S079, S155, S183.
- **Calendar primitives:** S161 (TriClinic) · S195/S196 (mini/slot) · S203 (canonical command) · S111 (Plexus IQ) · S251/S252 (portal). Multiple calendar implementations.
- **Booking dialogs:** S162 (outreach) vs S197/S198 (appointments page) vs S255/S256 (portal quick-schedule) vs S086 (AppointmentModal).
- **ResultsView reuse:** S030 rendered by home and by Plexus IQ Day Modal (S110).
- **Invoice financial forms:** S307 reused by invoice detail (S300) and remittance audit (S327).
- **Canonical vs legacy pairs (flag-toggled):** S261–S263 legacy vs S265–S267 canonical; S276 legacy notes vs S279 canonical docs; S160 legacy vs canonical call-result write.

## Must-not-change behaviors (called out by surfaces)

- **Auth/logout (S001):** logout POSTs `/api/auth/logout` then clears the React Query cache — surface must preserve this order.
- **Shared Schedule PIN gate (S190):** batch data must remain gated behind PIN entry (public link).
- **Disposition dual-write (S160):** call outcomes dual-write legacy + canonical endpoints under flag control.
- **Admin approval duplicate guard (S078/S123):** approval must stay hard-blocked on active DNC/cooldown.
- **Default-admin toast (S010):** fires only for username `admin`.
- **Section access gating (S062/S066/S080):** role×section access (hidden/summary/full) governs chart section visibility and deep-link access-denied.

---

## S-ID summary

Assigned range: **S001–S361**. IDs are sequential and stable; S121 is a reserved/merged placeholder (folded into S099). Downstream Phase 2L documents should cite these IDs directly.
