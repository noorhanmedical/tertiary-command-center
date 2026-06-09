# Visit-schedule source map (Batch 11a)

**Branch:** `architecture/batch-11a-operational-queue-foundation`
**Date:** 2026-06-09
**Scope:** READ-ONLY inventory.
**Purpose:** Identify every place that reads, computes, or renders today's visit schedule.

> Cross-reference: `call-list-source-map.md`, `scheduler-task-source-map.md`, `global-calendar-source-map.md`, `operational-queue-design.md`, `protected-flows.md` §8.

---

## 0. What "visit schedule" means

A visit schedule is the per-patient list of appointments at a clinic for a given date — what the front desk + clinical staff + technicians see for "who is here today and when". It is **per-facility**, **per-date**, and **per-patient** (with sub-grouping by appointment time + ancillary type).

This is distinct from:
- the **call list** (covered separately) — outreach work by scheduler.
- the **global calendar** (covered separately) — multi-facility, multi-date executive view.

---

## 1. Canonical endpoint surface

| Endpoint | File | Role |
| --- | --- | --- |
| `GET /api/portal/today-schedule` | `server/routes/portal.ts:131` | Today's clinic schedule for a facility. Grouped by patient. Includes consent-status per test. Authenticated via `requirePortalRole`. |
| `GET /api/portal/month-summary` | `portal.ts:247` | Per-day aggregate counts for a month. |
| `GET /api/technician-liaison/clinic-visits` | `server/routes/globalSchedule.ts:79` | Technician-liaison's view of clinic visits for a date. |
| `GET /api/technician-liaison/ancillary-schedule` | `globalSchedule.ts:103` | Ancillary procedures schedule for a technician. |
| `GET /api/ultrasound-tech/schedule` | `globalSchedule.ts:158` | Ultrasound technician's schedule. |
| `GET /api/screening-batches` | `server/routes/batches.ts:473` | Screening batches list (each batch is a per-`(facility, date)` group of patient screenings). |

**Backing tables:**

- `ancillary_appointments` (`shared/schema/appointments.ts`) — one row per `(patient, test, scheduledDate, scheduledTime)`. Status field tracks per-appointment lifecycle.
- `global_schedule_events` (`shared/schema/globalSchedule.ts`) — broader events (visit, ancillary, etc.). Source of truth for the global calendar.
- `screening_batches` (`shared/schema/screening.ts`) — per-`(facility, scheduleDate)` grouping of patient screenings.

---

## 2. Read joins (today-schedule endpoint)

The `today-schedule` endpoint joins:

1. `ancillary_appointments` (filter on `scheduledDate = date` + optional `facility`).
2. Groups by `patientScreeningId` to one row per patient.
3. Joins `patient_screenings` for demographics.
4. Joins `documents` for consent-document presence per ancillary test (consent-by-test).
5. Joins `screening_batches` for batch context (clinician name, batch id).

**Per-patient response shape** (see `portal.ts:147–168`):

```ts
type PatientRow = {
  patientScreeningId: number | null;
  name: string;
  dob: string | null;
  time: string | null;
  facility: string;
  clinicianName: string | null;
  qualifyingTests: string[];
  appointmentStatus: string;
  consentByTest: Array<{ testType: string; signed: boolean; documentId: number | null }>;
  consentSigned: boolean;
  appointments: Array<{ id: number; testType: string; scheduledTime: string; status: string }>;
  batchId: number | null;
};
```

---

## 3. Behavioral invariants (do not regress)

1. **The schedule is per-facility AND per-date.** A request without facility returns multi-facility rows (unusual but supported).
2. **Consent-by-test** uses `documents` rows matched on `(patientScreeningId, kind = "consent_<testType>")`. Missing consent surfaces as `signed: false`.
3. **`appointmentStatus`** mirrors `patient_screenings.appointmentStatus` (the patient-level status), NOT `ancillary_appointments.status` (the per-appointment status). The per-appointment statuses are surfaced under `appointments[]`.
4. **Time is text.** `ancillary_appointments.scheduledTime` is `text` (HH:MM). Don't treat it as a `time` type.
5. **`requirePortalRole` middleware** gates the read. Facility allow-listing via `allowedFacilities(req)` is applied — a portal user can only see facilities their session is allow-listed for.

---

## 4. Compute pipeline (write path)

Appointments arrive via:

| File | Role |
| --- | --- |
| `POST /api/global-schedule-events/schedule-ancillary` | `server/routes/globalSchedule.ts:190` | Schedule an ancillary procedure. Writes `global_schedule_events` AND `ancillary_appointments`. |
| `POST /api/engagement-center/call-result` (when result schedules) | `server/routes/executionCases.ts:174` | Calls can produce a scheduling action that creates an appointment via the scheduling-triage path. |
| Manual entry via UI (Plexus IQ workspace, team-ops, etc.) | calls `POST /api/global-schedule-events/schedule-ancillary` | — |

**No automated cron writes the visit schedule.** Every `ancillary_appointments` row originates from an explicit operator action.

---

## 5. Client consumers

| File | Role |
| --- | --- |
| `client/src/components/portal/PortalShell.tsx` (Patient Care + Ancillary Care portals) | "Today's Schedule" tab. Calls `/api/portal/today-schedule`. |
| `client/src/components/portal/TeamPortalShell.tsx` | Same data; team-portal layout. |
| `client/src/pages/team-ops.tsx` | Team-ops view; calls `/api/appointments?facility=...`. |
| `client/src/components/AppointmentModal.tsx` | Per-patient appointment modal. |
| `client/src/lib/workflow/teamMemberWorkspaceApi.ts` | Workflow helpers used by team-portal schedule views. |
| `client/src/lib/portal/scheduleInvalidations.ts:68` | Query-key invalidation for `["/api/portal/today-schedule"]`. |

---

## 6. Status fields surfaced to the operator

| Field | Source | Notes |
| --- | --- | --- |
| Patient name | `patient_screenings.name` | — |
| DOB | `patient_screenings.dob` | — |
| Facility | route query param (echoed) | — |
| Time | `patient_screenings.time` (clinic visit time) | text |
| Clinician name | `screening_batches.clinicianName` | per-batch |
| Qualifying tests | `patient_screenings.qualifyingTests` | array |
| Appointment status (patient-level) | `patient_screenings.appointmentStatus` | aggregate of below |
| Per-appointment status | `ancillary_appointments.status` | one row per `(patient, test, time)` |
| Consent by test | `documents.kind LIKE "consent_%"` | — |
| Batch id | `ancillary_appointments.batchId` (joined) | — |

---

## 7. Cross-source overlaps

- A patient on today's visit schedule may ALSO be on a scheduler's call list (rare — they'd be calling someone who is already in clinic). The unified queue treats these as separate `OperationalQueueItem` kinds.
- A patient on today's visit schedule contributes a `visit_appointment` `OperationalQueueItem` per appointment row (one queue item per ancillary, not per patient).
- The patient packet endpoint (`/api/patient-packet`) is the canonical data source for the patient-detail view inside the schedule — the schedule itself does NOT carry the full packet shape.

---

## 8. What this map does NOT cover

- Per-ancillary capacity rules (technician scheduling).
- Consent template management — covered by `/api/portal/consent-templates` (`portal.ts:561`).
- Sign-consent flow (`POST /api/portal/sign-consent`) — write path.
- The shared-schedule public-PIN-gated page (`/schedule/:id`) — distinct rendering surface.

End of source map.
