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
`procedure_complete` GSE mirror in sync. Create on complete (`markProcedureComplete`
-> `upsertProcedureCompleteEvent`); remove when a procedure leaves the complete
state. The un-complete path is now wired: `updateProcedureEvent` calls
`clearProcedureCompleteEvent(id)` (deletes mirror rows deduped by
`metadata.procedureEventId`) whenever it sets `procedureStatus` to anything other
than "complete". Note: no route currently exposes a status change away from
complete, so the clear only fires through the generic repo update path.
Production still needs one-time backfills: for procedures completed before the
mirror existed (missing ✓) and for procedures reopened before the clear existed
(stale ✓).
