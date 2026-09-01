# Call Workflow Model

> **Scope:** State on `main` (`88c0a1d`), derived from the approved
> audit + main-branch verification. All findings are on `main`.
> Phase 3 Exception Intelligence is not part of this surface.

## 1. Three vocabularies

The platform on `main` has **three** call-outcome vocabularies that
must be reconciled at each surface.

### 1.1 Outreach enum — 19 values

`OUTREACH_CALL_OUTCOMES` (`shared/schema/outreach.ts:28-34`):

```
reached, scheduled, callback, wants_more_info, will_think_about_it,
declined, not_interested, refused_dnc, language_barrier,
no_answer, voicemail, mailbox_full, busy, hung_up, disconnected,
wrong_number, moved, deceased
```

Persisted on `outreach_calls.outcome` for every call attempt.

### 1.2 Canonical CallResult — 15 values

`CALL_RESULT_OUTCOMES`
(`server/services/callResult/recordCallResult.ts:38-61`):

```
scheduled, callback, no_answer, voicemail, wrong_number, declined,
needs_records, insurance_prior_auth_issue, manager_review,
facility_specific_issue, completed, dnc, do_not_contact, deceased,
cancelled
```

Used by the canonical planner that owns side-effect orchestration.

### 1.3 Engagement-route accepted values

`CALL_RESULTS_NEEDING_TRIAGE`
(`server/routes/executionCases.ts:142-147`) — 15 outcomes including
extras beyond the canonical set: `reschedule`, `no_show`,
`needs_new_date`, `patient_requested_call_later`,
`transportation_issue`, `technician_unavailable`.

`CALL_RESULTS_NEEDING_TASK` (5 outcomes,
`server/routes/executionCases.ts:149-152`).

`TRIAGE_MAPPINGS` (16 entries → `mainType` / `subtype` /
`nextOwnerRole`, `server/routes/executionCases.ts:155-173`).

## 2. UI disposition labels

`client/src/components/outreach/DispositionSheet.tsx:117-135` exposes
the outreach-enum values to the operator. Mapping label → enum value →
group:

| Label | Value | Group |
| --- | --- | --- |
| Spoke with patient | `reached` | reached |
| Scheduled | `scheduled` | reached |
| Callback later | `callback` | reached |
| Wants more info | `wants_more_info` | reached |
| Will think about it | `will_think_about_it` | reached |
| Declined | `declined` | reached |
| Not interested | `not_interested` | reached |
| Refused (DNC) | `refused_dnc` | reached |
| Language barrier | `language_barrier` | reached |
| No answer | `no_answer` | missed |
| Voicemail | `voicemail` | missed |
| Mailbox full | `mailbox_full` | missed |
| Busy / call dropped | `busy` | missed |
| Hung up | `hung_up` | missed |
| Number disconnected | `disconnected` | missed |
| Wrong number | `wrong_number` | other |
| Patient moved | `moved` | other |
| Deceased | `deceased` | other |
| (canonical via separate selector) | `needs_records, insurance_prior_auth_issue, manager_review, facility_specific_issue, completed, dnc, do_not_contact, cancelled` | structured selector (flag-gated) |

The structured selector and dual-write behaviour are flag-gated
(`STRUCTURED_SELECTOR_ENABLED`,
`client/src/components/outreach/DispositionSheet.tsx:41-46`;
`LEGACY_DISPOSITION_WRITE_ENABLED`, lines 53-59).

## 3. Canonical planner — side-effect contract

`server/services/callResult/recordCallResult.ts:174-341` defines a pure
planner that maps a canonical outcome to a tuple of side effects.

| Outcome | appointmentStatus | engagementStatus | nextActionAt | assignment completed | task | triage | terminal |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scheduled` | scheduled | contacted | null | true | none | none | true |
| `callback` | callback | needs_followup | `callbackAt` (or `now + 4h`) | false | none | callback_scheduled | false |
| `no_answer` | no_answer | not_reached | `callbackAt` (or `now + 4h`) | false | none | no_answer | false |
| `voicemail` | no_answer | not_reached | `callbackAt` (or `now + 4h`) | false | none | voicemail | false |
| `wrong_number` | declined | needs_followup | null | false | none | wrong_number | false |
| `declined` | declined | contacted | null | true | none | none | true |
| `needs_records` | in_progress | in_progress | null | false | needs_records | none | false |
| `insurance_prior_auth_issue` | in_progress | in_progress | null | false | insurance_prior_auth_issue | none | false |
| `manager_review` | in_progress | needs_followup | null | false | manager_review | none | false |
| `facility_specific_issue` | in_progress | in_progress | null | false | facility_specific_issue | none | false |
| `completed` | scheduled | contacted | null | true | none | none | true |
| `dnc` / `do_not_contact` | declined | contacted | null | true | none | none | true |
| `deceased` | declined | contacted | null | true | none | none | true |
| `cancelled` | declined | contacted | null | true | none | none | true |

The planner export sits at
`server/services/callResult/recordCallResult.ts:365-412`. Two
flag-gated delegate executors wrap it:

- `recordCallResultOutreachExecutor.ts` — wraps `POST /api/outreach/calls`.
- `recordCallResultEngagementExecutor.ts` — wraps `POST /api/engagement-center/call-result`.

Both delegate flags default to **OFF** on `main`. The endpoint flag
(`engagementCanonicalCallResultsEndpointFlag.ts`) controls the new
endpoint shape. Until activation, both routes continue down the legacy
code paths described in §4.

## 4. Legacy code path — non-canonical outcomes

`server/routes/outreach.ts:77-99` defines `deriveAppointmentStatus`
which collapses the outreach-only outcomes into 5 appointment buckets:

- `reached`, `wants_more_info`, `will_think_about_it`,
  `language_barrier` → `callback`
- `not_interested`, `refused_dnc`, `moved` → `declined`
  (also `deceased` → `declined`; `wrong_number` → `declined`)
- `mailbox_full`, `busy`, `hung_up`, `disconnected` → `no_answer`
- Default → `pending`

For non-canonical outcomes the engagement-side journey-event / triage /
task side effects are **skipped** on the outreach route
(`OUTREACH_SUPPRESSED_STEPS` design,
`server/services/callResult/recordCallResultOutreachExecutor.ts`).

The Engagement-route handler (`server/routes/executionCases.ts:317-942`)
accepts a broader set (`reschedule`, `no_show`, `needs_new_date`,
`patient_requested_call_later`, `transportation_issue`,
`technician_unavailable`) but those only round-trip through triage
mappings — they do not enter the canonical planner. The canonical
preview parity does not cover them, so divergence is possible.

## 5. Side-effect coverage by outcome

| Property | Behaviour on main |
| --- | --- |
| `assignedTeamMemberId` preservation | Preserved across outcomes; only the engagement-board `cancel-many` flow clears it. |
| Re-enters queue | `callback` / `voicemail` / `no_answer` set `triageCaseRequired=true` and `nextActionAt` — the case reappears on the engagement call list when `nextActionAt <= now`. |
| Calendar event | **Only `scheduled` writes a `global_schedule_events` row** (via `createGlobalScheduleEventFromScreeningCommit` chain). `callback`, `no_show`, and cancellation outcomes do **not** create calendar entries on the global calendar; they live only on the execution case + triage row. |
| Journey event | Every canonical outcome appends a `patient_journey_events` row `eventType='call_result_logged'` **only when the route delegates to the canonical executor** (flag-gated). Non-canonical outcomes write to `outreach_calls` only — no journey event. |
| Audit log | `audit_log` updates are written by repository helpers per write path (uneven coverage). |

## 6. Observed bugs on main

These are all real on `main` today and reproduce in the audit
verification:

1. **`hung_up` / `disconnected` / `busy` / `mailbox_full` never generate
   a triage case or task.** They are stored on `outreach_calls.outcome`
   but only mutate `appointmentStatus` to `no_answer`. A hung-up call
   therefore appears as `no_answer` on every downstream surface.
2. **`reached` and `wants_more_info` collapse to `callback`
   appointmentStatus, but `callbackAt` is `optional().nullable()` in
   the schema** (`shared/schema/outreach.ts:55-64`). Result: patient
   marked "callback later" with no callback time set.
3. **Engagement-route outcomes** (`reschedule`, `no_show`,
   `needs_new_date`, `patient_requested_call_later`,
   `transportation_issue`, `technician_unavailable`) are **not in the
   canonical planner**. They round-trip through triage mappings only —
   canonical preview parity does not cover them.
4. **Callbacks are invisible on the global calendar.** A `callback`
   outcome sets `executionCase.nextActionAt` and inserts a
   `scheduling_triage_cases` row, but does not write a
   `global_schedule_events` row. Managers cannot see today's callback
   load on the calendar.
5. **`no_show` originating from a call outcome** opens a triage case
   but does not create a `global_schedule_events` row.
   `scheduleStatusService.ts` only mutates an existing event when the
   transition is calendar-originated (`scheduleStatusService.ts:118-124`).
6. **`nextActionAt` defaults to `now + 4h` when no `callbackAt` is
   supplied** (`server/services/callResult/recordCallResult.ts:421-426`).
   Silent magic value.

## 7. Where calls are stored

- `outreach_calls` (`shared/schema/outreach.ts:36-53`) — every call
  attempt. FK to `patient_screenings.id` (NOT NULL). Notes live on
  `outreach_calls.notes` text field — **not** in `patient_notes`.
- `patient_execution_cases.lastCallOutcome` (text, free-form) — last
  outcome rolled up onto the case.
- `scheduling_triage_cases` — when a call outcome opens triage.
- `plexus_tasks` — when an outcome opens a task.
- `patient_journey_events` — only when the canonical executor delegate
  is engaged (flag-gated).

Because `outreach_calls` and `patient_notes` are siloed by
`patient_screenings.id`, call context for the same physical person
across batches is fragmented. See
[PATIENT_DIRECTORY_SOURCE_OF_TRUTH.md](./PATIENT_DIRECTORY_SOURCE_OF_TRUTH.md).

## 8. Activation path

Reconciling the three vocabularies is the canonical-call-result
program already in flight. The remaining gates and the recommended
order are tracked in
[PLATFORM_HARDENING_BACKLOG.md](./PLATFORM_HARDENING_BACKLOG.md).
