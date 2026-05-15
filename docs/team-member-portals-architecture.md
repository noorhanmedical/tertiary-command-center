# Team Member Portals Architecture

**Team Member Portals** is the landing surface for the two — and only two —
team-member workspaces:

1. **Patient Care Specialist Workspace**
2. **Ancillary Care Specialist Workspace**

**Outreach / Engagement Center** is **separate** from the Patient Care
Specialist Workspace and is **not** part of Team Member Portals. It is
its own command-center surface accessible from its own tile and route.

## Hard rules

- Patient Care Specialist Workspace and Ancillary Care Specialist Workspace
  share the **same shell architecture** (`ClinicWorkflowPortal` →
  `PortalShell`). They look structurally identical. Data and right-panel
  defaults may differ; layout, left rail, center area, and right panel
  do not.
- Patient Care Specialist Workspace must **not** render OutreachPage.
- Outreach / Engagement Center renders OutreachPage and lives at
  `/engagement-center`.
- Scheduler / Technician / Liaison portal names are legacy and must not
  appear as visible labels in new copy.
- Liaison is not a separate portal. Liaison capabilities live inside
  Ancillary Care Specialist Workspace.

## Routes

| Canonical route                          | Renders                                              | Legacy redirects                          |
| ---------------------------------------- | ---------------------------------------------------- | ----------------------------------------- |
| `/team-member-portals`                   | Two-card landing                                     | —                                         |
| `/patient-care-specialist-portal`        | `<ClinicWorkflowPortal role="patientCareSpecialist" />` | `/scheduler-portal`                       |
| `/ancillary-care-specialist-portal`      | `<ClinicWorkflowPortal role="ancillaryCareSpecialist" />` | `/technician-portal`, `/liaison-technician-portal`, `/liaison-portal` |
| `/engagement-center`                     | `OutreachPage`                                       | `/outreach`, `/outreach-center`           |

`/outreach/scheduler/:id` is unchanged.

## Shell architecture

```
┌────────────────────────────────────────────────────────────┐
│ Workspace header (title flips per role)                    │
├──────────────┬───────────────────────────────┬─────────────┤
│ Left rail    │ Center patient / workflow     │ Right panel │
│ (unchanged)  │ area (unchanged)              │             │
│              │                               │  [ mode     │
│              │                               │    tabs ]   │
│              │                               │  (existing  │
│              │                               │   list /    │
│              │                               │   content)  │
└──────────────┴───────────────────────────────┴─────────────┘
```

The shell is **the same** for both workspaces. The only role-specific
differences in this batch are:

- The header **title** flips between
  `Patient Care Specialist Workspace` and
  `Ancillary Care Specialist Workspace`.
- The right-panel **default mode** differs:
  - Patient Care Specialist Workspace default: **Call List**
  - Ancillary Care Specialist Workspace default: **Clinic Schedule**

Both default-mode state lives in `PortalShell` already; the tab strip
is provided by `WorkspaceModeSwitcher` and is mounted at the top of the
existing right panel. Layout, colors, and shell structure were
intentionally preserved — only the tab strip was added inside the
existing right-panel body. The right-panel body is now wired to the
canonical sources per mode (see Hydrated right-panel modes below).

## Profile-driven workspace behavior

**Patient Care Specialist Workspace and Ancillary Care Specialist
Workspace have exactly the same three tabs:**

1. Clinic Schedule
2. Ancillary Schedule
3. Call List

Tab visibility, action availability, facility scope, and default tab
are **not** hardcoded by workspace name. What the user sees and can do
is driven entirely by the logged-in team member's profile:

| Profile field            | Effect at runtime                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `defaultMode`            | Seeds `activeWorkspaceMode` on first render (one-shot; user clicks persist after that).           |
| `assignedFacilityIds`    | Narrows the left-rail facility chooser. When current facility falls outside the list (and `viewAllFacilities` is false), the shell auto-snaps to `defaultFacilityId` or the first assigned facility. |
| `defaultFacilityId`      | Pre-selected facility on first render when valid; otherwise first assigned facility wins.         |
| `capabilities.callAndSchedule`        | Both PCS and ACS default true. Profile can disable for read-only members.                |
| `capabilities.completeProcedure`      | Controls whether the inline **Procedure Complete** button renders on Ancillary Schedule rows.  Workspace name (PCS vs ACS) is no longer the gate. |
| `capabilities.primaryConsentScreening`| Controls whether primary consent/screening actions surface (today wired through existing Clinic Schedule patient cards; runtime gate via this flag). |
| `capabilities.uploadProcedureReport`  | Reserved for upload/report flows; off by default for PCS, on by default for ACS.          |
| `capabilities.viewAllFacilities`      | Bypasses the `assignedFacilityIds` allow-list and any facility-scope snap-back.            |
| `allowedServiceTypes`    | Filters the Ancillary Schedule list to rows whose `serviceType` matches (case-insensitive substring). Empty list means no restriction. |

**Both PCS and ACS can call and schedule** by default. The call-list
read is no longer narrowed by an `assignedRole` hint derived from the
workspace name — both workspaces hit the same canonical call list and
the profile's facility scope handles narrowing.

**Procedure-side actions** (procedure complete, consent/screening
primary ownership, upload procedure report) appear when the matching
profile capability is `true`, regardless of which workspace label the
user is logged into.

When a profile has no assigned facilities and `viewAllFacilities` is
false, the right panel shows:

> *No facility assigned. Ask an admin to update your Team Member Profile.*

## Hydrated right-panel modes

The mode tabs at the top of the existing right panel render different
content under the same shell, fed by existing canonical read endpoints:

| Mode               | Endpoint                                       | Backed by                                                                  |
| ------------------ | ---------------------------------------------- | -------------------------------------------------------------------------- |
| Clinic Schedule    | `/api/portal/today-schedule` (existing list) + `/api/technician-liaison/clinic-visits` for loading hint | `global_schedule_events` (doctor_visit, same_day_add) + `patient_screenings` for the day. For ACS this is where consent / screening completion flows run; readiness comes from `case_document_readiness`. |
| Ancillary Schedule | `/api/technician-liaison/ancillary-schedule`   | `global_schedule_events` (ancillary_appointment). **Facility filter is primary** — so remote-scheduler-created ancillary appointments still surface in ACS Ancillary Schedule for that facility. |
| Call List          | `/api/scheduler-portal/cases` (client-side date filter on `nextActionAt`) | `patient_execution_cases.nextActionAt` + `patient_journey_events`.        |

**Capabilities:**

- Both Patient Care Specialist Workspace and Ancillary Care Specialist
  Workspace can **call, schedule, coordinate, reschedule, and document
  outcomes**. Call List and scheduling actions are not gated to one
  workspace.
- **Only Ancillary Care Specialist Workspace** sees procedure-side
  actions:
  - Mark Procedure Complete (visible inline on Ancillary Schedule rows
    that have `patientScreeningId` + `serviceType`).
  - Primary owner of Consent / Screening Form completion in Clinic
    Schedule mode.
  - Procedure report uploads + procedure-side readiness.
- Patient Care Specialist Workspace **does not** show
  `<ProcedureCompleteButton>` on its Ancillary Schedule rows.

**Defaults:**

- Patient Care Specialist Workspace default mode: **Call List**
- Ancillary Care Specialist Workspace default mode: **Clinic Schedule**

**Filtering and scope:**

- Facility filter is always applied when the workspace has an active
  facility selection (existing left-rail facility chooser).
- Call List passes `assignedRole` as a hint ("scheduler" for PCS,
  "liaison" for ACS) so canonical priority sorting matches each
  workspace, but both workspaces can read the same call list.
- Per-team-member assignment narrowing is intentionally deferred — the
  current user → team member id mapping will be applied via admin
  settings in a future batch. For now, facility scope is authoritative.

## Team Member Profile Settings

New team members are created in **Admin → Users**. The Add User dialog
captures a username, password, and role (admin / clinician / scheduler /
technician / liaison / biller).

Each user row in Admin → Users has a **Profile** action that opens the
**Team Member Profile** dialog. The profile is stored in `admin_settings`
under:

```
settingDomain = "team_member"
settingKey    = "workspace_profile"
userId        = <user id>
```

**No new database table is required.** The existing `admin_settings`
row scoping (per-user, optionally per-facility) is reused.

The profile controls:

- **Workspace Type** — Patient Care Specialist Workspace or Ancillary
  Care Specialist Workspace.
- **Assigned Facilities** — facility allow-list applied to the left-rail
  facility chooser.
- **Default Facility** — auto-selected when the user first lands in the
  workspace (must be inside the assigned list unless View All Facilities
  is on).
- **Default Mode** — Clinic Schedule, Ancillary Schedule, or Call List.
  Used to seed the right-panel tab on first render.
- **Capabilities**:
  - Can call and schedule (both PCS and ACS).
  - Can complete procedure (ACS-only at runtime).
  - Can manage consent / screening (ACS-only at runtime).
  - Can upload procedure report (ACS-only at runtime).
  - Can view all facilities.
- **Allowed Service Types** — optional comma-separated list for future
  filtering.

**Runtime gates** (defense-in-depth):

- Procedure-side capabilities (complete procedure, consent/screening
  primary ownership, upload procedure report) require **both** the
  workspace type to be Ancillary Care Specialist **and** the profile
  capability bit to be true. A PCS-typed profile can never gain these
  capabilities even if a stale setting row claims otherwise.
- When the resolved profile has no assigned facilities and
  `viewAllFacilities` is false, the right panel shows:
  *"No facility assigned. Ask an admin to update your Team Member Profile."*

**Endpoints used (read-only / write-on-save):**

- `GET /api/admin-settings/effective?settingDomain=team_member&settingKey=workspace_profile&userId=...`
  — resolves the most specific active profile row using the canonical
  (facility, user) → (facility, NULL) → (NULL, user) → (NULL, NULL)
  precedence.
- `POST /api/admin-settings/upsert` — admin-only; inserts or updates the
  row keyed by `(settingDomain, settingKey, facilityId, userId)`.
- `GET /api/admin-settings?settingDomain=team_member&settingKey=workspace_profile&active=true`
  — lists every saved profile (used by the admin dialog to show
  existing rows).

Both PCS and ACS retain call/scheduling capabilities. Only the ACS
workspace shows procedure-complete + consent/screening primary actions.

## Right-panel modes (foundation only in this batch)

| Mode ID            | Visible label        | Canonical data source (later batch)                                                          |
| ------------------ | -------------------- | --------------------------------------------------------------------------------------------- |
| `clinicSchedule`   | Clinic Schedule      | `global_schedule_events` (doctor_visit, same_day_add) + `patient_screenings` for the day      |
| `ancillarySchedule`| Ancillary Schedule   | `global_schedule_events` (ancillary_appointment) + `procedure_events`                         |
| `callList`         | Call List            | `patient_execution_cases.nextActionAt` + `patient_journey_events`                             |

**Clinic Schedule** and **Visit Schedule** are the same operational
concept. Consent and screening-form completion live inside Clinic
Schedule mode for the Ancillary Care Specialist Workspace; readiness
comes from `case_document_readiness` and existing document endpoints.

## Canonical data sources

All workspace data must come from the canonical tables:

- `global_schedule_events`
- `patient_execution_cases`
- `patient_journey_events`
- `patient_screenings`
- `procedure_events`
- `case_document_readiness`

## What controls what is visible inside a workspace

- **Assigned facility / facilities** — physical scope.
- **Team member profile** — identity, contact.
- **Role / capability settings** — what actions they can take (future
  `admin_settings` entries; not implemented in this batch).
- **Calendar profile** — see `docs/calendar-architecture.md`. PCS uses
  `profileId="patientCareSpecialist"`; ACS uses `profileId="technician"`
  while internals consolidate. A dedicated `ancillaryCareSpecialist`
  profile may be added later.
- **Right-panel mode** — Clinic Schedule, Ancillary Schedule, or Call
  List (both workspaces; only the default differs).

## Patient Schedule Popup and Playground Expansion

The right-panel patient cards (both **Clinic Schedule** and **Ancillary
Schedule** modes) expose a patient-specific scheduling surface. This is
separate from the Plexus IQ calendar drawer — Plexus IQ remains the
clinic-day analytics surface; this surface is per-patient.

### Surfaces

- **`SchedulePatientDialog`** — compact popup opened by clicking the
  calendar icon on a right-panel patient card. Shows the schedule form
  on the left and the current-day context (Clinic Schedule, Ancillary
  Schedule, This patient, Availability / Blocks) on the right. A
  `Maximize2` extender in the header transitions the same context into
  the Playground.
- **`SchedulePatientPlayground`** — expanded scheduling view rendered
  inside the existing center Playground area when
  `centerMode === "playground"` and a playground context is set in
  `PortalShell`. Same data/write contracts as the dialog, larger
  layout.

### Data + write paths

Both surfaces share two helpers in
`client/src/lib/workflow/teamMemberWorkspaceApi.ts`:

- `fetchPatientScheduleDayContext({ facilityId, patientScreeningId,
  executionCaseId, selectedDate, limit })` — reads
  `/api/global-schedule-events` for the local day window and buckets
  events client-side into `clinicEvents` (`doctor_visit`,
  `same_day_add`), `ancillaryEvents` (`ancillary_appointment`),
  `availabilityBlocks` (`team_member_availability`, `unavailable_block`,
  `pto_block`, `sick_day`), `procedureCompleteEvents`
  (`procedure_complete`), and `patientEvents` (rows matching
  `patientScreeningId` or `executionCaseId`).
- `schedulePatientAncillary({ executionCaseId, patientScreeningId,
  serviceType, startsAt, endsAt, facilityId, assignedUserId, note,
  metadata })` — POSTs the canonical
  `/api/global-schedule-events/schedule-ancillary` route with
  `metadata.source = "schedule_patient_dialog"` or
  `"schedule_patient_playground"`. No new backend route.

### Gating

Both calendar-icon buttons (clinic + ancillary rows) are gated by the
profile capability `workspaceCanCallAndSchedule` and only render when
the Team Member Profile grants it. After a successful schedule write,
the surfaces invalidate `team-workspace-ancillary-schedule`,
`team-workspace-clinic-schedule`, `team-workspace-call-list`,
`/api/global-schedule-events`, `schedule-patient-day-context`, and
`schedule-patient-playground-context` so the right panel and Plexus IQ
both reflect the new event.

## Calendar behavior

Two calendars live inside `PortalShell` and use the canonical calendar
layer. Neither is bespoke; both reuse the same primitives Plexus IQ
uses, so calendar logic only lives in one place.

### Main canonical calendar (header `Calendar` button)

- A `CalendarIcon` button in the portal header opens
  `UniversalCalendarDrawer` — the same right-side drawer Plexus IQ
  uses for its month overview.
- The drawer's `profileId` is chosen by workspace role:
  - **Ancillary Care Specialist** → `technician` profile
    (procedure-side filters / scope).
  - **Patient Care Specialist** (and legacy roles) →
    `patientCareSpecialist` profile.
- Per-day cells are derived client-side from the workspace's already
  loaded `clinicSchedule` + `ancillarySchedule` events — no new
  backend route. The `CanonicalMonthCellSummary` shape matches what
  Plexus IQ feeds the drawer.
- Selecting a day in the drawer updates `selectedDate` and closes the
  drawer (no separate day-modal in the team portal — the right panel
  already shows the per-day list).
- Plexus IQ's drawer (`profileId="plexusIq"`) is untouched.

### Right-rail patient mini calendar (`PatientMiniCalendar`)

- Replaces the old `MonthlyMiniCalendar` in the left-rail Calendar
  card. The card now derives its header + CTA from the active
  scheduling patient:
  - No patient selected → header shows the facility + workspace mode;
    CTA is disabled (`Choose a patient`).
  - Patient selected → header shows `Scheduling: <name>`, DOB,
    facility, service type, and qualified-test chips (when available);
    CTA reads `Schedule <name>`.
- Clicking the calendar icon on a Clinic Schedule or Ancillary
  Schedule patient row sets the row's patient as the
  `selectedPatientForScheduling` context. The same icon also opens
  the existing `SchedulePatientDialog` for the immediate action, so
  the user never has to click twice.
- Selecting a date in the mini calendar updates `selectedDate` for
  that patient. Clicking `Schedule <name>` re-opens
  `SchedulePatientDialog` prefilled with patient + date — the dialog
  performs the canonical write through
  `POST /api/global-schedule-events/schedule-ancillary` and
  invalidates the team-workspace queries on success. The mini
  calendar itself never writes directly.
- Facility filtering: the month cells use the workspace's active
  facility, which is constrained by the user's Team Member Profile
  (`assignedFacilityIds`). PCS and ACS only see the facilities they
  are allowed to schedule into.

## Patient Command Center architecture

The Patient Care Specialist and Ancillary Care Specialist portals
share one architecture, one shell, and one canonical read model. The
portal UI is a **view over canonical tables**, not a separate source
of truth.

### Left-rail tools (above the Calendar card)

Four circular icons sit above the existing Calendar card in
`PortalShell`'s left rail. Each opens or focuses a tab in the
playground (multi-tab) center area:

| Icon | Tab kind | Data source |
| --- | --- | --- |
| **My Patients** (`Users`) | `myPatients` | `GET /api/portal/my-patients` — joins `patient_journey_events` / `outreach_calls` / `plexus_tasks` where actor = session user; newest-first |
| **Patient Search** (`Search`) | `patientSearch` | `GET /api/portal/patient-search?query=…` — name/dob/phone/insurance lookup, facility-scoped |
| **Plexus Tasks** (`ClipboardList`) | `plexusTasks` | `GET /api/plexus/tasks/by-patient/:id` when a patient is in focus; otherwise `/api/plexus/tasks/my-work` |
| **Marketing** (`Megaphone`) | `marketing` | `GET /api/outreach/materials` (Document Library `kind=marketing`) + `POST /api/email/send-material` for the send |

### Multi-tab playground

`PortalTabKind` is now: `patient`, `schedule`, `tasks`, `documents`,
`myPatients`, `patientSearch`, `plexusTasks`, `marketing`. Opening a
tab is **focus-or-add**:

- Re-opening the same patient (by `patientScreeningId`) focuses the
  existing tab — no duplicates.
- Re-opening the same tool focuses its existing tab.
- Multiple patient tabs can be open at the same time.
- Clicking a patient name from My Patients, Patient Search, or any
  history surface routes through `openPatientTabById(...)` so the
  command canvas always opens the canonical patient by id.

### Patient Command Canvas

`client/src/components/portal/PatientCommandCanvas.tsx` is the
shared canvas for any patient tab. It reads the canonical command
center endpoint and renders, top-to-bottom:

1. **Identity header** — name, DOB, age, gender, phone, insurance,
   facility, patient type, plus status pills for appointment /
   engagement / commit / lifecycle.
2. **Clinical Profile** — Dx, Hx/PMH, Rx, previous ancillaries,
   qualifying tests, notes. **Prominent on purpose**; this is never
   buried beneath communications.
3. **Latest activity** — last call, next appointment, last ancillary,
   last journey event. Text and email rows show empty-state messages
   referencing the pending `patient_communications` table (TODO).
4. **Full history folders** — All, Calls, Texts, Emails, Notes,
   Appointments, Ancillaries, Journey. Each opens an in-canvas
   history panel sourced from the matching canonical table.
5. **Action strip** — Schedule (opens `SchedulePatientDialog`),
   Plexus Tasks, Send Marketing, plus stubs for Call / Text / Email /
   Consent (queued for the canonical comms table).

### Canonical read model

`GET /api/portal/patient-command-center/:patientScreeningId` returns
one aggregated JSON document built from these canonical sources:

- `patient_screenings` (identity, clinical profile, status)
- `screening_batches` (facility / scheduleDate context)
- `patient_execution_cases` (engagement spine, lifecycle, bucket,
  qualification status)
- `patient_journey_events` (audit trail; up to 200 newest)
- `outreach_calls` (call history)
- `global_schedule_events` (appointments + blocks)
- `procedure_events` (ancillary completions + notes)
- `plexus_tasks` (task list)
- `patient_test_history` (previous ancillaries + cooldown source)
- `insurance_eligibility_reviews` (recent eligibility decisions)
- `documents` (patient-scoped, non-marketing)

Patient lookup respects soft-delete (`deletedAt IS NULL`) and
facility scope: a non-admin session can only read a patient whose
facility is among the user's `outreach_schedulers.facility`
assignments. `403` is returned otherwise.

### Communications + history caveat

There is no canonical `patient_communications` table yet. The
endpoint returns empty `texts` and `emails` arrays with a TODO. When
that table lands, it will become the canonical source for both
arrays and for the per-row send-marketing audit trail.

### No practice patient, no parallel systems

- Patient identity always anchors to `patient_screenings.id`. The
  legacy demo "Ali Boomaye" id range is the only exception, and it
  is gated separately — every other patient flows through
  `PatientCommandCanvas` → canonical endpoint.
- Plexus tasks read from `plexus_tasks`. Marketing reads from
  Document Library (`kind=marketing`). Schedules read/write through
  `global_schedule_events`. No table is duplicated.
- ACS and PCS share the same shell, the same tabs, the same canvas.
  Capability flags from the Team Member Profile decide what actions
  are enabled, not which shell renders.

## `patient_communications` canonical table

The unified read-model entry for every team-member touch on a patient
that isn't already captured elsewhere as a domain row.

Migration: `migrations/0024_add_patient_communications.sql`.

| Column | Purpose |
| --- | --- |
| `communication_type` | `call` / `sms` / `email` / `marketing_email` / `marketing_sms` / `internal_note` / `system_note` |
| `direction` | `outbound` / `inbound` / `internal` |
| `status` | `draft` / `queued` / `sent` / `delivered` / `failed` / `completed` / `logged` |
| `outcome`, `subject`, `summary`, `body_preview`, `body_full` | timeline copy |
| `to_address`, `from_address`, `phone_number` | channel-specific metadata |
| `actor_user_id`, `actor_name_snapshot` | who logged the touch |
| `related_document_ids`, `metadata` | document attachments + free-form structured data |
| `occurred_at`, `created_at` | when the touch happened vs when it was logged |

`outreach_calls` remains the system of record for outreach metrics —
the canonical call POST now mirrors a row into
`patient_communications` so the timeline is in one place without
having to join two tables. `email/send-material` writes a
`marketing_email` row on success. The Plexus IQ team-portal canvas
reads all rows through this table.

### Logging flows

- **Call** — `POST /api/outreach/calls` writes both `outreach_calls`
  and a `call` row in `patient_communications`. The canvas Call
  action also exposes a "Log Call" dialog that writes the
  `patient_communications` row directly via
  `POST /api/portal/patient-communications`.
- **Marketing send** — `POST /api/outreach/send-material` sends the
  email and appends a `marketing_email` row + journey event.
- **Manual log** — the canvas Call / Text / Email / Internal Note
  buttons open the shared `LogCommunicationDialog`. Text and Email
  are explicitly **log-only** (no SMS backend wired; the marketing
  tab is the canonical send path for actual emails).
- **Journey echo** — every successful canvas-side log also appends a
  `patient_journey_events` row tagged `communication_logged` so the
  Journey folder reflects the touch.

### Calendar popup + maximize

The right-rail `PatientMiniCalendar` and the per-patient calendar
icons on Clinic Schedule / Ancillary Schedule patient rows both open
`SchedulePatientDialog` prefilled with the patient + selected date.
The dialog has a Maximize2 control that closes itself and hands the
same context to `SchedulePatientPlayground` in the center area.
Scheduling on either surface writes through
`POST /api/global-schedule-events/schedule-ancillary` and invalidates
the team-workspace + Plexus IQ calendar queries.

### Real database QA

`npm run qa:team-portal-command-center` exercises the canonical
contract end-to-end against the DB layer (no live server required):

1. Picks the first active `patient_screening`.
2. Inserts a `patient_communications` row tagged `is_test=true`.
3. Lists by patient + verifies it appears.
4. Reads latest + asserts occurredAt is correct.
5. Filters by `communicationType` and verifies the filter holds.
6. Cleans up its test row.

The script skips with a clear message when `DATABASE_URL` is unset.

### Deferred

- Real SMS backend — the schema is ready (`sms` and `marketing_sms`
  types); the UI explicitly says "log-only" until a provider is
  wired.
- Backfilling historical `outreach_calls` into
  `patient_communications` is out of scope here; new calls mirror
  forward from this commit on.
