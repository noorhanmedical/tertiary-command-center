---
name: SchedulePatientDialog multi-test fan-out
description: How the quick-schedule popup books multiple ancillary tests through the single-test write path without duplicating stub cases.
---

The team-portal Quick Schedule popup (`SchedulePatientDialog`) books MULTIPLE
ancillary tests per confirm by fanning out one existing
`schedulePatientAncillary` call per selected test. The backend
schedule-ancillary contract still takes ONE service per request — do not add
an array param; fan out on the client.

**Rule:** run the fan-out SEQUENTIALLY and carry the resolved
`executionCase.id` forward from each response into the next booking.

**Why:** for a name-only walk-in (no screening/case id, and no DOB), the
server always creates a *fresh* execution-case stub — it only reuses a prior
stub when a DOB is present (name-alone matching is unsafe). Parallel or
non-carry-forward booking of several tests would therefore create a separate
duplicate stub case per test. Seeding `resolvedCaseId` from
`patient.executionCaseId ?? selectedMatch?.id` and updating it from
`resp.executionCase.id` after the first success makes tests 2..N attach to the
same case.

**How to apply:** any future "book several things at once" surface over this
route must reuse the sequential + carry-forward pattern. The server upsert is
idempotent per (patientScreeningId + serviceType + startsAt), so re-confirming
already-booked tests at the same date/time is safe.

Partial failures are surfaced per-test (BookingResult[]) — never silently drop
a failed booking; the dialog stays open on partial failure and closes only on
full success.
