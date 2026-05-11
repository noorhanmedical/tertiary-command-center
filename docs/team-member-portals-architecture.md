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
