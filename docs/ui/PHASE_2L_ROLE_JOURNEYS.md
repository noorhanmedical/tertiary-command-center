# Phase 2L — Role Journeys (6 roles × existing platform)

**Scope:** Documentation-only. READ-ONLY factual mapping at branch `phase/2l-ui-discovery`, HEAD `08a78978`. Maps the ACTUAL day-to-day flow of each real role. NOT a redesign. `UNKNOWN_NEEDS_VERIFICATION` marks anything not confirmable from source.

**Cross-references:** `PHASE_2L_FUNCTIONAL_FREEZE.md` (roles/guards/flags), `PHASE_2L_ROUTE_ROLE_MAP.md` (RT###), `PHASE_2L_SURFACE_INVENTORY.md` (S###), `PHASE_2L_PATIENT_JOURNEY_MAP.md` (stages).

## Universal facts (apply to every role)

- **Six real roles** (`shared/schema/users.ts:4`): `admin`, `clinician`, `scheduler`, `biller`, `technician`, `liaison`. Session shape `{userId, username, role, clinicId}` (`server/routes.ts:165-170`).
- **Post-login landing is ALWAYS `/home`** for every role — `handleLogin` (`client/src/App.tsx:346-357`) calls `navigate("/home")` unconditionally (no role-based redirect). Username `admin` also gets a default-admin toast (S010).
- **GlobalNav sidebar renders only on `/home` and `/clinician-portal`** (`GLOBAL_NAV_ROUTES`, `navigationRegistry.ts:144`). Everywhere else, navigation is the floating dock (S003) + direct links.
- **Client guards** (`App.tsx`): `AdminGuard` (admin-only) and `RoleGuard(...roles)` redirect denied users to `/home`. Most routes have NO App.tsx guard — reachable by URL by any authenticated role — but `GlobalNav` still filters nav-item *visibility* per item's `roles[]` (`GlobalNav.tsx:37-65`).
- **Dock:** admin/biller get full `DOCK_ITEMS`; `PORTAL_DOCK_ROLES={scheduler,clinician}` get simplified `PORTAL_DOCK_ITEMS` (`navigationRegistry.ts:90,142`). Chat is disabled (`CHAT_ROUTE_AVAILABLE=false`). `technician`/`liaison`/`biller` are NOT in `PORTAL_DOCK_ROLES`; `UNKNOWN_NEEDS_VERIFICATION` whether technician/liaison see the full dock or a reduced set (they are not admin/biller and not portal-dock-roles).
- **Server-side role enforcement is sparse:** `requireRole` is invoked ONLY as `requireRole("admin")` platform-wide (Mission Control, call-list-audit, engagement distribution/metrics/call-settings). Portal endpoints use `requirePortalRole={admin,technician,liaison}` (`portal.ts:41`). PCS/ACS canonical use `PCS_ROLES={admin,liaison}` / `ACS_ROLES={admin,technician}` (`pcsAcsCanonical.ts:22-23`). Billing/invoice routes have NO `requireRole` — client-guarded only + session clinic scope. `scheduler`/`biller` have NO dedicated server role gate beyond `requireAuth`+clinic scope.
- **Clinic scope:** admin bypasses clinic filter (`clinicContext.ts:31-33`); every non-admin is strictly filtered to `req.session.clinicId`; a non-admin with null clinicId sees NO tenant data.

---

## Role × Portal access matrix

Rows = 6 roles. Cols = portals. Cell values: **✅ full** (guard admits + nav visible), **URL** (route reachable by URL — no App.tsx guard — but nav item hidden for this role), **❌** (guard denies → redirect `/home` OR server 403), **N/A**. Guard evidence in the notes below the table.

| Role | Home / Mission Control | PCS Portal | ACS Portal | Clinician Portal | Scheduler-Team (Outreach/Engagement) | Admin (settings/users) | Finance/Billing |
|---|---|---|---|---|---|---|---|
| **admin** | ✅ Home; ✅ Mission Control (nav + `requireRole("admin")`) | ✅ (`PCS_ROLES`) | ✅ (`ACS_ROLES`) | ✅ (`RoleGuard{admin,clinician}` + nav) | ✅ (engagement admin `requireRole("admin")`) | ✅ (`AdminGuard`/`requireAdmin`) | ✅ (`/invoices` RoleGuard admits; AdminGuard billing pages) |
| **clinician** | ✅ Home; MC URL-only (nav admin-only; server 403) | URL (page no guard; PCS *canonical* server ❌) | URL (page no guard; ACS *canonical* server ❌) | ✅ (`RoleGuard{admin,clinician}` + nav + dock) | URL (Outreach nav visible; engagement admin APIs 403) | ❌ (`AdminGuard`→/home) | ❌ billing pages (AdminGuard); `/invoices` ❌ (RoleGuard {admin,biller}) |
| **scheduler** | ✅ Home; MC URL-only (server 403) | URL (canonical server ❌) | URL (canonical server ❌) | ❌ (`RoleGuard{admin,clinician}`→/home) | ✅ Outreach/Engagement nav + portal-dock; engagement admin APIs 403 (read/assign only) | ❌ (AdminGuard) | ❌ (AdminGuard / RoleGuard) |
| **biller** | ✅ Home; MC URL-only (server 403) | URL (canonical server ❌) | URL (canonical server ❌) | ❌ (RoleGuard→/home) | URL (Plexus Tasks nav visible; engagement admin APIs 403) | ❌ (AdminGuard) | ✅ `/invoices` (RoleGuard {admin,biller}) + Billing nav; billing *pages* AdminGuard ❌ |
| **technician** | ✅ Home (nav Home not in technician's list → URL); MC URL-only (server 403) | URL (page no guard; PCS canonical server ❌ — not in PCS_ROLES) | ✅ ACS canonical (`ACS_ROLES={admin,technician}`); Technician Portal nav + `requirePortalRole` | ❌ (RoleGuard→/home) | URL | ❌ (AdminGuard) | ❌ |
| **liaison** | ✅ Home (URL — not in Home nav list); MC URL-only | ✅ PCS canonical (`PCS_ROLES={admin,liaison}`); Liaison/Technician Portal nav + `requirePortalRole` | URL (page no guard; ACS canonical server ❌ — not in ACS_ROLES) | ❌ (RoleGuard→/home) | URL | ❌ (AdminGuard) | ❌ |

**Guard evidence:** `AdminGuard`/`RoleGuard` (`App.tsx:65-77`); `PCS_ROLES`/`ACS_ROLES` (`pcsAcsCanonical.ts:22-23`); `requirePortalRole` (`portal.ts:41-46`); `requireClinicianOrAdmin` (`clinicianPortalGuard.ts:28-43`, fails closed); `requireRole("admin")` (Mission Control `missionControl.ts:16`, engagement `engagementDistribution/TeamMetrics/CallSettings`). Nav visibility per `GlobalNav.tsx:37-65`.

> Key nuance: a page with NO App.tsx guard is URL-reachable by any authenticated role, but (a) its nav item may be hidden and (b) its **canonical server view** may still 403 via `PCS_ROLES`/`ACS_ROLES`. PCS/ACS *pages* (S208/S209) have no client guard, so clinician/scheduler/biller can open the shell, but the canonical lifecycle data (`/api/pcs|acs/canonical-view`) is role-locked (and flag-OFF regardless).

---

## admin

- **Lands:** `/home` (RT005). Sees full GlobalNav sidebar (every nav item visible) + full floating dock (`DOCK_ITEMS`). Default-admin toast if username `admin`.
- **Sees first:** Home dashboard (S011/S012) — weekly schedule, calendar, practice-pulse metrics (S018), upcoming appointments (S024).
- **Primary work queues:** Mission Control (S035, spine cards S037, lanes S039 — `requireRole("admin")`); Engagement Center distribution (S176/S177, admin); Admin Settings hub (S311). Admin is the ONLY role with server-side write access to distribution, call-settings, users, outbox, analysis jobs.
- **Find a patient:** Mission Control global search (S043), Patient EHR (S056/S057 roster+search), portal search, Plexus IQ.
- **Reach a case:** any lane/queue → case detail (S040 Lane Workbench, S175 Engagement Case Panel, S061 Patient Profile Workspace).
- **Actions:** everything — create batches, distribute engagement, approve reviews (S123, though canonical write is flag-OFF), manage users (S319/S331), drain outbox (S324), run fixtures (S333), all billing/invoice pages. Bypasses clinic filter (sees all clinics).
- **Hidden/forbidden:** none by role. Plexus identity review is denied to EVERYONE (no reviewer role exists; `authorization.ts` always 403).
- **Knows work is blocked:** Mission Control blocker column (S039), `sourceMissing`→"N/A" (S352), uncovered-clinics warnings (S143), duplicate hard-blocks (S078).
- **Knows work is complete:** completed-billing packages (S294), stage vector terminal (S219), paid invoices (S300).
- **Portal transitions:** enters all portals (PCS/ACS/Clinician) as a member of every guard set.

## clinician

- **Lands:** `/home`. Nav shows Home, Schedule, Imaging Central, Outreach Center, Ancillary Documents, Patient EHR, Plexus Tasks, Clinician Portal. Gets `PORTAL_DOCK_ITEMS` (portal-dock role).
- **Sees first:** Home; Clinician Portal Tile (S017) shows a signature-count badge.
- **Primary work queues:** Clinician Portal (RT031, `RoleGuard{admin,clinician}`) — Signatures Tab (S271), Orders & Notes (S262/S266), Reports Tab (S272), Ancillary Metrics (S273). This is the clinician's home base for order notes, procedure notes, and signatures (journey stages 6, 9, 10).
- **Find a patient:** Patient EHR (S056), portal patient search (S235), Ancillary Documents browser (S276).
- **Reach a case:** Clinician Portal signature queue → sign dialog; Orders & Notes table → note.
- **Actions:** create/amend order notes, generate/sign procedure notes (bulk-sign via `/signature-items/bulk-sign`), send notes back for correction, upload/review reports, review AI logic (S124). Screening/admin-approval via Plexus IQ (S123).
- **Hidden/forbidden:** Admin settings (`AdminGuard`→/home), `/invoices` (`RoleGuard{admin,biller}`→/home), billing pages (AdminGuard), Mission Control server APIs (403), engagement distribution APIs (admin-only 403). Finance tab inside portal shows `FinanceTabDisabled` (S270) without finance access.
- **Knows work is blocked:** signature status `needs_signature`/`returned_for_correction` (S271); report `missing` blocks procedure note (S272/S094); stage-vector cells (S219).
- **Knows work is complete:** signature-count badge → 0 (S017); note `signed`.
- **Portal transitions:** Clinician Portal is primary. Can open PCS/ACS pages by URL but their canonical data is role-locked.

## scheduler

- **Lands:** `/home`. Nav shows Home, Schedule, Outreach Center, Plexus Tasks. Gets `PORTAL_DOCK_ITEMS`.
- **Sees first:** Home; then works out of Outreach/Engagement.
- **Primary work queues:** Outreach Center (RT026 `/scheduler-portal`, S141 manager view); the per-scheduler call workspace (RT024 `/outreach/scheduler/:id`, S146) with Call List Panel (S154), Current Call Card (S158), Disposition Sheet (S160); Engagement Center pool tab (S167/S172). This role executes journey stage 4 (Engagement) and stage 5 (Scheduling/booking).
- **Find a patient:** Call list (S154), portal patient search, Tri-Clinic Calendar (S161) booking.
- **Reach a case:** call-list row → Current Call Card → book (S159 Mission Control Bar → S162 Booking Dialogs).
- **Actions:** work call list, record dispositions (dual-write legacy+canonical, S160), book/cancel/reschedule appointments (S162), assign/self-serve within engagement board (assign endpoint), quick-book. Auto-assign is OFF by default (`scheduler_auto_assign_enabled` false) so distribution is manual from the pool.
- **Hidden/forbidden:** Clinician Portal (`RoleGuard`→/home), Admin settings/users, `/invoices`, all billing pages. Engagement *distribution/metrics/call-settings* are `requireRole("admin")` → scheduler gets 403 on those (can assign from the board but cannot run capacity-aware auto-distribute or edit call settings).
- **Knows work is blocked:** Uncovered Clinics Warning (S143), duplicate handoff/call-list banners (S079/S155 CONFLICT), booking duplicate-name warning (S162).
- **Knows work is complete:** disposition `scheduled`; appointment `scheduled`; call moves to worked-call archive (S243).
- **Portal transitions:** hands scheduled cases downstream to ACS/technician (execution) — no direct portal switch; the case flows via the engagement/appointment tables.

## biller

- **Lands:** `/home`. Nav shows Billing, Invoices, Patient EHR, Plexus Tasks. Gets full `DOCK_ITEMS` (admin/biller keep full dock).
- **Sees first:** Home; then Billing/Invoices.
- **Primary work queues:** `/invoices` (RT021, `RoleGuard{admin,biller}`) — invoices list (S299), detail (S300), create (S301), financial panel (S307). `/billing` (RT020, nav-visible, no guard) — overview (S292), records (S293), canonical billing panel (S294). This role owns journey stages 14 (Invoice) and 15 (Payment) on the legacy Phase-4 desk.
- **Find a patient:** Patient EHR (biller has Patient EHR nav visibility, `GlobalNav.tsx:55`); billing records search (S293); remittance invoice-ID lookup (S327 — but that page is AdminGuard, see below).
- **Reach a case:** invoice list → invoice detail → line items/payments/adjustments/denials.
- **Actions:** on `/invoices`: create invoices, post payments (`POST /api/invoices/:id/payments`), record adjustments/denials/remittances (S307), send email/reminders. Forward payments only in legacy (no refund/reversal in Phase-4 `invoiceFinancialService`).
- **Hidden/forbidden:** Clinician Portal (RoleGuard→/home), Admin settings. Critically, the deeper billing pages — Billing Readiness (RT056), Invoice Batches (RT057), Invoice Review (RT058), Invoice Delivery (RT059), Billing Reports (RT062) — are all **`AdminGuard`** → biller is redirected to /home. So a biller can use `/billing` and `/invoices` but NOT the admin-guarded billing sub-desk. `UNKNOWN_NEEDS_VERIFICATION`: this appears to restrict billers to a subset of billing tooling by client guard only (no server `requireRole` on billing routes).
- **Knows work is blocked:** `INVOICE_READINESS_BLOCKERS`; `Partially Paid`/`Draft` states; delivery_failed; empty/error states (S344/S349).
- **Knows work is complete:** invoice `Paid`; completed-billing package payment recorded (S294).
- **Portal transitions:** none — biller is a Finance-desk role, not a portal-persona role.

## technician

- **Lands:** `/home` (Home nav item's `roles` = `[admin,clinician,scheduler]` — technician not listed, so Home is URL-reachable but not a highlighted nav item; still lands there). Nav shows Imaging Central, Technician Portal, Liaison Technician Portal.
- **Sees first:** Home, then the Technician/ACS portal.
- **Primary work queues:** Technician Portal (RT029, `requirePortalRole={admin,technician,liaison}`) and ACS Portal (RT044) via `ClinicWorkflowPortal`/`TeamPortalShell` (S212/S213). ACS canonical view is admitted (`ACS_ROLES={admin,technician}`, S218/S216). This role executes journey stages 7 (Procedure), 8 (Report), 9 (Procedure Note upload path).
- **Find a patient:** portal patient search (S235, facility-constrained), My Patients tab (S234), work-queue composition (S215).
- **Reach a case:** ACS work queue → case → ancillary doc modals (S244), report upload (S246), procedure complete (S096).
- **Actions:** run procedure state transitions (complete/no-show/unable-to-complete via S096), upload reports (S246), handle consent/screening/report doc workflows (S244), capture signatures on consents (S245), mark case-document readiness. Procedure actions gated to ACS/tech.
- **Hidden/forbidden:** Clinician Portal (`RoleGuard{admin,clinician}`→/home), Admin, billing, `/invoices`. **PCS canonical view** is denied (technician not in `PCS_ROLES`) even though the PCS *page* has no client guard. Engagement admin APIs 403.
- **Knows work is blocked:** stage-vector availability cells (`upstream_flag_off`/`unavailable`/`migration_missing`, S219/S353); readiness `missing`/`blocked` (S248/S094); prerequisite blockers.
- **Knows work is complete:** procedure `complete`; report `uploaded`; readiness `completed`.
- **Portal transitions:** technician operates in ACS/Technician portal; hands signed-off clinical results toward the clinician (signature) and billing (readiness) via the case tables.

## liaison

- **Lands:** `/home` (Home nav `roles` excludes liaison → URL-reachable, not a nav highlight). Nav shows Imaging Central, Technician Portal, Liaison Technician Portal.
- **Sees first:** Home, then the Liaison/PCS portal.
- **Primary work queues:** Liaison Technician Portal (RT030, `requirePortalRole`) and PCS Portal (RT043) via `ClinicWorkflowPortal`. PCS canonical view is admitted (`PCS_ROLES={admin,liaison}`, S217/S216). This role coordinates the patient-care side of engagement/care coordination (upstream of scheduling execution).
- **Find a patient:** portal patient search (S235), PCS canonical patient-grouped episodes (S217), My Patients (S234), Portal Patient Directory (S228, wraps full EHR chart).
- **Reach a case:** PCS canonical view → patient episode → stage vectors (S219); case detail (S229/S230); patient command canvas (S227).
- **Actions:** patient-care coordination — log communications (S254), schedule patient (S255/S256 quick-schedule), quick notes (S241), call logging/history (S249), engagement-adjacent workflows. Read-only canonical lifecycle stage vectors (never recomputed client-side).
- **Hidden/forbidden:** Clinician Portal (RoleGuard→/home), Admin, billing, `/invoices`. **ACS canonical view** denied (liaison not in `ACS_ROLES`). Engagement admin APIs 403.
- **Knows work is blocked:** stage-vector availability + integrity cells (S219/S360 "current: (integrity)"), duplicate handoff bar (S079), canonical disabled/migration copy (S353).
- **Knows work is complete:** stage vector current-stage advancing; appointment `scheduled`.
- **Portal transitions:** liaison operates in PCS/Liaison portal; hands cases to scheduler (booking) and technician/ACS (execution).

---

## Notes & UNKNOWN_NEEDS_VERIFICATION

- Every canonical portal view (PCS/ACS/Clinician canonical, stage vectors) renders a **disabled contract** at HEAD because its flag is OFF — so the *data* a portal role sees today is the legacy/non-canonical surface, even where the role is admitted by guard.
- `scheduler`/`biller` have no server-side `requireRole` gate beyond auth + clinic scope; their restriction to specific surfaces is enforced by **client guards only** for the guarded routes, and by **nav visibility** otherwise. Server billing/invoice routes are not role-gated.
- `technician`/`liaison` are neither admin/biller (full dock) nor in `PORTAL_DOCK_ROLES={scheduler,clinician}` — the exact dock they receive is `UNKNOWN_NEEDS_VERIFICATION` (dock role-matching only branches on those two sets).
- Client demo labels (`"Clinic Admin"`, `"Owner"`, `"patientCareSpecialist"`, `"ancillaryCareSpecialist"`) are UI/demo constructs, NOT real session roles (`FUNCTIONAL_FREEZE §1.3`).
