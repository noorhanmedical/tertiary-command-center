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
existing right-panel body. Canonical data hydration per mode is still a
future batch; until then the existing right-panel content remains
visible below the tabs regardless of selected mode.

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
