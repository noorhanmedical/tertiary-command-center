# Phase 2L — Route ↔ Role ↔ Surface Map

**Scope:** Documentation-only artifact. No application source was changed, created, or deleted while producing this file. Every claim is derived by reading source at branch `phase/2l-ui-discovery`, HEAD `08a78978`. The authoritative router is `client/src/App.tsx` (`AuthenticatedApp`, lines 79–328, wouter `<Switch>`/`<Route>`). Global-nav visibility is `shouldShowGlobalNav()` in `client/src/lib/navigation/navigationRegistry.ts`. This is factual mapping only — no design decisions, recommendations, or logic changes are proposed here. Cells that could not be confirmed from source are marked `UNKNOWN_NEEDS_VERIFICATION`.

> Correction to seed note: the seed said "4 roles app-wide (admin, clinician, scheduler, biller)". Source shows **6 roles** in the canonical enum `USER_ROLES = ["admin","clinician","scheduler","biller","technician","liaison"]` (`shared/schema/users.ts:4`). `technician` and `liaison` are used by `client/src/components/GlobalNav.tsx` nav-item `roles[]` and by server portal guards (`server/routes/portal.ts:41`, `server/routes/pcsAcsCanonical.ts:22-23`). This document uses the 6-role reality.

---

## Legend — status values

| Status | Meaning |
|--------|---------|
| **ACTIVE** | Renders a real page component; wired to live `/api/*` data. |
| **CONDITIONAL** | Renders in-page content that changes by role/state (no separate guard). |
| **ROLE_RESTRICTED** | Wrapped in `RoleGuard` or `AdminGuard` (`App.tsx`); non-matching roles redirect to `/home`. |
| **LEGACY** | A `<Redirect>` route kept for back-compat with old bookmarks/deep links. |
| **PREVIEW** | A preview/parallel copy of a production surface (e.g. `/home-preview`). |
| **PLAYGROUND** | Design prototype / demo / localStorage-only mock; not wired to production backend. |
| **DEAD_OR_UNREACHABLE** | Page component exists under `client/src/pages` but is not a `<Route>` target, not a redirect target, and not imported/rendered elsewhere. |
| **UNKNOWN_NEEDS_VERIFICATION** | Could not be determined from source. |

**Clinic scope note:** Login writes `req.session.clinicId` (`server/routes.ts:170`); admin bypasses clinic filtering (`shared/schema/users.ts:15`, `shared/schema/clinics.ts:11`). Server data endpoints filter by session `clinicId` for non-admin users, so pages backed by `/api/*` are treated as **clinic-scoped via session** unless they use only mock/localStorage data (then **global / N/A**).

---

## Route table

Route IDs `RT001…` are assigned in `App.tsx` path order (outer `/schedule/:id` first, then the inner `<Switch>` top-to-bottom). "Roles allowed" reflects client guards (`AdminGuard`/`RoleGuard` in `App.tsx`) and, where applicable, server `requireRole`/portal guards; pages with no guard are reachable by any authenticated role (nav *visibility* may still be role-filtered by `GlobalNav`).

| Route ID | Route | Route aliases (redirects pointing here) | Surface name | Source component | Parent shell | Portal/domain | Roles allowed | Clinic scope behavior | Entry points | Links to | API dependencies | Feature flags | Current status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| RT001 | `/schedule/:id` | — | Shared Schedule (public link) | `pages/shared-schedule.tsx` | **Outside nav shell** (App.tsx:84) | Scheduling | Any authenticated (no guard); page-level PIN `"1111"` | Batch-scoped (by `:id`); UNKNOWN_NEEDS_VERIFICATION whether clinic-filtered | Shared link | `/api/screening-batches/{id}/export` | none | ACTIVE | `/api/screening-batches/{id}`, `/api/screening-batches/{id}/export`. Rendered by outer Switch before the shell (App.tsx:84). |
| RT002 | `/` | — | Root redirect | `<Redirect to="/home">` | Nav shell | — | Any | N/A | Direct | `/home` | none | LEGACY | Redirect (App.tsx:94-96). |
| RT003 | `/archive` | — | Archive redirect | `<Redirect to="/patient-directory">` | Nav shell | Patient EHR | Any | N/A | Direct | `/patient-directory` | none | LEGACY | Redirect (App.tsx:97-99). |
| RT004 | `/plexus` | — | Plexus redirect | `<Redirect to="/ancillary-documents">` | Nav shell | Documents | Any | N/A | Direct | `/ancillary-documents` | none | LEGACY | Redirect (App.tsx:100-102). |
| RT005 | `/home` | `/` (RT002) | Home | `pages/home.tsx` | Nav shell (`SidebarProvider`) + GlobalNav | Core | admin, clinician, scheduler (nav visibility); any can reach | Clinic-scoped via session | GlobalNav, Dock "Home", redirects | Home tiles → many | `/api/screening-batches`, `/api/schedule/dashboard`, `/api/outreach/schedulers`, `/api/test-history`, `/api/screening-batches/{id}/export` | none | ACTIVE | GlobalNav shows here (`GLOBAL_NAV_ROUTES`). Also mounted at RT033/RT035 aliases. |
| RT006 | `/home-preview` | — | Home (preview) | `pages/home-preview.tsx` | Nav shell (`SidebarProvider`) | Core | Any | Clinic-scoped via session | Direct URL only | same as Home | same as `/home` | none | PREVIEW | Parallel preview copy of Home (App.tsx:108-112). Not in nav. |
| RT007 | `/mission-control` | — | Mission Control | `pages/mission-control.tsx` | Nav shell (`SidebarProvider`) | Command center | admin (nav visibility, `GlobalNav.tsx:38`); page reachable by any | Clinic-scoped via session | GlobalNav (admin) | patient search, spine tiles | `/api/mission-control/spine`, `/api/auth/me`, `/api/plexus/patients/search` | none | CONDITIONAL | In-page `ROLE_CAPS` capability preview by role. Server `/api/mission-control/*` is `requireRole("admin")` (`server/routes/missionControl.ts:16`). |
| RT008 | `/imaging-central` | `/ultrasound-central` (RT009), `/technician-central` (RT010) | Imaging Central | `pages/imaging-central.tsx` | Nav shell (`SidebarProvider`) | Imaging | admin, clinician, technician, liaison (nav visibility, `GlobalNav.tsx:40`) | UNKNOWN_NEEDS_VERIFICATION (mock data) | GlobalNav | — | none (mock/inline data only) | none | PLAYGROUND | No `/api/*` calls found; renders mock data (per component scan). |
| RT009 | `/ultrasound-central` | — | Imaging Central (compat) | `<Redirect to="/imaging-central">` | Nav shell | Imaging | Any | N/A | Old deep link | `/imaging-central` | none | LEGACY | Renamed module compat redirect (App.tsx:126-128). |
| RT010 | `/technician-central` | — | Imaging Central (compat) | `<Redirect to="/imaging-central">` | Nav shell | Imaging | Any | N/A | Old deep link | `/imaging-central` | none | LEGACY | Renamed module compat redirect (App.tsx:129-131). |
| RT011 | `/clinic-analytics` | — | Clinic Analytics | `pages/clinic-analytics.tsx` | Nav shell (`SidebarProvider`) | Analytics | admin (nav visibility, `GlobalNav.tsx:53`) | UNKNOWN (mock data) | GlobalNav | — | none (inline mock data only) | none | PLAYGROUND | No `/api/*` found; inline mock. Also served at `/analytics` (RT012). |
| RT012 | `/analytics` | — | Clinic Analytics (alias) | `pages/clinic-analytics.tsx` | Nav shell (`SidebarProvider`) | Analytics | Any | UNKNOWN (mock data) | Direct URL | — | none (inline mock data only) | none | PLAYGROUND | Second live route to `ClinicAnalyticsPage` (App.tsx:138-142). Not a redirect. |
| RT013 | `/clinic-onboarding` | — | Clinic Onboarding | `pages/clinic-onboarding.tsx` | Nav shell (`SidebarProvider`) | Onboarding | admin (nav visibility, `GlobalNav.tsx:54`) | UNKNOWN (demo checklist) | GlobalNav | — | none (inline demo checklist only) | none | PLAYGROUND | No `/api/*` found; inline demo. |
| RT014 | `/schedule` | — | Schedule | `pages/SchedulePage.tsx` | Nav shell | Scheduling | admin, clinician, scheduler (nav visibility) | Clinic-scoped via session | GlobalNav | schedule detail | `/api/screening-batches`, `/api/outreach/schedulers` | none | ACTIVE | `component={SchedulePage}` (App.tsx:148). |
| RT015 | `/patient-directory/live` | — | Patient Directory (live) redirect | `<Redirect to="/patient-directory">` | Nav shell | Patient EHR | Any | N/A | Old bookmark | `/patient-directory` | none | LEGACY | Slice 1.5 consolidation (App.tsx:155-157). `PatientDirectoryLivePage` lives in `components/patient-directory/` for reuse. |
| RT016 | `/patient-directory` | `/archive` (RT003), `/patient-directory/live` (RT015), `/patient-database` (RT017) | Patient EHR | `pages/patient-database.tsx` | Nav shell | Patient EHR | admin, clinician, biller (nav visibility, `GlobalNav.tsx:55`) | Clinic-scoped via session | GlobalNav "Patient EHR" | patient profile | `/api/patients/database` | none | ACTIVE | `component={PatientDatabasePage}` (App.tsx:158). |
| RT017 | `/patient-database` | — | Patient DB redirect | `<Redirect to="/patient-directory">` | Nav shell | Patient EHR | Any | N/A | Old link | `/patient-directory` | none | LEGACY | Redirect (App.tsx:159-161). |
| RT018 | `/ancillary-documents` | `/plexus` (RT004), `/documents` (RT019) | Ancillary Documents | `pages/documents.tsx` | Nav shell | Documents | admin, clinician (nav visibility, `GlobalNav.tsx:49`) | Clinic-scoped via session | GlobalNav | note/document detail | `/api/generated-notes`, `/api/screening-batches`, `/api/ancillary-documents` | canonical-mode toggle (in-page) | ACTIVE | `component={DocumentsPage}` (App.tsx:162). |
| RT019 | `/documents` | — | Documents redirect | `<Redirect to="/ancillary-documents">` | Nav shell | Documents | Any | N/A | Old link | `/ancillary-documents` | none | LEGACY | Redirect (App.tsx:163-165). |
| RT020 | `/billing` | — | Billing | `pages/billing.tsx` | Nav shell | Billing | admin, biller (nav visibility, `GlobalNav.tsx:50`) | Clinic-scoped via session | GlobalNav | invoices | `/api/billing-records`, `/api/generated-notes`, `/api/invoices`, `/api/notes/aging` | canonical-mode toggle (in-page) | ACTIVE | `component={BillingPage}` (App.tsx:166). No server `requireRole` on billing routes. |
| RT021 | `/invoices` | — | Invoices | `pages/invoices.tsx` | Nav shell | Billing | **admin, biller** (`RoleGuard`, App.tsx:168) | Clinic-scoped via session | GlobalNav | invoice detail | `/api/invoices`, `/api/invoices/{id}`, `/api/invoices/aging`, `/api/invoices/{id}/payments` | none | ROLE_RESTRICTED | `RoleGuard roles={["admin","biller"]}`. |
| RT022 | `/document-upload` | — | Document Upload | `pages/document-upload.tsx` | Nav shell | Documents | Any (no guard) | Clinic-scoped via session | Direct/link | — | `/api/documents/ocr-name`, `/api/documents/upload` | none | ACTIVE | `component={DocumentUploadPage}` (App.tsx:170). |
| RT023 | `/appointments` | — | Appointments | `pages/appointments.tsx` | Nav shell | Scheduling | Any (no guard) | Clinic-scoped via session | Direct/link | — | `/api/appointments`, `/api/outreach/dashboard` | none | ACTIVE | `component={AppointmentsPage}` (App.tsx:171). |
| RT024 | `/outreach/scheduler/:id` | — | Outreach Scheduler Portal | `pages/outreach-scheduler-portal.tsx` | Nav shell | Outreach | Any (no guard) | Scheduler/batch-scoped by `:id` | Direct link | batch assign | `/api/appointments`, `/api/engagementCallSettings`, `/api/outreach/scheduler`, `/api/plexus/patients/batch-assign` | none | ACTIVE | `component={OutreachSchedulerPortalPage}` (App.tsx:172). |
| RT025 | `/outreach-center` | — | Outreach Center redirect | `<Redirect to="/scheduler-portal">` | Nav shell | Outreach | Any | N/A | Old link | `/scheduler-portal` | none | LEGACY | Redirect (App.tsx:173-175). |
| RT026 | `/scheduler-portal` | `/outreach-center` (RT025), `/outreach` (RT027) | Outreach Center | `pages/outreach.tsx` | Nav shell | Outreach | admin, clinician, scheduler (nav visibility, `GlobalNav.tsx:48`) | Clinic-scoped via session | GlobalNav "Outreach Center", Dock "Communications" | — | `/api/outreach/dashboard` | none | ACTIVE | `component={OutreachPage}` (App.tsx:176). Relabeled "Outreach Center"; path kept for back-compat. |
| RT027 | `/outreach` | — | Outreach redirect | `<Redirect to="/scheduler-portal">` | Nav shell | Outreach | Any | N/A | Old link | `/scheduler-portal` | none | LEGACY | Redirect (App.tsx:177-179). |
| RT028 | `/clinic-workflow-demo` | — | Clinic Workflow Demo | `pages/clinic-workflow-demo.tsx` | Nav shell | Demo | Any (no guard) | UNKNOWN (demo) | Direct URL | — | none (demo) | none | PLAYGROUND | `component={ClinicWorkflowDemoPage}` (App.tsx:180). Not in nav. |
| RT029 | `/technician-portal` | — | Technician Portal | `pages/technician-portal.tsx` | Nav shell | Portal | admin, technician, liaison (nav visibility, `GlobalNav.tsx:63`) | Clinic-scoped via session | GlobalNav | — | via `ClinicWorkflowPortal` (role="technician"); server portal endpoints `requirePortalRole` = admin/technician/liaison | none | ACTIVE | `component={TechnicianPortalPage}` (App.tsx:181). Server guard `server/routes/portal.ts:41-46`. |
| RT030 | `/liaison-technician-portal` | `/liaison-portal` (RT032) | Liaison Technician Portal | `pages/liaison-portal.tsx` | Nav shell | Portal | admin, technician, liaison (nav visibility, `GlobalNav.tsx:64`) | Clinic-scoped via session | GlobalNav | — | via `ClinicWorkflowPortal` (role="liaison"); server `requirePortalRole` | none | ACTIVE | `component={LiaisonPortalPage}` (App.tsx:182). |
| RT031 | `/clinician-portal` | `/physician-portal` (RT032b) | Clinician Portal | `pages/physician-portal.tsx` | Nav shell + GlobalNav | Portal | **admin, clinician** (`RoleGuard`, App.tsx:184) | Clinic-scoped via session | GlobalNav "Clinician Portal" | — | via `PhysicianPortalShell` | none | ROLE_RESTRICTED | `RoleGuard roles={["admin","clinician"]}`. Also in `GLOBAL_NAV_ROUTES` (shows GlobalNav). |
| RT032 | `/liaison-portal` | — | Liaison portal redirect | `<Redirect to="/liaison-technician-portal">` | Nav shell | Portal | Any | N/A | Old link | `/liaison-technician-portal` | none | LEGACY | Redirect (App.tsx:189-191). |
| RT032b | `/physician-portal` | — | Physician portal redirect | `<Redirect to="/clinician-portal">` | Nav shell | Portal | Any | N/A | Old link | `/clinician-portal` | none | LEGACY | Redirect (App.tsx:186-188). |
| RT033 | `/patient-intake` | `/qualification` (RT034) | Patient Intake / Qualification | `pages/qualification.tsx` | Nav shell | Screening | Any (no guard) | Clinic-scoped via session | Direct/link | — | none detected (form-driven) | none | ACTIVE | `component={QualificationPage}` (App.tsx:192). |
| RT034 | `/qualification` | — | Qualification redirect | `<Redirect to="/patient-intake">` | Nav shell | Screening | Any | N/A | Old link | `/patient-intake` | none | LEGACY | Redirect (App.tsx:193-195). |
| RT035 | `/visit-patients` | `/visit-qualification` (RT036) | Visit Patients (Home) | `pages/home.tsx` | Nav shell (`SidebarProvider`) | Core | Any | Clinic-scoped via session | Direct/link | Home tiles | same as `/home` | none | ACTIVE | Mounts `Home` (App.tsx:196-200). |
| RT036 | `/visit-qualification` | — | Visit qualification redirect | `<Redirect to="/visit-patients">` | Nav shell | Screening | Any | N/A | Old link | `/visit-patients` | none | LEGACY | Redirect (App.tsx:201-203). |
| RT037 | `/outreach-patients` | `/outreach-qualification` (RT038) | Outreach Patients / Qualification | `pages/outreach-qualification.tsx` | Nav shell (`SidebarProvider`) | Outreach | Any (no guard) | Clinic-scoped via session | Direct/link | — | `/api/outreach/qualification` | none | ACTIVE | Mounts `OutreachQualificationPage` (App.tsx:204-208). |
| RT038 | `/outreach-qualification` | — | Outreach qualification redirect | `<Redirect to="/outreach-patients">` | Nav shell | Outreach | Any | N/A | Old link | `/outreach-patients` | none | LEGACY | Redirect (App.tsx:209-211). |
| RT039 | `/plexus-iq` | — | Plexus IQ | `pages/plexus-iq.tsx` | Nav shell (`SidebarProvider`) | Plexus IQ | Any (no guard) | Clinic-scoped via session | Dock "Plexus IQ" | calendar → assign | `/api/screening-batches`, `/api/screening-batches/calendar-summary`, `/api/global-schedule-events` | localStorage (active job list) | ACTIVE | `PlexusIQPage` (App.tsx:212-216). Dock link (`navigationRegistry.ts:57`). |
| RT040 | `/clinical-intelligence` | — | Clinical Intelligence & Governance | `pages/clinical-intelligence.tsx` | Nav shell (`SidebarProvider`) | Plexus IQ | Any (no guard) | Global / N/A (localStorage) | Direct URL | — | none (localStorage store + seeded library) | localStorage-backed | PLAYGROUND | Prototype knowledge tile (App.tsx:219-223). Header comment: "prototype". |
| RT041 | `/plexus-iq-prototype` | — | Plexus IQ Operating Canvas (prototype) | `pages/plexus-iq-prototype.tsx` | Nav shell (no `SidebarProvider`) | Plexus IQ | Any (no guard) | Global / N/A (mock) | Direct URL | — | none (mock data) | none | PLAYGROUND | "Temporary design-prototype route — mock data only, not production" (App.tsx:49-50, 224-227). |
| RT042 | `/team-member-portals` | — | Team Member Portals (hub) | `pages/team-member-portals.tsx` | Nav shell (`SidebarProvider`) | Portal | Any (no guard) | UNKNOWN (shell/nav page) | Direct URL | PCS/ACS portals | none (shell/nav page) | none | ACTIVE | `TeamMemberPortalsPage` (App.tsx:228-232). |
| RT043 | `/patient-care-specialist-portal` | — | Patient Care Specialist (PCS) Portal | `pages/patient-care-specialist-portal.tsx` | Nav shell (`SidebarProvider`) | Portal | Any (no guard) | Clinic-scoped via session | Direct/hub | — | `/api/portal/widgets`, `/api/portal/work-queue` | none | ACTIVE | `PatientCareSpecialistPortalPage` (App.tsx:233-237). Component scan flags it as unwired/design reference; PCS canonical server API is `admin, liaison` (`pcsAcsCanonical.ts:22`). |
| RT044 | `/ancillary-care-specialist-portal` | — | Ancillary Care Specialist (ACS) Portal | `pages/ancillary-care-specialist-portal.tsx` | Nav shell (`SidebarProvider`) | Portal | Any (no guard) | Clinic-scoped via session | Direct/hub | — | `/api/portal/widgets`, `/api/portal/work-queue` | none | ACTIVE | `AncillaryCareSpecialistPortalPage` (App.tsx:238-242). ACS canonical server API is `admin, technician` (`pcsAcsCanonical.ts:23`). |
| RT045 | `/engagement-center` | — | Engagement Center | `pages/engagement-center.tsx` | Nav shell (no `SidebarProvider`) | Engagement | Any (no guard) | Clinic-scoped via session | Dock "Engagement" | assignment board | `/api/engagement/assignment-board`, `/api/engagement/assignment-board/assign`, `/api/engagement/assignment-board/cancel-many`, `/api/engagement/baskets`, `/api/outreach/schedulers` | none | ACTIVE | `EngagementCenterPage` (App.tsx:243-245). Dock link (`navigationRegistry.ts:74`). Server engagement admin endpoints are `requireRole("admin")` (`engagementDistribution.ts`, `engagementTeamMetrics.ts`, `engagementCallSettings.ts`). |
| RT046 | `/team-ops` | — | Team Ops | `pages/team-ops.tsx` | Nav shell | Team Ops | admin (nav visibility, `GlobalNav.tsx:52`); page reachable by any | Clinic-scoped via session | GlobalNav "Team Ops" | PTO | `/api/auth/me`, `/api/audit-log/users`, `/api/outreach/schedulers`, `/api/pto-requests` | none | CONDITIONAL | `component={TeamOpsPage}` (App.tsx:246). In-page `me?.role === "admin"` gates admin PTO views (`team-ops.tsx:259`). |
| RT047 | `/task-brain` | — | Task Brain redirect | `<Redirect to="/plexus-tasks">` | Nav shell | Tasks | Any | N/A | Old link | `/plexus-tasks` | none | LEGACY | Redirect (App.tsx:247-249). |
| RT048 | `/plexus-tasks` | `/task-brain` (RT047) | Plexus Tasks | `pages/plexus-tasks.tsx` | Nav shell | Tasks | admin, clinician, scheduler, biller (nav visibility, `GlobalNav.tsx:60`) | Clinic-scoped via session | GlobalNav "Plexus Tasks", Dock "Tasks" panel | — | none detected on page (child workspace/hooks fetch tasks; e.g. `/api/plexus/tasks/*` via `GlobalNav`/dock) | none | ACTIVE | `component={PlexusTasksPage}` (App.tsx:250). |
| RT049 | `/plexus-bank` | — | Plexus Bank | `pages/plexus-bank.tsx` | Nav shell | Plexus Bank | **admin** (`AdminGuard`, App.tsx:252) | Global / N/A (localStorage prototype) | GlobalNav "Plexus Bank" (admin) | modules | `/api/auth/me` (optional) | localStorage-backed | ROLE_RESTRICTED | `AdminGuard`. Component scan: localStorage-backed prototype, no real bank ops. |
| RT050 | `/document-library` | — | Document Library | `pages/document-library.tsx` | Nav shell | Documents | **admin** (`AdminGuard`, App.tsx:255) | Clinic-scoped via session | GlobalNav "Document Library" (admin) | — | `/api/documents` | none | ROLE_RESTRICTED | `AdminGuard`. |
| RT051 | `/admin/settings` | `/admin` (RT052), `/admin/stovetop-heat-settings` (RT053), `/admin/settings-center` (RT054), `/admin/billing-settings` (RT055), `/billing/remittance` (RT062), `/billing/auditor` (RT063), `/admin/users` (RT065), `/audit-log` (RT066), `/admin/analysis-jobs` (RT067), `/admin/outbox` (RT068), `/admin-ops` (RT069), `/call-list-audit` (RT070), `/settings` (RT073) | Admin Settings hub | `pages/admin-settings.tsx` | Nav shell | Admin | **admin** (`AdminGuard`, App.tsx:259) | Clinic-scoped via session | GlobalNav "Admin" (admin) | tabs: system/facility/billing/team/logs | Tab child pages: `admin-users`, `admin-outbox`, `audit-log`, `admin-analysis-jobs`, `billing-settings`, `stovetop-heat-settings`, `call-list-audit`, `billing-auditor`, `remittance-audit`, `admin-settings-center`, `admin` (`TestFixtureCard`) — imported & rendered as tabs (`admin-settings.tsx:37-47`) | none | ROLE_RESTRICTED | Task #530 unified hub. Consolidates many former standalone admin pages as tabs. |
| RT052 | `/admin` | — | Admin redirect | `<Redirect to="/admin/settings?tab=system">` | Nav shell | Admin | Any (target is admin-guarded) | N/A | Old link | `/admin/settings?tab=system` | none | LEGACY | Redirect (App.tsx:261-263). |
| RT053 | `/admin/stovetop-heat-settings` | — | Stovetop heat settings redirect | `<Redirect to="/admin/settings?tab=facility">` | Nav shell | Admin | Any | N/A | Old link | `/admin/settings?tab=facility` | none | LEGACY | Redirect (App.tsx:264-266). |
| RT054 | `/admin/settings-center` | — | Settings center redirect | `<Redirect to="/admin/settings?tab=system">` | Nav shell | Admin | Any | N/A | Old link | `/admin/settings?tab=system` | none | LEGACY | Redirect (App.tsx:267-269). |
| RT055 | `/admin/billing-settings` | — | Billing settings redirect | `<Redirect to="/admin/settings?tab=billing">` | Nav shell | Admin | Any | N/A | Old link | `/admin/settings?tab=billing` | none | LEGACY | Redirect (App.tsx:270-272). |
| RT056 | `/billing/readiness` | — | Billing Readiness | `pages/billing-readiness.tsx` | Nav shell | Billing | **admin** (`AdminGuard`, App.tsx:274) | Clinic-scoped via session | Direct/link | — | none detected on page | none | ROLE_RESTRICTED | `AdminGuard`. |
| RT057 | `/billing/invoice-batches` | — | Invoice Batches | `pages/invoice-batches.tsx` | Nav shell | Billing | **admin** (`AdminGuard`, App.tsx:277) | Clinic-scoped via session | Direct/link | — | none detected on page | none | ROLE_RESTRICTED | `AdminGuard`. |
| RT058 | `/billing/invoice-review` | — | Invoice Review | `pages/invoice-review.tsx` | Nav shell | Billing | **admin** (`AdminGuard`, App.tsx:280) | Clinic-scoped via session | Direct/link | — | `/api/invoices` | none | ROLE_RESTRICTED | `AdminGuard`. |
| RT059 | `/billing/invoice-delivery` | — | Invoice Delivery | `pages/invoice-delivery.tsx` | Nav shell | Billing | **admin** (`AdminGuard`, App.tsx:283) | Clinic-scoped via session | Direct/link | — | none detected on page | none | ROLE_RESTRICTED | `AdminGuard`. |
| RT060 | `/billing/remittance` | — | Remittance redirect | `<Redirect to="/admin/settings?tab=logs&log=remittance">` | Nav shell | Billing/Admin | Any | N/A | Old link | admin settings (logs) | none | LEGACY | Redirect (App.tsx:285-287). |
| RT061 | `/billing/auditor` | — | Billing auditor redirect | `<Redirect to="/admin/settings?tab=logs&log=billing-auditor">` | Nav shell | Billing/Admin | Any | N/A | Old link | admin settings (logs) | none | LEGACY | Redirect (App.tsx:288-290). |
| RT062 | `/billing/reports` | — | Billing Reports | `pages/billing-reports.tsx` | Nav shell | Billing | **admin** (`AdminGuard`, App.tsx:292) | Clinic-scoped via session | Direct/link | — | none detected on page | none | ROLE_RESTRICTED | `AdminGuard`. |
| RT063 | `/admin/users` | — | Admin users redirect | `<Redirect to="/admin/settings?tab=team">` | Nav shell | Admin | Any | N/A | Old link | admin settings (team) | none | LEGACY | Redirect (App.tsx:294-296). |
| RT064 | `/audit-log` | — | Audit log redirect | `<Redirect to="/admin/settings?tab=logs&log=audit">` | Nav shell | Admin | Any | N/A | Old link | admin settings (logs) | none | LEGACY | Redirect (App.tsx:297-299). |
| RT065 | `/admin/analysis-jobs` | — | Analysis jobs redirect | `<Redirect to="/admin/settings?tab=logs&log=analysis-jobs">` | Nav shell | Admin | Any | N/A | Old link | admin settings (logs) | none | LEGACY | Redirect (App.tsx:300-302). |
| RT066 | `/admin/outbox` | — | Outbox redirect | `<Redirect to="/admin/settings?tab=logs&log=outbox">` | Nav shell | Admin | Any | N/A | Old link | admin settings (logs) | none | LEGACY | Redirect (App.tsx:303-305). |
| RT067 | `/admin-ops` | — | Admin ops redirect | `<Redirect to="/admin/settings?tab=system">` | Nav shell | Admin | Any | N/A | Old link | admin settings (system) | none | LEGACY | Redirect (App.tsx:306-308). |
| RT068 | `/call-list-audit` | — | Call-list audit redirect | `<Redirect to="/admin/settings?tab=logs&log=call-list-audit">` | Nav shell | Admin | Any | N/A | Old link | admin settings (logs) | none | LEGACY | Redirect (App.tsx:309-311). Server `/api/call-list-audit/*` is `requireRole("admin")` (`callListAudit.ts:169`). |
| RT069 | `/dashboard` | `/schedule-dashboard` (RT070) | Schedule Dashboard | `pages/schedule-dashboard.tsx` | Nav shell | Scheduling | Any (no guard) | Clinic-scoped via session | Direct/link | — | `/api/schedule/dashboard` | none | ACTIVE | `component={ScheduleDashboardPage}` (App.tsx:312). |
| RT070 | `/schedule-dashboard` | — | Schedule dashboard redirect | `<Redirect to="/dashboard">` | Nav shell | Scheduling | Any | N/A | Old link | `/dashboard` | none | LEGACY | Redirect (App.tsx:313-315). |
| RT071 | `/settings` | — | Settings redirect | `<Redirect to="/admin/settings#team">` | Nav shell | Admin | Any | N/A | Old link | `/admin/settings#team` | none | LEGACY | Redirect (App.tsx:316-318). |
| RT072 | `*` (fallback) | — | Not Found | `pages/not-found.tsx` | Nav shell | — | Any | N/A | Unmatched URL | — | none | none | ACTIVE | Catch-all `<Route component={NotFound}>` (App.tsx:319). |

> Login is not a route in `AuthenticatedApp`. Unauthenticated users are served `pages/login.tsx` by `AppShell` (`App.tsx:374-375`) before the router mounts; `LoginPage` is not part of the `<Switch>` route table.

---

## Redirect map

| From | To | App.tsx line |
|------|-----|-------------|
| `/` | `/home` | 94-96 |
| `/archive` | `/patient-directory` | 97-99 |
| `/plexus` | `/ancillary-documents` | 100-102 |
| `/ultrasound-central` | `/imaging-central` | 126-128 |
| `/technician-central` | `/imaging-central` | 129-131 |
| `/patient-directory/live` | `/patient-directory` | 155-157 |
| `/patient-database` | `/patient-directory` | 159-161 |
| `/documents` | `/ancillary-documents` | 163-165 |
| `/outreach-center` | `/scheduler-portal` | 173-175 |
| `/outreach` | `/scheduler-portal` | 177-179 |
| `/physician-portal` | `/clinician-portal` | 186-188 |
| `/liaison-portal` | `/liaison-technician-portal` | 189-191 |
| `/qualification` | `/patient-intake` | 193-195 |
| `/visit-qualification` | `/visit-patients` | 201-203 |
| `/outreach-qualification` | `/outreach-patients` | 209-211 |
| `/task-brain` | `/plexus-tasks` | 247-249 |
| `/admin` | `/admin/settings?tab=system` | 261-263 |
| `/admin/stovetop-heat-settings` | `/admin/settings?tab=facility` | 264-266 |
| `/admin/settings-center` | `/admin/settings?tab=system` | 267-269 |
| `/admin/billing-settings` | `/admin/settings?tab=billing` | 270-272 |
| `/billing/remittance` | `/admin/settings?tab=logs&log=remittance` | 285-287 |
| `/billing/auditor` | `/admin/settings?tab=logs&log=billing-auditor` | 288-290 |
| `/admin/users` | `/admin/settings?tab=team` | 294-296 |
| `/audit-log` | `/admin/settings?tab=logs&log=audit` | 297-299 |
| `/admin/analysis-jobs` | `/admin/settings?tab=logs&log=analysis-jobs` | 300-302 |
| `/admin/outbox` | `/admin/settings?tab=logs&log=outbox` | 303-305 |
| `/admin-ops` | `/admin/settings?tab=system` | 306-308 |
| `/call-list-audit` | `/admin/settings?tab=logs&log=call-list-audit` | 309-311 |
| `/schedule-dashboard` | `/dashboard` | 313-315 |
| `/settings` | `/admin/settings#team` | 316-318 |

Additional guard redirects (runtime, not standalone routes): `AdminGuard`/`RoleGuard` redirect denied users to `/home` (`App.tsx:67`, `74`); logout navigates to `/` (`App.tsx:363`).

---

## Potential orphan pages (`client/src/pages`)

Reachability rule applied: a page is reachable if its component is a `<Route>` target in `App.tsx`, is a redirect target, or is imported/rendered elsewhere (e.g. as an admin-settings tab). The following page files are **not** referenced by any `App.tsx` route/redirect **and** have **zero importers** outside their own file (grep evidence: `rg -l "@/pages/<name>" client/src`).

| Page file | Route in App.tsx? | Other importers? | Status | Evidence |
|-----------|-------------------|------------------|--------|----------|
| `client/src/pages/plexus.tsx` | No | 0 | DEAD_OR_UNREACHABLE | `rg -l "@/pages/plexus\"" client/src` → only the file itself. Note: `/plexus` *route* redirects to `/ancillary-documents` (RT004) and does not render this component. |
| `client/src/pages/admin-ops.tsx` | No (route `/admin-ops` redirects to admin settings, RT067) | 0 | DEAD_OR_UNREACHABLE | `rg -l "@/pages/admin-ops\"" client/src` → only the file itself. |
| `client/src/pages/task-brain.tsx` | No (route `/task-brain` redirects to `/plexus-tasks`, RT047) | 0 | DEAD_OR_UNREACHABLE | `rg -l "@/pages/task-brain\"" client/src` → only the file itself. |
| `client/src/pages/drive.tsx` | No | 0 | DEAD_OR_UNREACHABLE | `rg -l "@/pages/drive\"" client/src` → only the file itself. No route named `/drive` exists. |
| `client/src/pages/patient-directory-live.tsx` | No (route `/patient-directory/live` redirects to `/patient-directory`, RT015) | 0 | DEAD_OR_UNREACHABLE | `rg -l "@/pages/patient-directory-live\"" client/src` → only the file itself. Its inner `PatientDirectoryLivePage` (in `components/patient-directory/`) is separately reused, but this page wrapper is not. |

**Not orphaned (verified reachable):** `admin.tsx`, `admin-users.tsx`, `admin-outbox.tsx`, `admin-analysis-jobs.tsx`, `admin-settings-center.tsx`, `audit-log.tsx`, `billing-settings.tsx`, `billing-auditor.tsx`, `call-list-audit.tsx`, `remittance-audit.tsx`, `stovetop-heat-settings.tsx`, `settings.tsx` — all imported and rendered as tabs inside `pages/admin-settings.tsx` (imports at `admin-settings.tsx:37-47`). `login.tsx` and `not-found.tsx` are rendered by `AppShell`/fallback. `SchedulePage.tsx`, `shared-schedule.tsx`, and all component-route pages are routed in `App.tsx`.

---

## Roles & guards

**Roles (canonical enum):** `admin`, `clinician`, `scheduler`, `biller`, `technician`, `liaison` (`shared/schema/users.ts:4`). Session default role when unset is `clinician` (`server/routes.ts:185`, `232`). Login stores `{ userId, username, role, clinicId }` in the session (`server/routes.ts:165-170`).

**Client guards (`client/src/App.tsx`):**
- `AdminGuard` (App.tsx:65-70): renders children only if `user.role === "admin"`, else `<Redirect to="/home">`. Applied to: `/plexus-bank`, `/document-library`, `/admin/settings`, `/billing/readiness`, `/billing/invoice-batches`, `/billing/invoice-review`, `/billing/invoice-delivery`, `/billing/reports`.
- `RoleGuard` (App.tsx:72-77): renders children only if `roles.includes(user.role)`, else `<Redirect to="/home">`. Applied to: `/invoices` (`["admin","biller"]`), `/clinician-portal` (`["admin","clinician"]`).
- All other component routes have **no App.tsx guard** — reachable by any authenticated role. Note: `GlobalNav.tsx` still filters *nav-item visibility* per role via each item's `roles[]` (`GlobalNav.tsx:36-66`, `visibleNavItems` filter at line 149), so a surface may be reachable by URL yet hidden from a given role's sidebar.

**Nav / dock visibility (`client/src/lib/navigation/navigationRegistry.ts`, `client/src/components/GlobalNav.tsx`, `client/src/components/navigation/GlobalFloatingDock.tsx`):**
- `shouldShowGlobalNav(pathname)` returns true only for `GLOBAL_NAV_ROUTES = ["/home","/clinician-portal"]` (and subpaths). GlobalNav sidebar is therefore rendered only on `/home` and `/clinician-portal`; on all other in-shell routes the sidebar is hidden and navigation is via the floating dock / direct links (`App.tsx:81,90`).
- `GlobalFloatingDock` is always mounted (`App.tsx:88`). It shows the simplified `PORTAL_DOCK_ITEMS` for `PORTAL_DOCK_ROLES = {scheduler, clinician}` and the full `DOCK_ITEMS` for **every other authenticated role — admin, biller, technician, liaison** (`dockItems = PORTAL_DOCK_ROLES.has(me.role) ? PORTAL_DOCK_ITEMS : DOCK_ITEMS`, `navigationRegistry.ts:142`, `GlobalFloatingDock.tsx:194-195`; no third branch). Dock link targets: `/home`, `/plexus-iq`, `/engagement-center`, `/scheduler-portal` (chat is `disabled`; `CHAT_ROUTE_AVAILABLE = false`, `navigationRegistry.ts:26`).

**Server-side role protection (cross-reference of `requireRole` and portal guards):**
- The `requireRole` factory (`server/routes.ts:231-233`) checks `roles.includes(session.role)`. Across the entire `server/` tree it is invoked **only** as `requireRole("admin")` — in `server/routes/missionControl.ts:16`, `server/routes/callListAudit.ts:169`, `server/routes/engagementDistribution.ts`, `server/routes/engagementTeamMetrics.ts:61,87`, and `server/routes/engagementCallSettings.ts:195,233`. So the Mission Control, call-list-audit, and engagement distribution/metrics/call-settings `/api/*` endpoints are admin-only server-side.
- Portal endpoints use a separate guard `requirePortalRole` = `{admin, technician, liaison}` (`server/routes/portal.ts:41-46`), covering `/api/portal/*`.
- PCS/ACS canonical endpoints use `requireRoles`: `PCS_ROLES = {admin, liaison}` and `ACS_ROLES = {admin, technician}` (`server/routes/pcsAcsCanonical.ts:22-23,58,80`).
- Billing and invoice route files (`server/routes/billing*.ts`, `server/routes/invoice*.ts`, `server/routes/invoices.ts`) contain **no** `requireRole` call — their access control on the client is via `AdminGuard`/`RoleGuard` only (server-side clinic scoping via session still applies). UNKNOWN_NEEDS_VERIFICATION whether other middleware (not `requireRole`) gates these.
