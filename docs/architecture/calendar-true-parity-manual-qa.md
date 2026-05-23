# Calendar True Parity — Manual QA

> **Scope:** Visual + behavioural checklist for confirming that
> the PCS / ACS left-rail calendars now show the same content
> Plexus IQ's right expandable drawer does. Run after the
> "calendar true parity" batch (`b008b9e`..`caf0e74`).

## What changed

`client/src/lib/calendar/commandCalendarViewModel.ts` now owns the
canonical cell + unscheduled-item builder. Plexus IQ, PCS / ACS
`PatientMiniCalendar`, and `HomeDashboard` all import the same
helper. PCS / ACS no longer use the count-only
`/api/portal/month-summary` feed — they fetch
`/api/screening-batches/calendar-summary` +
`/api/global-schedule-events?eventType=procedure_complete`
(scoped to the current facility) just like Plexus IQ.

## Manual checklist

### 1. Plexus IQ — right expandable calendar

- [ ] Open `/plexus-iq`.
- [ ] Click the calendar icon in the header.
- [ ] Confirm the drawer opens with the month grid.
- [ ] Pick a date where multiple batches exist; confirm the cell
      shows the **total count + violet/red/emerald dots** for the
      ancillary categories represented.
- [ ] Pick a date with a procedure complete event; confirm the
      ✓ badge renders.
- [ ] Confirm the **Unscheduled** panel below the grid lists
      batches without `scheduleDate`.

### 2. PCS portal — left-rail mini calendar

- [ ] Open `/patient-care-specialist-portal` as a PCS user with
      an assigned facility.
- [ ] Look at the left-rail mini calendar.
- [ ] **Confirm the same per-date count + ancillary dots** Plexus
      IQ shows for the current facility (no more single-blue-dot
      count-only cells).
- [ ] Confirm procedure-complete dates carry the ✓ badge.
- [ ] Switch the facility selector (if assigned). Confirm the
      calendar re-scopes.
- [ ] Click a date on the mini calendar; confirm `selectedDate`
      updates and the workspace mode body shifts accordingly.

### 3. ACS portal — left-rail mini calendar

- [ ] Open `/ancillary-care-specialist-portal` as an ACS user.
- [ ] Confirm the same cell shape as PCS — ancillary dots, total
      count, procedure-complete badge.
- [ ] Confirm the calendar still uses the `ancillaryCareSpecialist`
      profile (verifiable in dev tools — the
      `<CanonicalCommandCalendar>` `profileId` prop should be
      `"ancillaryCareSpecialist"` when `mode === "ancillarySchedule"`).
- [ ] Verify that switching workspace mode between
      `clinicSchedule`, `ancillarySchedule`, `callList` still
      flips the profile selection (you'll see the underlying
      filter label change in dev tools, but the grid data itself
      stays identical).

### 4. Home Dashboard — calendar drawer

- [ ] Open `/home`.
- [ ] Click the calendar icon in the header.
- [ ] Confirm the drawer shows the canonical per-date cells
      (count + ancillary dots + procedure-complete badge),
      aggregating across all facilities.
- [ ] Click a date; confirm selection callback fires.

### 5. Filter / profile differences (intentional)

- [ ] Plexus IQ uses `profileId="plexusIq"` — surfaces
      qualification-incomplete + final filters.
- [ ] Dashboard uses `profileId="admin"` — manager-level filters.
- [ ] PCS left rail uses `profileId="patientCareSpecialist"` —
      day-focus default + PCS filter universe.
- [ ] ACS left rail uses `profileId="ancillaryCareSpecialist"` —
      day-focus default + ACS filter universe (incl.
      procedureCompleted + ancillaryScheduled).

These profile-driven differences are intentional and live in
`calendarProfiles.ts`. The *data feed* and *cell rendering* are
identical; only the filter chips above the grid differ.

## Negative checks (must be false)

- [ ] PCS left rail does **not** render single-color appointment
      count cells without ancillary dots.
- [ ] ACS left rail does **not** look like a stripped-down
      version of Plexus IQ.
- [ ] PCS / ACS calendars do **not** miss the procedure-complete
      ✓ badge when one exists for the date.
- [ ] No surface renders `<UniversalCalendarDrawer>` directly
      (enforced by `qa:calendar-true-parity`).

## Automated coverage

- `npm run qa:calendar-true-parity` — 26/26 assertions on:
  - shared view model exports + pure-function correctness
  - Plexus IQ uses it
  - PatientMiniCalendar uses it
  - HomeDashboard uses it
  - profile mapping unchanged
  - drawer remains internal-only
- `npm run qa:calendar-complete` — 4/4 child scripts
- `npm run qa:pcs-acs-complete` — 6/6 child scripts
- `npm run qa:tertiary-command-center` — 15/15 child scripts

## Cross-references

- `client/src/lib/calendar/commandCalendarViewModel.ts` — the
  single canonical builder.
- `client/src/pages/plexus-iq.tsx` — drawer surface.
- `client/src/components/portal/PatientMiniCalendar.tsx` — PCS /
  ACS left rail.
- `client/src/components/HomeDashboard.tsx` — Dashboard drawer.
- `docs/architecture/calendar-source-of-truth.md` — overall
  calendar architecture.
