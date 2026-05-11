# Team Member Portals Architecture

There are **two — and only two — team-member portals**:

1. **Patient Care Specialist Portal**
2. **Ancillary Care Specialist Portal**

## Naming

- **Scheduler Portal** is the legacy user-facing name for **Patient Care
  Specialist Portal**. New screens and copy must use the new name.
- **Technician Portal** and **Liaison / Liaison Technician Portal** are
  consolidated into **Ancillary Care Specialist Portal**.
- **Liaison is not a separate portal.** Liaison capabilities live inside
  the Ancillary Care Specialist Portal.
- There is no other team-member portal.

## Routes

| Canonical route                          | Legacy redirects                                                  |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `/team-member-portals`                   | (new landing page — pick your portal)                             |
| `/patient-care-specialist-portal`        | `/scheduler-portal`, `/outreach-center`, `/outreach`              |
| `/ancillary-care-specialist-portal`      | `/technician-portal`, `/liaison-technician-portal`, `/liaison-portal` |

Legacy routes remain wired so deep-links, bookmarks, and existing code that
hands users URLs continue to work — they just `<Redirect>` to the
canonical path.

## Implementation (foundation batch)

This batch creates the two canonical pages as **thin wrappers** so existing
data flows stay intact while future batches reshape internals.

- `client/src/pages/patient-care-specialist-portal.tsx` → renders the
  existing `OutreachPage`.
- `client/src/pages/ancillary-care-specialist-portal.tsx` → renders
  `<ClinicWorkflowPortal role="technician" />`.
- `client/src/pages/team-member-portals.tsx` → premium two-card chooser.

The legacy page files (`scheduler-portal`-equivalent `outreach.tsx`,
`technician-portal.tsx`, `liaison-portal.tsx`) remain on disk for
compatibility. They are no longer imported in `App.tsx` once the redirects
are in place.

## Future right-panel modes (Ancillary Care Specialist)

The Ancillary Care Specialist Portal will eventually expose three
right-panel modes:

1. **Clinic Schedule** *(same operational concept as **Visit Schedule**)*
2. **Ancillary Schedule**
3. **Call List**

Informed consent and screening form completion live inside the
**Clinic Schedule / Visit Schedule** mode.

These modes are not implemented in this foundation batch.

## Data sources

All portal data must come from the **canonical** backend tables. Portals
never own their own schedule state.

- `global_schedule_events`
- `patient_execution_cases`
- `patient_journey_events`
- `patient_screenings`
- `procedure_events`
- `case_document_readiness`

## What controls what is visible inside a portal

Visibility and content for a given team member are driven by:

- **Assigned facility / facilities** — physical scope.
- **Team member profile** — who they are, identity, contact.
- **Role / capability settings** — what actions they can take
  (`admin_settings` with `settingDomain="role_capabilities"` is the target
  surface; not implemented in this batch).
- **Calendar profile** — which canonical calendar profile they see (see
  `docs/calendar-architecture.md`). Patient Care Specialist uses
  `profileId="patientCareSpecialist"`; Ancillary Care Specialist uses
  `profileId="technician"` while internals consolidate.
- **Right-panel mode** — Clinic Schedule, Ancillary Schedule, or Call List
  (Ancillary Care Specialist only).

## Migration plan (future batches)

This batch is the **naming + routing foundation**. Subsequent batches will:

1. Migrate the Patient Care Specialist Portal's calendar drawer to the
   canonical primitive layer (`UniversalCalendarDrawer
   profileId="patientCareSpecialist"`).
2. Migrate the Ancillary Care Specialist Portal's calendar surfaces to
   `UniversalCalendarDrawer profileId="technician"` (or split out an
   `ancillaryCareSpecialist` profile if needed).
3. Build the three right-panel modes on top of canonical data.
4. Retire the legacy page files once nothing imports them.
