# Global-calendar source map (Batch 11a)

**Branch:** `architecture/batch-11a-operational-queue-foundation`
**Date:** 2026-06-09
**Scope:** READ-ONLY inventory.
**Purpose:** Identify every place that reads, computes, or renders the global (multi-facility, multi-date) calendar.

> Cross-reference: `call-list-source-map.md`, `scheduler-task-source-map.md`, `visit-schedule-source-map.md`, `operational-queue-design.md`, `protected-flows.md` §1.

---

## 0. What "global calendar" means

The global calendar is the multi-facility, multi-date executive view of upcoming clinic activity. It shows: scheduled clinic visits, ancillary procedures, batch loads per day per facility, and broad availability blocks. Read by Plexus IQ workspace (calendar tab), team-ops dashboards, and the home page snapshot.

This is distinct from the per-day **visit schedule** (covered separately): the visit schedule is one facility, one date, fully expanded; the global calendar aggregates across facilities and dates.

---

## 1. Canonical endpoint surface

| Endpoint | File | Role |
| --- | --- | --- |
| `GET /api/global-schedule-events` | `server/routes/globalSchedule.ts:42` | Returns all schedule events for a date range (visit + ancillary + availability block). Optional filters: facility, kind, date range. |
| `GET /api/global-schedule-events/:id` | `globalSchedule.ts:311` | Read one event. |
| `GET /api/global-schedule/team-availability-blocks` | `globalSchedule.ts:129` | Per-team-member availability for a facility/date range. |
| `GET /api/screening-batches/calendar-summary` | `server/routes/batches.ts:487` | Per-`(facility, scheduleDate)` patient counts. Used by the Plexus IQ calendar to highlight populated days. |
| `GET /api/screening-batches` | `batches.ts:473` | Full batch list. |
| `GET /api/appointments?facility=...` | (proxied through batches/global-schedule reads in some clients) | Per-facility filtered view of `ancillary_appointments`. |

**Backing tables:**

- `global_schedule_events` (`shared/schema/globalSchedule.ts:52`) — primary source. Kinds: visit, ancillary, availability_block, etc.
- `ancillary_appointments` (`shared/schema/appointments.ts`) — denormalized per-ancillary events that mirror corresponding `global_schedule_events`.
- `screening_batches` (`shared/schema/screening.ts`) — per-`(facility, scheduleDate)` patient groupings.

---

## 2. Behavioral invariants (do not regress)

1. **`global_schedule_events.kind` is the discriminator.** Observed kinds: `"clinic_visit" | "ancillary" | "team_availability" | "blocked"`. Each carries different metadata fields.
2. **`ancillary_appointments` is a denormalized projection of ancillary `global_schedule_events`.** A write to one MUST be mirrored to the other (handled by `POST /api/global-schedule-events/schedule-ancillary` at `globalSchedule.ts:190`). The future read model unifies these via the `kind` discriminator.
3. **Calendar-summary aggregates** `(facility, scheduleDate)` patient counts. Used by Plexus IQ to color-code populated days. Not authoritative for individual patient lists.
4. **No automatic event creation.** Every event originates from an explicit operator action.
5. **Facility filter is text equality.** Until Batch 6 ships the facility canonicalization, callers must pass the exact canonical string.

---

## 3. Compute pipeline (write path)

| Endpoint | File | Role |
| --- | --- | --- |
| `POST /api/global-schedule-events/schedule-ancillary` | `globalSchedule.ts:190` | The canonical write for an ancillary procedure. Writes both `global_schedule_events` AND `ancillary_appointments`. Audit-logged. |
| Manual visit scheduling | (no dedicated endpoint today; visits are typically created via batch creation + per-patient time set) | — |
| `morningRebuildScheduler.ts` | Reads global schedule for the day to build call lists — does NOT write global events. |

---

## 4. Client consumers

| File | Role |
| --- | --- |
| `client/src/components/plexus-iq/PlexusIQCalendar.tsx` | Plexus IQ calendar tab — the primary global-calendar surface. |
| `client/src/components/plexus-iq/PlexusIQWorkspace.tsx` | Wraps the calendar; calls `/api/screening-batches/calendar-summary` for day-population indicators. |
| `client/src/components/HomeDashboard.tsx` | Home page snapshot. Calls `/api/global-schedule-events` for "today + upcoming N days". |
| `client/src/pages/team-ops.tsx` | Multi-facility team-ops view. |
| `client/src/lib/calendar/*` (various) | Calendar view-model helpers. |
| `client/src/lib/portal/scheduleInvalidations.ts` | Invalidates the global-schedule query keys when relevant writes happen. |

---

## 5. Status fields surfaced to the operator

| Field | Source |
| --- | --- |
| Event kind | `global_schedule_events.kind` |
| Facility | `global_schedule_events.facilityId` |
| Schedule date | `global_schedule_events.scheduledDate` |
| Schedule time | `global_schedule_events.scheduledTime` |
| Patient name (when kind = ancillary or clinic_visit) | Joined from `patient_screenings` |
| Patient DOB | Joined from `patient_screenings` |
| Test type (when kind = ancillary) | `global_schedule_events.testType` |
| Status | `global_schedule_events.status` (free text) |
| Team member (when kind = team_availability) | Joined from `users` / `outreach_schedulers` |
| Batch id | `global_schedule_events.batchId` |

---

## 6. Cross-source overlaps

- Every ancillary `global_schedule_events` row has a corresponding `ancillary_appointments` row. The future read model treats the `global_schedule_events` row as authoritative and uses `ancillary_appointments` only for per-appointment status / consent state.
- A clinic visit on the global calendar IS the same event as a "Today's Schedule" row when filtered to one facility + one date. The unified queue treats them as one `OperationalQueueItem` of kind `global_calendar_event` — and the visit-schedule view (`/api/portal/today-schedule`) presents the same rows in a different shape for the day-of clinical use case.
- A scheduler assignment (call list) does NOT show on the global calendar — calls are not visits.

---

## 7. What this map does NOT cover

- Per-event editing (update / cancel) — out of scope for a read-model design.
- Recurring events — none in the current data model.
- Time-zone handling — `globalSchedule.ts` operates in the facility's local time; the future Batch 6 `facilities.timezone` column will make this explicit.

End of source map.
