---
name: Appointment time parsing
description: Patient appointment times are raw display strings; never sort them with new Date()
---

Patient appointment times are stored as raw display strings ("9:00 AM", "13:30", "0900", sometimes ISO datetimes) — `new Date("9:00 AM")` is NaN, so any Date-based sort silently degrades to insertion/alphabetical order with no error.

**Why:** This silently broke appointment-time ordering in the run-ordering helper and PDF flows for months; tests only used ISO datetimes so the bug never surfaced.

**How to apply:** Always sort/compare times via `parseAppointmentTimeMinutes` in `client/src/lib/qualificationRunOrdering.ts` (returns minutes-since-midnight or null; ISO datetimes normalized to local time-of-day). Untimed patients sort last. When adding tests around time ordering, include raw AM/PM strings, not just ISO datetimes.
