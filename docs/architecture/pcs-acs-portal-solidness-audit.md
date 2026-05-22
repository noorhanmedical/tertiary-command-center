# PCS / ACS Portal — Solidness Audit

> **Scope:** Inventory of the Patient Care Specialist (PCS) and
> Ancillary Care Specialist (ACS) portal architecture after the
> calendar unification + ancillary care specialist profile work.
> This document is read-only and names every shared surface, every
> capability gate, every data source, and every documented gap.
> No UI changes land in this batch.

## Routing entry points

| Page | Source | Role passed |
| --- | --- | --- |
| `/patient-care-specialist-portal` | `client/src/pages/patient-care-specialist-portal.tsx` | `role="patientCareSpecialist"` |
| `/ancillary-care-specialist-portal` | `client/src/pages/ancillary-care-specialist-portal.tsx` | `role="ancillaryCareSpecialist"` |

Both pages are thin wrappers; the entire workspace lives in
`ClinicWorkflowPortal` → `PortalShell`.

## Role mapping

`client/src/components/workflow/ClinicWorkflowPortal.tsx` defines:

```ts
type WorkspaceRole =
  | "patientCareSpecialist"
  | "ancillaryCareSpecialist"
  | "technician"
  | "liaison";

const INTERNAL_ROLE: Record<WorkspaceRole, "technician" | "liaison"> = {
  patientCareSpecialist: "liaison",
  ancillaryCareSpecialist: "technician",
  technician: "technician",
  liaison: "liaison",
};
```

PortalShell still consumes the internal `"technician" | "liaison"`
role for legacy capability code, but the user-facing workspace name
is one of the four WorkspaceRole values. Capability gating is no
longer purely role-derived — see "Capabilities" below.

## Shared calendar (post-unification)

All four canonical calendar surfaces (PCS left rail, ACS left rail,
PCS/ACS header drawer, Plexus IQ expandable right drawer, Dashboard)
render through `CanonicalCommandCalendar`
(`client/src/components/calendar/CanonicalCommandCalendar.tsx`), which
wraps `UniversalCalendar` → `CanonicalMonthCalendar`.

| Surface | Mode | Profile id | Cells builder |
| --- | --- | --- | --- |
| PCS left rail | inline | `patientCareSpecialist` | `PatientMiniCalendar.canonicalCells` (facility month-summary) |
| ACS left rail | inline | `ancillaryCareSpecialist` | same `PatientMiniCalendar.canonicalCells` (mode flips profile) |
| PCS/ACS header drawer | drawer | `patientCareSpecialist` (PCS) / `ancillaryCareSpecialist` (ACS) | `PortalShell.teamPortalCalendarCells` |
| Plexus IQ right drawer | drawer | `plexusIq` | `plexus-iq.tsx.calendarCells` |
| Dashboard | drawer | `admin` | `HomeDashboard.homeCalendarCells` |

No `<UniversalCalendarDrawer>` is rendered at any page-level
callsite — the primitive is internal to the calendar layer.
Asserted by `npm run qa:calendar-profile-wiring`.

## Capability gating (PortalShell)

Capability flags are loaded from the Team Member Profile via
`fetchTeamMemberProfile(userId, role)` →
`/api/admin-settings/effective?settingDomain=team_member&settingKey=workspace_profile`.

| Flag | Source | Effect |
| --- | --- | --- |
| `callAndSchedule` | profile capability (default true) | All call/sched actions on the right rail |
| `completeProcedure` | profile capability (default true for ACS-typed, false otherwise) | Procedure-complete buttons on ancillary cards |
| `primaryConsentScreening` | profile capability | Primary consent / screening dialog access |
| `uploadProcedureReport` | profile capability | Report upload actions |
| `viewAllFacilities` | profile capability | "All facilities" picker in facility dropdown |
| `assignedFacilityIds` | profile | Filters the facility picker when `viewAllFacilities=false` |
| `allowedServiceTypes` | profile | Filters which ancillaries surface for this specialist |

The workspace **name** (PCS vs ACS) is no longer the gate —
the resolved profile is authoritative. Pre-profile-load fallbacks
default ACS-typed workspaces to `true` for procedure-side flags
and PCS-typed to `false`.

## Left-rail data sources

`PatientMiniCalendar`:
- Patient header from `patient` prop (passed by parent).
- Facility month summary from
  `GET /api/portal/month-summary?facility=&month=` (refreshes every
  30s).
- Calendar grid via `CanonicalCommandCalendar mode="inline"`.
- Schedule CTA bubbles up via `onSchedulePatient`.

`PortalShell` left rail also surfaces:
- "My Patients" / Patient Search panel (via
  `commandCenterApi.fetchMyPatients`).
- Patient card list with click-to-set-patient on the mini calendar.

## Right-rail / header drawer data sources

`PortalShell.teamPortalCalendarCells`:
- Aggregates `/api/portal/today-schedule` + clinic visits +
  ancillary-scheduled events into per-date counts.
- Used by the header calendar drawer (one button next to the
  facility filter).

## ACS-specific surfaces

When `workspaceIsAncillaryCareSpecialist`:
- Procedure-side ancillary cards expose Procedure Performed
  (`workspaceCanCompleteProcedure`).
- Report upload affordances surface
  (`workspaceCanUploadProcedureReport`).
- The right panel mode default is "Clinic Schedule" (ancillary
  workflow surface).

## Right panel modes

`PortalShell` exposes three right-panel modes — see the bottom-row
icon strip referenced by `key: "schedule"`, etc. (line ~2491).
Only Clinic Schedule is wired fully; the other modes are
placeholder structure. See "Documented gaps" below.

## Documented gaps (after the audit)

1. **Right-panel modes other than Clinic Schedule are stubs.**
   The icon strip suggests Ancillary Schedule, Call List, and
   others, but only the Clinic Schedule code path renders real
   data. The patient list panel and ancillary panel are
   placeholders or empty states.
2. **Action consistency between PCS and ACS isn't yet tested.**
   Closed by Batch 4 in this stream (`qa:pcs-acs-portal-actions`).
3. **Left-rail mini calendar facility scope doesn't honour
   `assignedFacilityIds`.** The facility dropdown does, but the
   month-summary fetch always uses the currently selected
   facility. If a specialist switches between facilities they
   aren't assigned to, the calendar will return 0 counts but no
   visible "you don't have access" hint. Worth surfacing.
4. **Patient Mini Calendar's `SchedulePatientDialog` doesn't
   confirm with the Team Member Profile's
   `allowedServiceTypes`.** A specialist could try to schedule
   a service they aren't authorized for; the failure is at the
   server, not in the dialog.
5. **No `qa:pcs-acs-portal-actions` script today.** Calendar
   wiring + data shape are covered (Batches 1 + 2 of this
   stream). Action availability (next batch) isn't.
6. **`workspaceIsAncillaryCareSpecialist === true` when
   `workspaceRole === undefined`.** Legacy callers without an
   explicit role still default to ACS-typed. PCS pages always
   pass `role="patientCareSpecialist"` so this only affects
   any future direct PortalShell mounts.

## Risky assumptions

- The internal `"technician" | "liaison"` role split in
  `ClinicWorkflowPortal.INTERNAL_ROLE` exists for back-compat.
  Anything reading `internalRole` (still a few places in
  `PortalShell` patient card filters) hasn't been migrated to
  use capability flags directly.
- The Team Member Profile is fetched from
  `admin_settings(team_member, workspace_profile)` and falls
  back to a role-derived default. A profile that *doesn't* set
  `capabilities.completeProcedure` is treated as `false` for
  PCS-typed workspaces — admins must explicitly opt-in. Worth
  a sanity check during onboarding.

## Cross-references

- `docs/architecture/tertiary-command-center-canonical-spine.md` —
  canonical spine reference.
- `client/src/calendar/calendarProfiles.ts` — profile registry.
- `client/src/calendar/calendarSettings.ts` —
  `resolveCalendarProfileSettings` (override resolver).
- `client/src/components/calendar/CanonicalCommandCalendar.tsx` —
  shared canonical calendar wrapper.
- `client/src/components/portal/PortalShell.tsx` — PCS + ACS shell.
- `client/src/components/portal/PatientMiniCalendar.tsx` — left-rail
  calendar with patient context.
- `client/src/components/workflow/ClinicWorkflowPortal.tsx` — role
  binding + internal role map.
- QA: `npm run qa:calendar-profile-wiring`,
  `npm run qa:calendar-data-shape`,
  `npm run qa:calendar-profile-overrides`.
