# Canonical Calendar Architecture

> Backend canonical calendar already exists: **`global_schedule_events`**.
> The frontend folder `client/src/calendar/` is a **read-model / primitive
> layer** on top of canonical backend tables. It is **not** a new source of
> truth and **never** writes its own schedule rows.

## Hard rules

- No page may create standalone operational calendar logic.
- Any calendar **icon trigger** must use `CanonicalCalendarIcon`.
- Any calendar **drawer/sheet** must use `UniversalCalendarDrawer`.
- Any **full operational calendar surface** must use `UniversalCalendar`.
- Pages pass only:
  - `profileId: CalendarProfileId`
  - `context?: CalendarContext`
  - optional click/select handlers
- Calendar filters must represent **date-bound events, scheduled work,
  due-today work, or date-bound patient groups**.
- Workflow statuses such as *needs new date, needs insurance review, manager
  review, wrong number, needs records, transportation issue, facility issue,
  technician unavailable* are **not** calendar filters unless they have a
  scheduled date/time. Those queues live in the Engagement Center,
  Scheduling Triage, or Manager Review surfaces.
- **Plexus IQ qualification has only two states**:
  - `qualification_incomplete`
  - `qualification_final`

  There is no Ready, Pending Final, or Ready-to-Generate state on the
  calendar.

## Canonical backend tables

The calendar primitives read (never write) from these tables:

- `global_schedule_events` — primary schedule source (visits, ancillary
  appointments, same-day adds, procedure complete, team availability,
  PTO/sick/unavailable blocks, no-show, cancellation, reschedule).
- `screening_batches` — workspace grouping by `(facility, scheduleDate)`.
- `patient_screenings` — qualification rows.
- `patient_execution_cases` — call list / case stage / `nextActionAt`.
- `patient_journey_events` — journey audit log.
- `procedure_events` — clinical procedure events.
- `case_document_readiness` — readiness signal.
- `billing_readiness_checks` — billing readiness signal.
- `completed_billing_packages`, `invoice_line_items`, `invoices`,
  `projected_invoice_rows` — billing surfaces (read-only on the calendar).
- `admin_settings` — settings overrides.

Frontend mappers in `calendarEventMapper.ts` translate these rows into
`CanonicalCalendarEvent` objects. Each event keeps `sourceTable + sourceId`
so consumers can drill back into canonical detail.

## Profiles

Calendar profiles bundle the filter set, dimensions, add actions, and
default scope for a particular surface. Defined in `calendarProfiles.ts`:

| Profile ID              | Default view | Default scope | Highlights                            |
| ----------------------- | ------------ | ------------- | ------------------------------------- |
| `plexusIq`              | month        | global        | qualification incomplete/final, all facilities |
| `patientCareSpecialist` | day          | teamMember    | own call list, scheduled visits, ancillaries  |
| `technician`            | day          | facility      | ancillary execution, same-day adds            |
| `manager`               | week         | global        | full filter universe + all add actions        |
| `admin`                 | week         | global        | platform-level access                         |
| `facility`              | week         | facility      | clinic operations within one facility         |

Helpers:

```ts
import { getCalendarProfile } from "@/calendar";
const profile = getCalendarProfile("plexusIq");
```

## Settings

Calendar surfaces use a deterministic two-layer model:

1. **Code** owns the universe of allowed filters, dimensions, and add
   actions (per profile).
2. **`admin_settings`** rows can override which of those allowed values are
   visible/default per profile.

Settings rows are read with:

```
settingDomain = "global_schedule"   // CALENDAR_SETTINGS_DOMAIN
settingKey    = "calendar_profiles" // CALENDAR_SETTINGS_KEY
```

Setting `settingValue` shape:

```jsonc
{
  "profiles": {
    "plexusIq": {
      "enabledFilters": [...],
      "defaultFilters": [...],
      "hiddenFilters":  [...],
      "addActions":     [...],
      "defaultView":    "month",
      "allowFacilityOverride":           true,
      "allowAllFacilities":              true,
      "allowPhysicianClinicianFilter":   true,
      "allowTeamMemberFilter":           true
    }
  }
}
```

Scope rules (lowest → highest precedence):

1. **Global** — `facilityId` and `userId` both `null`.
2. **User** — `userId` matches `context.userId`, no `facilityId`.
3. **Facility** — `facilityId` matches `context.facilityId`, no `userId`.
4. **User + facility** — both match.

Higher-precedence overrides apply last. Any filter or add action outside
the validated allow-lists is dropped. Settings cannot enable a filter that
isn't already in the base profile's `availableFilters` (except for `manager`
and `admin` which already include the full universe).

## Facility-specific behavior

- A profile can default to a facility scope (`technician`, `facility`).
- Settings can override per `facilityId` row.
- The `technician` profile defaults to facility scope; admins may permit
  `allowFacilityOverride` so a tech can hop facilities when allowed.
- `manager` and `admin` see all facilities by default
  (`allowAllFacilities: true`).

## Adding a calendar to a new page

```tsx
// Icon launcher (drawer)
import { CanonicalCalendarIcon } from "@/calendar";

<CanonicalCalendarIcon
  profileId="plexusIq"
  context={{
    facilityId,
    physicianId,
    clinicianId,
    teamMemberId,
    userId,
    role,
    date,
  }}
/>

// Or open a drawer programmatically
import { UniversalCalendarDrawer } from "@/calendar";

<UniversalCalendarDrawer
  profileId="patientCareSpecialist"
  context={{ facilityId, userId, role }}
  open={open}
  onOpenChange={setOpen}
/>
```

Pages that own a full calendar surface render `UniversalCalendar` directly
in their main column — never reimplement filters, dimensions, or add
actions outside of these primitives.
