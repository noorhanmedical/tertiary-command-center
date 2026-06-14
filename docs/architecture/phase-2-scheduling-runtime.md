# Phase 2 — Scheduling runtime hardening (PR 2.4)

## Goal

Make every schedule transition (cancel / reschedule / no-show /
confirm) go through one canonical writer + emit one canonical
journey event. No local-only events, no fake reschedule.

## Canonical writer

`server/services/scheduling/scheduleStatusService.ts`:

```
applyScheduleTransition({ eventId, transition, actorUserId,
                          newStartsAt?, newEndsAt?, note? })
```

For each transition:

| Transition | global_schedule_events.status | execution case engagementStatus | journey event type |
|---|---|---|---|
| `cancel` | `cancelled` | `scheduling_needed` | `schedule_cancelled` |
| `reschedule` | `rescheduled` (+ new startsAt/endsAt) | `scheduled` (+ nextActionAt = new startsAt) | `schedule_rescheduled` |
| `no_show` | `no_show` | `needs_followup` | `schedule_no_show` |
| `confirm` | `confirmed` | unchanged | `schedule_confirmed` |

## Allowed transitions per current status

| From → | cancel | reschedule | no_show | confirm |
|---|---|---|---|---|
| `scheduled` | ✓ | ✓ | ✓ | ✓ |
| `confirmed` | ✓ | ✓ | ✓ | — |
| `rescheduled` | ✓ | ✓ | ✓ | ✓ |
| any other (cancelled, no_show, completed) | rejected with 409 | rejected | rejected | rejected |

The route returns 409 Conflict when the requested transition is not
allowed from the current status. No silent fallthrough.

## Route

`POST /api/global-schedule-events/:id/transition`

Body: `{ transition, newStartsAt?, newEndsAt?, note? }`

The route uses the existing facility-scope contract (the underlying
event already carries facilityId from the schedule-ancillary write).
PR 2.4 does NOT loosen the scope check; future audit can tighten by
re-validating facility on the transition endpoint specifically.

## Client

`postScheduleTransitionAndInvalidate` wraps `postScheduleTransition`
with the existing `invalidateTeamPortalScheduleQueries` helper so
the Team Portal right panel reflects the new state immediately.

## No local-only events

The `qa-phase-2-no-local-only-schedule-events.mjs` script
asserts:

- The transition endpoint is the only path that mutates
  `global_schedule_events.status`.
- No client component sets a fake "Cancelled" / "No-show" /
  "Rescheduled" state on a local row without round-tripping through
  the API.
- The journey-event types list (`PATIENT_JOURNEY_EVENT_TYPES`)
  carries the four new transition types so audits can find them.
