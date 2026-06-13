# Actual Care-Tech Portals — Phase 1 Audit (Slice 1.1)

**Status:** Live (real feed wired; demo-patient injection removed)
**Branch:** `fix/phase-1-full-system-audit-and-completion`
**Slice:** Phase 1 / Slice 1.1
**QA gate:** all 5 portal-feed scripts green; full repo QA gauntlet
green (`for s in scripts/qa-*.mjs; do node "$s" || exit 1; done`).

## 1. Canonical portal pages

| Page | File | Renders |
|---|---|---|
| Patient Care Specialist Workspace | `client/src/pages/patient-care-specialist-portal.tsx` | `<ClinicWorkflowPortal role="patientCareSpecialist" />` |
| Ancillary Care Specialist Workspace | `client/src/pages/ancillary-care-specialist-portal.tsx` | `<ClinicWorkflowPortal role="ancillaryCareSpecialist" />` |

Both pages are intentionally thin (17 and 14 lines). They delegate
shell mounting to `ClinicWorkflowPortal`, which routes both PCS and
ACS roles to `TeamPortalShell` with the workspace-specific
`defaultMode`:

- `patientCareSpecialist` → `defaultMode: "callList"`,
  `workspaceLabel: "Patient Care Specialist Workspace"`,
  `INTERNAL_ROLE: "liaison"` (call-oriented internals)
- `ancillaryCareSpecialist` → `defaultMode: "clinicSchedule"`,
  `workspaceLabel: "Ancillary Care Specialist Workspace"`,
  `INTERNAL_ROLE: "technician"` (clinic-day-oriented internals)

The legacy `technician` and `liaison` roles continue to route through
the older `PortalShell` (not changed in this slice).

## 2. Canonical concept inventory

| Concept | File | Status |
|---|---|---|
| `ClinicWorkflowPortal` | `client/src/components/workflow/ClinicWorkflowPortal.tsx` | Live — role adapter |
| `TeamPortalShell` | `client/src/components/portal/TeamPortalShell.tsx` | Live — primary workspace shell (≈2 580 lines after Slice 1.1 removals) |
| `WorkspaceModeSwitcher` | `client/src/components/portal/WorkspaceModeSwitcher.tsx` | Live — `clinicSchedule / ancillarySchedule / callList` |
| `PatientCommandCanvas` | `client/src/components/portal/PatientCommandCanvas.tsx` | Live — imported + rendered for patient tabs with a real `patientScreeningId` |
| `SchedulePatientPlayground` | `client/src/components/portal/SchedulePatientPlayground.tsx` | Live — imported + rendered when the playground context is set |
| `CallListPanel` | `client/src/components/outreach/CallListPanel.tsx` | Live (consumed by outreach surfaces; PCS uses it indirectly via the workspace feed) |
| `DispositionSheet` | `client/src/components/outreach/DispositionSheet.tsx` | Audited by **Slice 1.4** (call-result canonical writeback) |
| `CanonicalRowActions` | `client/src/components/outreach/CanonicalRowActions.tsx` | Audited by **Slice 1.4** |
| `PortalShell` | `client/src/components/portal/PortalShell.tsx` | Legacy shell for technician/liaison routes; left intact |

## 3. Feed wiring

### 3.1 Feed library

File: `client/src/lib/workflow/teamMemberWorkspaceApi.ts`

| Helper | Endpoint | Consumed by |
|---|---|---|
| `fetchWorkspaceClinicSchedule` | `GET /api/technician-liaison/clinic-visits` | `TeamPortalShell` |
| `fetchWorkspaceAncillarySchedule` | `GET /api/technician-liaison/ancillary-schedule` | `TeamPortalShell` |
| `fetchWorkspaceCallList` | `GET /api/scheduler-portal/cases` | `TeamPortalShell` |
| `fetchPatientScheduleDayContext` | `GET /api/global-schedule-events` (client-side bucketed) | `SchedulePatientPlayground` |
| `schedulePatientAncillary` | `POST /api/global-schedule-events/schedule-ancillary` | `SchedulePatientPlayground` |

File: `client/src/lib/workflow/teamMemberProfileApi.ts`

| Helper | Endpoint | Consumed by |
|---|---|---|
| `fetchTeamMemberProfile` | `GET /api/admin-settings/effective` (team_member / workspace_profile) | `TeamPortalShell` |

### 3.2 Shell-level wiring

`TeamPortalShell.tsx` consumes every feed via `useQuery`:

| Query key | Helper | Gated on |
|---|---|---|
| `["team-workspace-call-list", role, facility, selectedDate]` | `fetchWorkspaceCallList({ facilityId, startDate, endDate, limit: 100 })` | `!!facility` |
| `["team-workspace-clinic-schedule", facility, selectedDate]` | `fetchWorkspaceClinicSchedule({ facilityId, startDate, endDate, limit: 100 })` | `!!facility` |
| `["team-workspace-ancillary-schedule", facility, selectedDate]` | `fetchWorkspaceAncillarySchedule({ facilityId, startDate, endDate, limit: 100 })` | `!!facility` |
| `["/api/portal/my-facilities"]` | inline fetch | always |
| `["/api/auth/me"]` | inline fetch | always |
| `["/api/admin-settings/effective", "team_member", "workspace_profile", currentUserId]` | `fetchTeamMemberProfile` | `!!currentUserId` |

### 3.3 Facility scoping

Server-side scoping is enforced by `/api/portal/my-facilities`. The
shell additionally narrows client-side using
`workspaceProfile.assignedFacilityIds` when
`workspaceProfile.capabilities.viewAllFacilities` is false. This is
defense-in-depth (server-side narrowing already excludes
non-assigned facilities; the client filter prevents stale data from
appearing if the profile changes mid-session).

Ancillary schedule is additionally filtered by
`workspaceProfile.allowedServiceTypes` (case-insensitive substring
match), so a profile entry `"BrainWave"` matches canonical service
types like `brainwave - 95957`. This filter does **not** apply to the
call list (per spec: both workspaces read the canonical call list,
priority sorting + profile facility scope are sufficient).

## 4. Removed: hardcoded demo-patient injection

Before this slice, `TeamPortalShell.tsx` defined a hardcoded patient
named "Ali Boomaye" and unconditionally prepended it to the rendered
`patients` list. Side effects:

- Every workspace auto-selected the demo patient on first mount.
- Every patient row had a special `isAli` branch that flipped between
  real-feed `consentSigned` and a local `aliConsentComplete` toggle.
- The center patient-mode view had a special `DemoPatientProfile`
  renderer that displayed hardcoded demographics, history, diagnoses,
  medications, prior ancillaries, and cooldowns.
- The schedule dialog rendered hardcoded Insurance / Previous
  Ancillary Tests / Cooldown rows when the demo id matched.

This blocked real-feed verification on staging — operators could
never tell whether the workspace was actually wired to live data.

**Removed in this slice:**

| Symbol | Site | Replacement |
|---|---|---|
| `type DemoProfile` | (was ~line 121) | Removed |
| `function DemoPatientProfile(...)` | (was ~lines 575–693) | Removed |
| `const [aliConsentComplete, setAliConsentComplete]` | (was ~line 964) | Removed |
| `const [aliScreeningComplete, setAliScreeningComplete]` | (was ~line 965) | Removed |
| `const aliBoomayePatient = useMemo<TodayPatient>(...)` | (was ~lines 969–988) | Removed |
| `const aliBoomayeProfile = useMemo<DemoProfile>(...)` | (was ~lines 990–1008) | Removed |
| Demo-patient prepend in `patients` memo | (was ~lines 1164–1168) | `const patients = livePatients;` |
| Center mode `=== aliBoomayePatient.patientScreeningId` branch | (was ~line 1664) | Branch removed; `PatientDetail` always renders |
| Activetab guard `!== aliBoomayePatient.patientScreeningId` | (was ~line 1761) | Clause removed |
| `selected ?? aliBoomayePatient` schedule fallback | (was ~line 2009) | Guard `if (!selected) return;` |
| Per-row `isAli`/`aliConsentComplete`/`aliScreeningComplete` branches | (was ~lines 2232–2234) | `consentDone = !!p.consentSigned; screeningDone = false;` |
| Per-row `if (isAli) setAliConsentComplete((v) => !v);` | (was line 2328) | Removed |
| Per-row `if (isAli) setAliScreeningComplete((v) => !v);` | (was line 2347) | Removed |
| Schedule-dialog Insurance / Prior Ancillary / Cooldown block | (was ~lines 2638–2644) | Removed (real surface lives in Patient Directory warning facts) |

## 5. QA scripts added

- `scripts/qa-phase-1-patient-care-specialist-feed.mjs` — proves PCS
  page → ClinicWorkflowPortal → TeamPortalShell wiring + the 3 feed
  helpers + no demo-patient injection.
- `scripts/qa-phase-1-ancillary-care-specialist-feed.mjs` — same for
  ACS, plus the `allowedServiceTypes` + `filteredAncillarySchedule`
  shell rules.
- `scripts/qa-phase-1-teamportal-shell-mode-feeds.mjs` — proves all
  three `WorkspaceModeSwitcher` modes consume their canonical feed
  endpoints and that facility scoping wiring is present.
- `scripts/qa-phase-1-patient-command-canvas-live.mjs` — proves the
  canvas exists and is imported + rendered by the shell.
- `scripts/qa-phase-1-schedule-patient-playground-live.mjs` — proves
  the playground exists, is imported + rendered, and the live
  day-context helper is wired.

Every script is source-level (no DB or runtime probes). They all run
in <5 seconds and are safe to add to a pre-merge `for s in
scripts/qa-*.mjs; do node "$s" || exit 1; done` gauntlet.

## 6. Capability gating (unchanged in this slice)

Capability decisions remain driven by
`resolvePortalCapabilities({ workspaceType, profile })`:

- `canScheduleClinicVisit`
- `canScheduleAncillary`
- `canUseCallList`
- `canMarkProcedureCompleted`
- `canPrimaryConsentScreening`
- `canUploadProcedureReport`

PCS workspaces resolve `canCallAndSchedule = canScheduleClinicVisit ||
canScheduleAncillary || canUseCallList`. ACS resolves
`canCompleteProcedure = canMarkProcedureCompleted`. The defense-in-
depth note at line 855 of `TeamPortalShell.tsx` is preserved.

## 7. What still requires later-slice work

| Concern | Slice |
|---|---|
| Call-result canonical writeback default in `DispositionSheet` | Slice 1.4 |
| `CanonicalRowActions` audit | Slice 1.4 |
| Patient Directory warning facts in workspace patient detail | Slice 1.5 |
| Execution case / assigned work transactional commit | Slice 1.3 |
| Scheduler handoff smoke | Slice 1.8 |

## 8. Confirmation

- ✅ No new portal invented.
- ✅ No "Team Portal" cockpit added.
- ✅ Layout not redesigned.
- ✅ Real feeds wired (live), demo-patient injection removed.
- ✅ Source-level QA proves PCS, ACS, all 3 modes, PatientCommandCanvas
  and SchedulePatientPlayground wiring.
- ✅ Full repo `qa-*.mjs` gauntlet green (0 failures across the entire
  repository after the slice changes).
- ✅ `npm run check` green.
