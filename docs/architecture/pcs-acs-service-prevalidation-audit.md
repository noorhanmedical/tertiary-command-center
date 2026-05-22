# PCS / ACS — Service Prevalidation Audit

> **Scope:** Where the service type is chosen for a scheduling
> action, where `SchedulePatientDialog` is opened, and where the
> Team Member Profile's `allowedServiceTypes` should pre-validate
> the user's choice. Read-only inventory — no code changes here.

## Why prevalidation isn't in `SchedulePatientDialog`

`SchedulePatientDialog` is **patient-scoped**, not service-scoped.
It accepts a `SchedulePatientDialogPatient` (name, DOB, facility,
optional executionCaseId / patientScreeningId, optional
serviceType) and writes via
`POST /api/global-schedule-events/schedule-ancillary`. The
`serviceType` is already determined by the caller — by the time
the dialog opens, the service has been chosen. Prevalidation
belongs upstream where the call site decides what to schedule.

## Upstream call sites (PortalShell)

`openSchedulePatientDialog(...)` is called from five places in
`client/src/components/portal/PortalShell.tsx`:

| Line | Surface | How service is chosen |
| --- | --- | --- |
| 1769 | Header patient action menu (legacy patient list) | `serviceType: null` — server defaults to the patient's primary service |
| 2034 | Patient card (left-rail patient pick) | `serviceType: null` |
| 2271 | Right-panel `clinicSchedule` patient card | `serviceType: null` — caller picks via dialog defaults |
| 2437 | Right-panel `ancillarySchedule` row → schedule button | `serviceType: row.serviceType ?? null` — *this* is where a specific ancillary service is in scope |
| (PatientMiniCalendar) | left-rail mini calendar Schedule CTA via `onSchedulePatient` | uses the patient row's existing `serviceType` |

The only path where a *specific* service type is passed is the
`ancillarySchedule` row schedule button (line 2437). For every
other entry point, `serviceType` is null and the server resolves
it.

## Where `allowedServiceTypes` lives today

- Read into `PortalShell` from the resolved Team Member Profile
  (`workspaceProfile.allowedServiceTypes ?? []`).
- Already used to filter `workspaceAncillarySchedule` →
  `filteredAncillarySchedule` (PortalShell:1058-1066), so the
  ancillarySchedule list already hides rows the user isn't
  authorized to schedule.

That filter is *implicit* prevalidation — the rows whose service
type isn't in `allowedServiceTypes` simply don't render their
Schedule buttons, so the user can't click them. The empty state
copy at line 2378-2381 already calls this out.

## Server gate

The canonical final authority is server-side. Two layers:

1. `/api/global-schedule-events/schedule-ancillary` — the
   scheduling write rejects with HTTP 4xx when the actor's
   `allowedServiceTypes` doesn't include the requested service
   (per the team member profile resolution route).
2. `/api/admin-settings/effective?settingDomain=team_member&settingKey=workspace_profile`
   — read-only resolver that the client uses to populate
   `allowedServiceTypes`; the same value is consulted server-side
   on every write.

## Where to add client-side prevalidation (if needed)

Only meaningful at line 2437 (the ancillary-row schedule button):

- Wrap the button in a disabled state when
  `allowedServiceTypes.length > 0` and
  `!allowedServiceTypes.includes(row.serviceType)`.
- Tooltip: "Your profile doesn't include this service type — ask
  an admin if you need access."

This would be a safe one-line addition to PortalShell:2431-2451.
But because `filteredAncillarySchedule` already removes those
rows before render, the prevalidation has no user-visible effect
unless the ancillary filtering logic stops being authoritative.

## Recommendation

**Defer the client-side prevalidation work.** The implicit filter
on `filteredAncillarySchedule` already prevents the schedule
button from appearing for disallowed services. Other entry points
pass `serviceType: null` and rely on the server gate.

If a future surface lands where a specific service can be picked
at the dialog (e.g. a service-type dropdown inside
`SchedulePatientDialog`), the prevalidation should be added there
— against the resolved `allowedServiceTypes` from
`workspaceProfile`, with the disabled-option pattern shown above.

## Cross-references

- `client/src/components/portal/SchedulePatientDialog.tsx` —
  patient-scoped dialog (no service picker today).
- `client/src/components/portal/PortalShell.tsx:1058-1066` —
  `filteredAncillarySchedule` memo that already enforces
  `allowedServiceTypes`.
- `client/src/lib/portal/portalCapabilities.ts` — capability
  resolver (different concern from service-type allow-list).
- `shared/teamMemberProfile.ts:55` — `allowedServiceTypes`
  field on the profile.
