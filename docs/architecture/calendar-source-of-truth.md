# Calendar — Source of Truth

> **Scope:** Single reference for the canonical calendar stack and
> every place that consumes it. The shared primitive layer is
> finished; this doc names which page renders the calendar, which
> profile it uses, and which data source feeds its cells.

## Canonical primitives (the one stack)

```
CanonicalCommandCalendar  (client/src/components/calendar/)
  ↓
UniversalCalendar          (client/src/calendar/)
  ↓
CanonicalMonthCalendar     (client/src/calendar/views/)
```

`CanonicalCommandCalendar` has two modes:

- `mode="inline"` — renders the month grid inline (left rails,
  dashboard tile).
- `mode="drawer"` — wraps in a right-side Sheet (header calendar
  buttons in Plexus IQ, PortalShell, HomeDashboard).

Both modes flow through the same `UniversalCalendar` →
`CanonicalMonthCalendar` path. The drawer is the only wrapper.

## Calendar profiles

`client/src/calendar/calendarProfiles.ts` registers seven
profiles:

`plexusIq` · `patientCareSpecialist` · **`ancillaryCareSpecialist`** ·
`technician` · `manager` · `admin` · `facility`

Each profile carries:
- `defaultView` (month / week / day / agenda)
- `defaultFilters` + `availableFilters`
- `availableDimensions`
- `addActions`
- `defaultScope` (`global` / `facility` / `teamMember` / `user`)
- visibility toggles (`allowFacilityOverride`,
  `allowAllFacilities`, `allowPhysicianClinicianFilter`,
  `allowTeamMemberFilter`)

`resolveCalendarProfileSettings(profileId, context, settings)` in
`client/src/calendar/calendarSettings.ts` merges base profiles with
`admin_settings` rows using global → user → facility → user+facility
precedence.

## Surface → profile → data source

| Surface | File | Mode | Profile id | Cells source |
| --- | --- | --- | --- | --- |
| Plexus IQ expandable right drawer | `client/src/pages/plexus-iq.tsx` | drawer | `plexusIq` | `calendarCells` ← `/api/screening-batches/calendar-summary` + procedure-complete events |
| Home Dashboard | `client/src/components/HomeDashboard.tsx` | drawer | `admin` | `homeCalendarCells` (aggregated dashboard data) |
| PCS / ACS header drawer | `client/src/components/portal/PortalShell.tsx` | drawer | `patientCareSpecialist` (PCS) or `ancillaryCareSpecialist` (ACS) | `teamPortalCalendarCells` ← `/api/portal/today-schedule` aggregated per date |
| PCS / ACS left rail mini calendar | `client/src/components/portal/PatientMiniCalendar.tsx` | inline | profile flips on mode (`patientCareSpecialist` / `ancillaryCareSpecialist`) | `canonicalCells` ← `/api/portal/month-summary?facility=&month=` |

## Read-only API endpoints powering the cells

- `/api/portal/today-schedule` — clinic-schedule cell builder
- `/api/portal/month-summary` — left-rail count per day
- `/api/global-schedule-events` — canonical schedule events (used
  by the drawer when filters require it)
- `/api/screening-batches/calendar-summary` — qualification counts
  per date (Plexus IQ)

Each endpoint already has a client helper in
`client/src/lib/workflow/` — `globalScheduleApi.ts`,
`schedulingTriageApi.ts`, etc.

## Contract: cells shape

```ts
type CanonicalMonthCellSummary = {
  count?: number;
  dots?: { className: string; title?: string }[];
  badge?: { icon?: React.ReactNode; className?: string; title?: string };
};
```

Every surface builds `Record<string, CanonicalMonthCellSummary>`
keyed by ISO date (`YYYY-MM-DD`). Days without entries render
empty. Tested by `qa:calendar-data-shape`.

## QA + smoke coverage

| Concern | Script |
| --- | --- |
| Profile registry + page-level routing | `qa:calendar-profile-wiring` |
| Cells builders + props at every surface | `qa:calendar-data-shape` |
| `admin_settings` override resolution | `qa:calendar-profile-overrides` |
| PCS/ACS mini calendar contract | `qa:pcs-acs-mini-calendar` |
| End-to-end source contract | `smoke:pcs-acs-portal` |
| Live route mounting | `smoke:pcs-acs-portal-live` |

## Where the calendar is NOT

- It is not rendered in `home.tsx` directly; the dashboard tile
  is owned by `HomeDashboard.tsx`.
- It is not rendered in the legacy `SchedulePage.tsx` /
  `schedule-dashboard.tsx` / `shared-schedule.tsx` — those surfaces
  use their own bespoke schedule grids today. Migrating them onto
  `CanonicalCommandCalendar` is a future batch and not required
  for canonical parity (they read the same `global_schedule_events`
  backend).
- `client/src/calendar/UniversalCalendarDrawer.tsx` is the
  primitive layer; **no page-level callsite** uses it directly —
  enforced by `qa:calendar-profile-wiring` +
  `smoke:pcs-acs-portal`.

## Cross-references

- `docs/architecture/tertiary-command-center-canonical-spine.md`
- `docs/architecture/pcs-acs-portal-solidness-audit.md`
- `client/src/components/calendar/CanonicalCommandCalendar.tsx`
- `client/src/calendar/UniversalCalendar.tsx`
- `client/src/calendar/views/CanonicalMonthCalendar.tsx`
