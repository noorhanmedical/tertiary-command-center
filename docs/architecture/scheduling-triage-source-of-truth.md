# Scheduling Triage — Source of Truth

> **Scope:** Canonical home for callbacks, reschedules, no-shows,
> cancellations, manager review, and the other operational
> follow-up states that span outreach + scheduling. Read-only
> reference — no code changes here.

## Canonical table

`shared/schema/schedulingTriage.ts` → `scheduling_triage_cases`.

### Main types (`SCHEDULING_TRIAGE_MAIN_TYPES`)

`new_patient` · `returning_patient` · `same_day_add` ·
`reschedule` · `cancellation` · `no_show_follow_up` ·
`insurance_verification` · `authorization_pending` ·
`facility_transfer` · `outreach_callback`

Plus the canonical `callback` shorthand inferred at the
write-site mapping in `server/routes/executionCases.ts:65-93`
(maps `callResult: "callback"` → `mainType: "outreach_callback"`).

### Statuses (`SCHEDULING_TRIAGE_STATUSES`)

`open` · `in_progress` · `pending_patient` · `pending_insurance` ·
`pending_facility` · `resolved` · `closed` · `escalated`

### Priorities

`low` · `normal` · `high` · `urgent`

## Read paths

| Surface | Endpoint | Client helper |
| --- | --- | --- |
| List | `GET /api/scheduling-triage-cases` | `fetchSchedulingTriageCases(filters)` in `client/src/lib/workflow/schedulingTriageApi.ts` |
| One | `GET /api/scheduling-triage-cases/:id` | `fetchSchedulingTriageCaseById(id)` |

Both gated by the standard portal auth wall. Filters supported:
`executionCaseId`, `patientScreeningId`, `globalScheduleEventId`,
`facilityId`, `mainType`, `subtype`, `status`, `assignedUserId`,
`nextOwnerRole`, `limit`.

## Write paths (where triage rows come from)

There are **three** canonical write paths today. None of them is
a free-standing "create triage" endpoint — triage rows are
side-effects of higher-level operational writes.

1. **Engagement Center call-result**
   `POST /api/engagement-center/call-result`
   (`server/routes/executionCases.ts`). When `callResult` is
   `callback`, `patient_requested_call_later`, `no_answer`,
   `voicemail`, `wrong_number`, `needs_records`,
   `manager_review`, etc., the route appends a triage row with
   `mainType`/`subtype` mapped at lines 65-93 and an
   `nextActionAt` on `outreach_callback`.
2. **Appointment cancel / no-show**
   `POST /api/appointments/:id/cancel` (and the no-show path).
   Inserts a triage row with `mainType: "cancellation"` or
   `mainType: "no_show_follow_up"` per the appointment status
   change.
3. **Global schedule reschedule**
   `POST /api/global-schedule-events/:id/reschedule` (where
   present). Inserts `mainType: "reschedule"` triage rows
   keyed on the original event.

Each path also:
- updates `patient_execution_cases.engagementStatus` /
  `lifecycleStatus` to reflect the new operational state
- appends a `patient_journey_events` row (`eventType:
  "call_result_logged"`, `"appointment_cancelled"`, etc.)
- updates `outreach_calls` when a call result is logged
- writes a `patient_communications` row when the trigger was an
  outbound contact attempt

So triage rows are joined audit + worklist artifacts. They are
not the source of *what happened* — they are the canonical
work-to-do that follows.

## UI surfaces

| Page | Reads | Notes |
| --- | --- | --- |
| Engagement Center scheduler portal | `/api/scheduler-portal/cases` (joined view) | Primary triage queue |
| ACS / PCS portal call-list mode | `workspaceCallList` from `/api/portal/...` | Pulls actionable callbacks |
| Outreach scheduler portal | dispositions surface | Logs new call results that *create* triage rows |
| Manager review queue | filter on `mainType=manager_review` (subtype) | Read-only escalation surface |

## Manager review surface

Manager review is a *subtype*, not a separate `mainType` —
specifically `(mainType: "outreach_callback", subtype:
"manager_review_requested")` per the call-result mapping. The
manager review queue filters the canonical triage list by that
subtype. There is no separate `manager_review` mainType, and
adding one would split the existing audit chain.

## Journey-event coverage

Every triage write site already appends a `patient_journey_events`
row tagged with the matching `eventType`:

- `call_result_logged` (engagement-center call-result path)
- `appointment_cancelled` / `appointment_no_show` (appointments)
- `scheduling_rescheduled` (global-schedule reschedule path)

These are read by `PatientJourneyDrawer` + portal command center
without further joins.

## Audit-log coverage

The triage write sites are partially in `audit_log` (see
`docs/architecture/audit-log-coverage.md`):

- Engagement Center call-result writes `audit_log` only when the
  caller is an explicit logAudit site; the current handler does
  NOT call `logAudit`. Gap.
- Appointment cancel writes `audit_log` already (`appointments.ts`
  per the audit-log audit doc).
- Global schedule reschedule audit varies by endpoint.

Closing the `call-result` audit-log gap is in
`audit-log-coverage.md` gap #3.

## Recommended next batches (out of scope for this audit)

1. Add `logAudit(req, "create", "scheduling_triage_case", id, ...)`
   inside the engagement-center call-result handler.
2. Surface the manager-review subtype filter as a first-class
   queue tab in the scheduler portal.
3. Add a `qa:scheduling-triage` script that enumerates the
   canonical mainType + status enums and asserts the helper
   filters resolve them.

## Cross-references

- `shared/schema/schedulingTriage.ts` — table + enums.
- `server/routes/schedulingTriage.ts` — read routes.
- `server/routes/executionCases.ts` — call-result write path
  (lines 65-93 mapping).
- `client/src/lib/workflow/schedulingTriageApi.ts` — client helper.
- `docs/architecture/pcs-callback-action-audit.md` — callback
  write contract.
- `docs/architecture/audit-log-coverage.md` — gap #3 (audit log).
