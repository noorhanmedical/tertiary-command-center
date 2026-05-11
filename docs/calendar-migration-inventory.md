# Calendar Migration Inventory

This document tracks the **operational calendars** in the app and the order
in which they should adopt the canonical primitives in
`client/src/calendar/`. The primitive layer was added without removing
any existing surface — migrations happen one screen at a time, in a
controlled sequence, after the primitive layer is green.

## Operational calendars to migrate

These surfaces will eventually mount a canonical primitive
(`<CanonicalCalendarIcon>`, `<UniversalCalendarDrawer>`, or
`<UniversalCalendar>`) and stop owning their own calendar logic:

| File / Surface                                                 | Profile target              | Status |
| -------------------------------------------------------------- | --------------------------- | ------ |
| `client/src/components/plexus-iq/PlexusIQCalendar.tsx` <br/> `client/src/pages/plexus-iq.tsx` | `plexusIq`                  | **Migrated** — page renders `<UniversalCalendarDrawer profileId="plexusIq">` and passes `cells` derived from the calendar-summary + procedure-complete feeds. The assign-date affordance for unscheduled batches has been reattached through the canonical `unscheduledItems` / `onUnscheduledItemAction` hook: Plexus IQ derives items from summary rows where `!scheduleDate && patientCount > 0` and routes the action to `PlexusIQAssignDateDialog` (existing `handleAssignDate` performs the canonical PATCH). `PlexusIQCalendar.tsx` remains as legacy (no consumers) and is safe to delete once `CalendarSummaryRow` is moved to a shared module. |
| `client/src/components/outreach/TriClinicCalendar.tsx` <br/> `client/src/components/outreach/ExpandedSectionView.tsx` <br/> `client/src/pages/outreach-scheduler-portal.tsx` <br/> *(host: Patient Care Specialist Workspace, `/patient-care-specialist-portal`. Note: Outreach / Engagement Center is its own separate surface at `/engagement-center` and is not part of this workspace.)* | `patientCareSpecialist`     | pending |
| `client/src/components/clinic-calendar.tsx` (MiniCalendar / SlotGrid) <br/> `client/src/components/portal/PortalShell.tsx` (MonthlyMiniCalendar) <br/> *(host: Ancillary Care Specialist Workspace, `/ancillary-care-specialist-portal`)* | `technician`                | pending |
| `client/src/pages/team-ops.tsx` (StaffingCalendarTab)          | `manager`                   | pending |
| `client/src/pages/schedule-dashboard.tsx`                      | `manager` (or `admin`)      | pending |
| `client/src/pages/appointments.tsx`                            | `manager`                   | pending |
| `client/src/components/AppointmentModal.tsx`                   | (drawer launcher)           | pending |
| `client/src/components/ScheduleTile.tsx`                       | (drawer launcher)           | pending |

## Date pickers — **do not** migrate

These are not operational calendars; they pick a single date or range and
should stay as-is:

- `client/src/components/ui/calendar.tsx` (Radix-backed date picker primitive).
- DOB / DOS / date input fields on patient cards and forms.
- PTO range pickers when only used to select dates (e.g. PTO request form).
- One-off date inputs used to drive a single API field.

If a surface graduates from "pick a date" to "browse / manage scheduled
work", it moves into the canonical primitive layer.

## Migration order

Migrations run roughly in this order so the most-used / highest-leverage
surfaces convert first and inform downstream tweaks:

1. **Plexus IQ** — already the de-facto pilot. Plexus IQ's drawer + day
   modal become the canonical surfaces; existing `PlexusIQCalendar`
   becomes a thin wrapper around `UniversalCalendar` with
   `profileId="plexusIq"`.
2. **Patient Care Specialist / scheduler calendar** — `TriClinicCalendar`
   and the outreach scheduler portal adopt `profileId="patientCareSpecialist"`.
3. **Technician / Liaison / portal monthly calendar** — `clinic-calendar`
   MiniCalendar/SlotGrid and `PortalShell` MonthlyMiniCalendar adopt
   `profileId="technician"`.
4. **Manager / Admin / Team Ops staffing calendar** — `team-ops`
   StaffingCalendarTab adopts `profileId="manager"`.
5. **Schedule dashboard** — adopts `profileId="manager"` (or `admin` if
   permission gating tightens).
6. **Legacy appointments surfaces** — `appointments.tsx`,
   `AppointmentModal.tsx`, `ScheduleTile.tsx`. These migrate last; some may
   collapse into a launcher trigger that opens `UniversalCalendarDrawer`.

## What stayed unchanged in the Plexus IQ migration

- `PlexusIQDayModal` (the day-click popup) still renders the canonical
  `<ResultsView chromeless />`. Plexus PDF / Clinician PDF / Share /
  Export CSV / Send All to Scheduler all reuse the existing wiring.
- `PlexusIQWorkspace` (center facility → date → patient-card accordion)
  is untouched.
- The top dashboard row is untouched.
- The completed-procedure checkmark on the calendar still comes from
  `/api/global-schedule-events?eventType=procedure_complete`.
- Plexus IQ qualification keeps only two visible states: **Incomplete**
  and **Final**. No Ready, Ready-to-Generate, or Pending-Final states
  are exposed on the calendar.

## Migration mechanics

- Existing calendar components are **not deleted** in this batch. They
  stay live until each screen successfully boots through the canonical
  primitives.
- Each migration replaces the page's own filter list, add buttons, and
  drawer/grid logic with `<UniversalCalendar profileId="..." context=...>`
  (or `<UniversalCalendarDrawer>` for popover use).
- After a screen is migrated and verified, its old calendar component file
  can be deleted in a follow-up PR.
- During migration, no schema changes are introduced. All data still flows
  through `global_schedule_events`, `patient_screenings`, and
  `patient_execution_cases` via existing routes. The mappers in
  `calendarEventMapper.ts` adapt those rows to the canonical event shape.

## Checklist for each migration PR

- [ ] Page imports only from `@/calendar`.
- [ ] No new schema or backend route created.
- [ ] No new local calendar state owned by the page.
- [ ] All add actions resolve to canonical APIs (no fake state).
- [ ] Workflow-only statuses (needs new date, needs insurance review, …)
      stay out of the calendar filter list.
- [ ] Plexus IQ qualification keeps only `qualification_incomplete` and
      `qualification_final`.
- [ ] `npm run check` and `npm run build` pass.
- [ ] DB QA suites still pass when `DATABASE_URL` is present.
