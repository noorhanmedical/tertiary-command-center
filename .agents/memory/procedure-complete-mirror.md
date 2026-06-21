---
name: procedure_complete schedule-event mirror
description: Why completed procedures live in two tables and how the calendar ✓ badge is fed
---

Procedure completion is recorded in `procedure_events` (procedureStatus='complete',
completedAt). Calendar surfaces (Home, Plexus IQ, portal mini-calendars) badge a
day with a ✓ by querying `global_schedule_events` filtered by
`eventType='procedure_complete'` (see `buildCommandCalendarCells`, reads
`evt.startsAt`). These are two separate tables.

**Rule:** marking a procedure complete must ALSO upsert a `procedure_complete`
row into `global_schedule_events` (via `upsertProcedureCompleteEvent`, deduped by
`metadata.procedureEventId`). Without that mirror row the ✓ never shows even
though the procedure is complete.

**Why:** the original feature queried `eventType='procedure_complete'` but no code
ever wrote such rows — only `procedure_events` was written and the linked schedule
event just had its status flipped. The badge was silently dead until the mirror
was wired into `markProcedureComplete`.

**How to apply:** any new completion/un-completion path must keep the
`procedure_complete` GSE mirror in sync (create on complete; remove/restatus when
a procedure leaves the complete state — currently NOT handled, see follow-up).
Production needs a one-time backfill for procedures completed before the mirror
existed.
