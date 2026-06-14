# Phase 2 hardening — Call attempt runtime (item 1)

## Goal

Move the `call_attempt_count` / `unable_to_reach` story from
advisory (computed but not applied) into canonical state on
`patient_execution_cases`.

## Schema (migration `0032_phase2_call_attempt_hardening.sql`)

New columns on `patient_execution_cases`:

- `call_attempt_count` integer NOT NULL DEFAULT 0
- `last_attempt_at` timestamp NULL
- `last_call_outcome` text NULL
- `unable_to_reach_at` timestamp NULL

Indexes on `call_attempt_count` + `unable_to_reach_at`.

`ENGAGEMENT_STATUSES` extends with `unable_to_reach`. The column
remains `text` so the value is accepted without an enum migration.

## Service

`server/services/callResult/callAttemptRuntime.ts`:

- `ATTEMPT_INCREMENTING_OUTCOMES` = `voicemail`, `no_answer`,
  `wrong_number`, `callback`.
- `ATTEMPT_RESETTING_OUTCOMES` = `scheduled`, `completed`,
  `declined`, `dnc`, `do_not_contact`, `deceased`, `cancelled`.
- `planCallAttempt({ currentAttemptCount, outcome, maxCallAttempts })`
  returns:
  - `newAttemptCount`
  - `countedAsAttempt`
  - `updateLastAttempt`
  - `transitionToUnableToReach` (true when `countedAsAttempt` AND
    new count >= maxCallAttempts)
  - `maxCallAttempts` (echoed for audit)

`callback` counts as an attempt because the operator did dial; if
the patient asks for a callback, the dialing campaign is still
active. `scheduled` / `completed` / `declined` / `dnc` reset the
counter back to 0 because the dialing campaign is closed.

## Route wiring

`server/routes/executionCases.ts` legacy path:

- Reads `executionCase.callAttemptCount` (defaults to 0 for legacy
  rows).
- Calls `planCallAttempt(...)` with the effective bundle's
  `maxCallAttempts`.
- Writes the new count, `last_call_outcome`, and (when applicable)
  `last_attempt_at` + `unable_to_reach_at` + `engagement_status =
  unable_to_reach`.
- The plan is appended to the journey-event metadata under
  `call_attempt` with previous + new count + `counted_as_attempt`
  + `transitioned_to_unable_to_reach` + `max_call_attempts`.

The actor identity from `resolveCallResultAuditIdentity` is still
recorded as `actor_user_id` (real session) + `view_as_user_id`
(impersonated). Attempt counting does not change that contract.

## QA contract

- `qa-phase-2-hardening-call-attempt-runtime.mjs` pins the new
  columns + service + route wiring.
- `smoke-phase-2-hardening-call-attempt-runtime.mjs` runs the pure
  planner against fixtures (LVM → count up; scheduled → reset; max
  reached → unable_to_reach).
- `probe:phase2-call-attempt` checks the live DB column shape.

## Honest scope (still pending)

- The engagement-delegation flag-on path does NOT yet write the
  attempt fields directly — it goes through
  `recordCallResultExecutionAdapter` whose injected
  `updateExecutionCaseEngagement` dep does not yet know about the
  attempt plan. The legacy path (most production traffic today)
  applies the plan. A future PR can extend the adapter args once
  the engagement-delegation flag is the default.
