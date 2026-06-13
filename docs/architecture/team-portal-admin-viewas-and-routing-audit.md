# Team Portal admin view-as + routing audit

**Status:** Phase 1.5 correction. Builds on the merged Phase 1 PR #279.
**Branch:** `fix/team-portal-routing-admin-viewas`
**Premium UI PR #278:** untouched, still open.

This document records the routing correction and admin view-as design.
Every claim is anchored to a file path; QA scripts enforce the
invariants.

---

## 1. Routes audit — before / after

| Route | Before | After |
|---|---|---|
| `/home` | Main app dashboard | Unchanged (target for admin Home dock button) |
| `/patient-care-specialist-portal` | `PatientCareSpecialistPortalPage` → `<ClinicWorkflowPortal role="patientCareSpecialist" />` | Unchanged (canonical PCS) |
| `/ancillary-care-specialist-portal` | `AncillaryCareSpecialistPortalPage` → `<ClinicWorkflowPortal role="ancillaryCareSpecialist" />` | Unchanged (canonical ACS) |
| `/team-member-portals` | 3 tiles: PCS, ACS, Engagement Center | **2 tiles: PCS, ACS only** |
| `/engagement-center` | Assignment / disbursement (manager) | Unchanged (still the disbursement surface) |
| `/scheduler-portal` | Mounted `OutreachPage` | Unchanged route + component; **nav label corrected** |
| `/outreach-center` | Redirect to `/scheduler-portal` | Unchanged |
| `/outreach` | Redirect to `/scheduler-portal` | Unchanged |
| `/outreach/scheduler/:id` | `OutreachSchedulerPortalPage` | Unchanged |

Routes that were **considered but not changed** because Phase-1.5 only
corrects labels + tiles, not route paths:

- `/technician-portal` (legacy)
- `/liaison-technician-portal` (legacy)

---

## 2. Wrong Outreach / Team Portal links found

| File | Issue | Fix |
|---|---|---|
| `client/src/components/GlobalNav.tsx:34` | Nav entry labeled "Scheduler Portal" pointing at `/scheduler-portal` (which actually mounts the OutreachPage marketing dashboard) | Relabeled to **"Outreach Center"** with a top-of-line comment explaining why. Route path kept for back-compat. |
| `client/src/pages/team-member-portals.tsx` (3rd tile) | "Outreach / Engagement Center" tile pointing at `/engagement-center` on the Team Member Portals landing | **Tile removed.** Engagement Center is reachable from the main app nav; it is not an execution portal. |

---

## 3. Correct PCS / ACS route map

```
/patient-care-specialist-portal
  → PatientCareSpecialistPortalPage           (17 lines)
  → <ClinicWorkflowPortal role="patientCareSpecialist" />
  → TeamPortalShell                            (shared shell)
  → defaultMode: "callList"
  → INTERNAL_ROLE: "liaison" (call-oriented internals)
  → WORKSPACE_LABEL: "Patient Care Specialist Workspace"

/ancillary-care-specialist-portal
  → AncillaryCareSpecialistPortalPage          (14 lines)
  → <ClinicWorkflowPortal role="ancillaryCareSpecialist" />
  → TeamPortalShell                            (SAME shared shell)
  → defaultMode: "clinicSchedule"
  → INTERNAL_ROLE: "technician" (clinic-day-oriented internals)
  → WORKSPACE_LABEL: "Ancillary Care Specialist Workspace"
```

Both routes resolve to the same `TeamPortalShell` instance. The only
behavioral differences:

- `defaultMode` (which right-panel mode the workspace lands on).
- `workspaceLabel` (visible header text).
- `INTERNAL_ROLE` (drives internal-only branches in the shell).

**No separate visual system. No new cockpit. No redesign.**

---

## 4. PCS and ACS share the same shell — proof

| File | Evidence |
|---|---|
| `client/src/pages/patient-care-specialist-portal.tsx` | `<ClinicWorkflowPortal role="patientCareSpecialist" />` |
| `client/src/pages/ancillary-care-specialist-portal.tsx` | `<ClinicWorkflowPortal role="ancillaryCareSpecialist" />` |
| `client/src/components/workflow/ClinicWorkflowPortal.tsx` | `isTeamMemberWorkspace(role) → <TeamPortalShell />` for both roles |
| `client/src/components/portal/TeamPortalShell.tsx` | Same dock, same `WorkspaceModeSwitcher`, same `PatientCommandCanvas`, same `SchedulePatientPlayground`, same `CallListPanel`, same `DispositionSheet`, same `CanonicalRowActions` are imported / rendered for both |

Enforced by `scripts/qa-team-portals-shared-layout-pcs-acs.mjs`.

---

## 5. Admin Home dock button behavior

| Property | Value |
|---|---|
| Trigger | Click on dock leftmost icon (admin-only, gated on `isAdmin = currentUserRole === "admin"`) |
| Visible to | Admin sessions only |
| Hidden for | PCS / ACS / clinician / biller / scheduler / technician / liaison sessions |
| Icon | `Home` from `lucide-react` |
| Route | `/home` (via `useLocation()` from wouter → `setLocation("/home")`) |
| Position | Prepended to the existing 6-icon dock (tasks · schedule · consent · chart · documents · ai). The dock structure itself is NOT redesigned. |
| Test id | `dock-icon-home` |

Enforced by `scripts/qa-team-portals-admin-home-dock-button.mjs`.

---

## 6. Engagement Center role

| Property | Value |
|---|---|
| Path | `/engagement-center` |
| Component | `EngagementCenterPage` (55 lines) |
| Body | Renders `EngagementAssignmentBoard` (assignment surface) |
| Backend | Reads `/api/engagement/assignment-board` (canonical) |
| What it owns | Disbursement of Admin-Review-approved patients to PCS / ACS users; the assignment board, follow-up queue, team-member coordination view |
| What it does NOT own | Patient-coordination call execution (lives in PCS Workspace) or ancillary execution (lives in ACS Workspace) |
| Reachability | Sidebar nav entry + direct URL only — NOT a Team Member Portals tile |

Enforced by `scripts/qa-engagement-disburses-to-pcs-acs.mjs`.

---

## 7. Outreach / Marketing role

| Property | Value |
|---|---|
| Path | `/scheduler-portal` (legacy URL, kept for back-compat) |
| Visible nav label | "Outreach Center" (was "Scheduler Portal") |
| Component | `OutreachPage` (renders scheduler-coverage cards, conversion metrics, capacity %, conversion %) |
| What it owns | Marketing campaign metrics, source / scheduler-coverage performance, call metrics summary |
| What it does NOT own | Patient execution worklists (lives in PCS Workspace), ancillary execution (lives in ACS Workspace), Engagement assignments (lives in Engagement Center) |

Enforced by `scripts/qa-outreach-is-marketing-not-execution.mjs`.

---

## 8. Admin view-as design

**Mental model:** the admin is an *observer*. The selected team
member's facility allow-list narrows the feeds; the admin's session
identity is preserved so writes (call results, approvals, journey
events) are recorded against the **real admin**, not a fabricated
team-member identity. This is **view-as, not impersonation**.

### 8.1 Selection

| Property | Value |
|---|---|
| UI surface | Dropdown in the shared `TeamPortalShell` header (data-testid `admin-viewas-team-member-select`) |
| Visible to | Admin sessions only (`{isAdmin && (...)}` JSX gate) |
| Options | "Admin (self)" + active users matching the workspace role (PCS→liaison, ACS→technician), pulled from `GET /api/portal/team-members?workspace=<pcs|acs>` |
| State | `viewAsTeamMemberId: string | null` (null = self) |
| Auto-reset | Cleared when `currentUserRole` is not admin OR when the selected user disappears from the candidate list |

### 8.2 Feed routing

Every workspace feed query carries `viewAsTeamMemberId`:

| Query / endpoint | Key includes viewAsTeamMemberId? | Param forwarded? |
|---|---|---|
| `team-workspace-call-list` → `GET /api/scheduler-portal/cases` | Yes | Yes (`workspace="pcs"`) |
| `team-workspace-clinic-schedule` → `GET /api/technician-liaison/clinic-visits` | Yes | Yes |
| `team-workspace-ancillary-schedule` → `GET /api/technician-liaison/ancillary-schedule` | Yes | Yes |
| `/api/portal/my-facilities` | Yes | Yes |
| `/api/portal/today-schedule` | Yes | Yes |
| `fetchTeamMemberProfile` | profileTargetUserId resolves to view-as user when admin observes | (resolved via profile lookup, not query string) |

Enforced by `scripts/qa-team-portals-pcs-feed-viewas.mjs` and
`scripts/qa-team-portals-acs-feed-viewas.mjs`.

### 8.3 Backend guard

| Layer | Behavior |
|---|---|
| `requirePortalRole` middleware | Required on the team-members endpoint (admin/technician/liaison). The handler then asserts `session.role === "admin"` and returns 403 otherwise. |
| `resolveAdminViewAsUserId(req, raw, workspace?)` | Returns `null` if caller is not admin. Validates user exists + is active. If `workspace` is supplied, additionally requires the user's role to match (`pcs→liaison`, `acs→technician`). Returns null on any mismatch. |
| `allowedFacilities(req, { viewAsUserId })` | When `viewAsUserId` is supplied AND the caller is admin, returns the team member's facility allow-list (NOT `{ all: true }`). Otherwise legacy behavior. |
| Per-endpoint scope helper | Both `globalSchedule.ts` and `executionCases.ts` call `resolveAdminViewAsUserId` then pass the result into `allowedFacilities`. The 400/403 responses for missing/unauthorized facility are unchanged from Slice 1.2. |

Enforced by `scripts/qa-team-portals-admin-viewas-server-guard.mjs`
and `scripts/qa-team-portals-viewas-facility-scoping.mjs`.

---

## 9. Backend endpoints changed / reused

### 9.1 New (one endpoint)

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/portal/team-members?workspace=pcs|acs` | `requirePortalRole` + handler-level `session.role === "admin"` gate | Returns `{ workspace, teamMembers: [{ id, username, role, active }] }` for the selected workspace. Non-admin → 403. Bad workspace → 400. |

### 9.2 Modified (signature backward-compatible)

| Symbol | Change |
|---|---|
| `allowedFacilities(req, opts?: { viewAsUserId?: string | null })` | Added `opts.viewAsUserId`. Defaulted to undefined. When supplied AND admin caller, returns the team member's allow-list. |
| `/api/portal/my-facilities` handler | Reads `?viewAsTeamMemberId=` and forwards to `allowedFacilities`. |
| `/api/portal/today-schedule` handler | Same. |
| `/api/technician-liaison/clinic-visits` handler | Same (via `resolvePhase1FacilityScope`). |
| `/api/technician-liaison/ancillary-schedule` handler | Same. |
| `/api/scheduler-portal/cases` handler | Same, with `workspace="pcs"` enforced. |

### 9.3 New helpers exported

`server/routes/portal.ts` now exports:

- `requirePortalRole` (already exported in Slice 1.2)
- `allowedFacilities` (already exported in Slice 1.2)
- `resolveAdminViewAsUserId` (new)
- `VIEWAS_WORKSPACE_TYPES` + `type ViewAsWorkspaceType` (new)

### 9.4 New storage / repository methods

- `users.repo.ts → listByRole(role: string)`
- `storage.ts → getUsersByRole(role: string)`

---

## 10. Facility scoping proof (Phase 1.2 preservation)

| Check | Evidence |
|---|---|
| `PHASE-1 FACILITY SCOPE` markers still present | `server/routes/globalSchedule.ts`, `server/routes/executionCases.ts` |
| `requirePortalRole` middleware still applied to the 3 Phase-1 endpoints | Same files |
| `400 "facilityId is required for non-admin callers"` response shape unchanged | Same files |
| `403 "Forbidden — clinic not assigned to this user"` response shape unchanged | Same files |
| View-as branch returns a **scoped** allow-list (not `{ all: true }`) | `server/routes/portal.ts → allowedFacilities` |

Enforced by `scripts/qa-team-portals-viewas-facility-scoping.mjs` AND
the pre-existing `scripts/qa-phase-1-facility-scoping.mjs`.

---

## 11. Audit identity behavior

| Scenario | Actor recorded |
|---|---|
| Admin observes PCS team member, then logs a call result | Real admin (`session.userId`) |
| Admin observes PCS team member, then approves a patient via Admin Review | Real admin (`session.userId` — Slice 1.3 unchanged) |
| Admin observes ACS team member, then schedules an ancillary | Real admin (no admin-approval path here; the global schedule write uses `session.userId`) |
| Regular liaison / technician makes a call result | Their own user id (no view-as path) |

The view-as resolver explicitly preserves the session role
(`session role stays "admin"` in the comment) so downstream audit
columns (`actorUserId`, `adminApprovedByUserId`) get the real admin.

Enforced by `scripts/qa-team-portals-viewas-audit-identity.mjs`.

---

## 12. QA results

| Script | Result |
|---|---|
| `qa-team-portals-no-outreach-routing.mjs` | ✅ |
| `qa-team-portals-admin-viewas-selector.mjs` | ✅ |
| `qa-team-portals-admin-viewas-server-guard.mjs` | ✅ |
| `qa-team-portals-pcs-feed-viewas.mjs` | ✅ |
| `qa-team-portals-acs-feed-viewas.mjs` | ✅ |
| `qa-team-portals-viewas-facility-scoping.mjs` | ✅ |
| `qa-team-portals-viewas-audit-identity.mjs` | ✅ |
| `qa-team-portals-shared-layout-pcs-acs.mjs` | ✅ |
| `qa-team-portals-admin-home-dock-button.mjs` | ✅ |
| `qa-outreach-is-marketing-not-execution.mjs` | ✅ |
| `qa-engagement-disburses-to-pcs-acs.mjs` | ✅ |
| `qa-team-portals-restore.mjs` (updated in-step to the new contract) | ✅ |

Full repo gauntlet: **239 QA scripts, 0 failed.**

---

## 13. Smoke results

| Script | Result |
|---|---|
| `smoke-team-portals-admin-viewas-routing.mjs` (new) | PASS (1 DB-skip with honest reason) |
| `smoke-phase-1-full-system-wiring.mjs` | PASS |
| `smoke-phase-1-end-to-end.mjs` | PASS |
| `smoke-phase-1-full-completion.mjs` | PASS |
| `smoke-patient-directory-duplicates.mjs` | PASS |
| `smoke-patient-directory-full-activation.mjs` | PASS |
| `smoke-plexus-iq-run-selection-hotfix.mjs` | PASS |

`npm run check` clean. `npm run build` clean.

---

## 14. Known follow-ups (Phase 1.6+)

- Wire view-as into `/api/portal/outreach-call-list` (legacy outreach
  UI surface) so admin view-as covers the legacy DispositionSheet path
  too. Not blocking Phase 1.5 because the canonical call-list feed
  already honors view-as.
- Wire view-as into `/api/portal/my-tasks` (dock "tasks" surface).
  Same rationale.
- Consider promoting `resolvePhase1FacilityScope` to a shared module
  (currently duplicated in `globalSchedule.ts` + `executionCases.ts`).
- The view-as selector renders `username` only. A future iteration
  could display the team member's display name from the workspace
  profile.

These do not affect the Phase 1.5 contract — they are quality-of-life
follow-ups.
