# Phase 3 PR 3.7 — Scheduling / No-Show / Call Priority Intelligence

## What this PR is

PR 3.7 extends the engine and recommendation registry with four
scheduling/contact detectors, and introduces a **call priority queue**
that ranks open call-related exceptions for PCS / ACS users.

## New detectors (engine v3.7.0)

| Type | Source | When it fires |
| --- | --- | --- |
| `missing_patient_contact` | `patient_screenings` | Both phone and email are empty / one of them empty |
| `lvm_followup_overdue` | `outreach_calls` | Latest call per patient has outcome `voicemail` and age ≥ threshold |
| `no_answer_followup_overdue` | `outreach_calls` | Latest call has outcome `no_answer` and age ≥ threshold |
| `unable_to_reach_threshold_met` | `outreach_calls` | Cumulative failed attempts ≥ threshold |

All thresholds resolve through the Phase 3 admin_settings precedence.

## Call priority service

`callPriorityService.computeCallPriorityQueue(filters)` reads open /
acknowledged / in_review exceptions whose type is in:

```
callback_overdue
lvm_followup_overdue
no_answer_followup_overdue
unable_to_reach_threshold_met
ready_to_schedule_stale
stale_queue_item
missing_patient_contact
```

…and scores each one by:

| Signal | Weight |
| --- | --- |
| severity (`critical / high / medium / low / info`) | 100 / 70 / 40 / 20 / 10 |
| age in hours, capped at +50 | +1 per hour |
| `hoursOverdue` / `overdueHours` / `hoursPending` from the source snapshot, capped at +40 | +0.5 per hour |
| matching `ownerRole` filter | +5 |

The result is a deterministic, reproducible queue. Re-running with the
same inputs returns the same order. No randomness, no model.

## Endpoint

`GET /api/call-priority?facilityId=&ownerRole=&limit=`

Returns `{ version, items: [{ exception, score, reasons }] }`. Open to
any authenticated user (PCS / ACS workflow).

## Page

`/call-priority` is an admin-guarded page that shows the ranked queue,
the score, the contributing reasons, and a detail panel for review.

## What this PR does NOT do

- It does **not** auto-dial. The queue is a recommendation order, not
  a dialer.
- It does **not** send SMS or LVMs. Outreach actions are out of scope
  until phases that explicitly authorise channel integrations.
- It does **not** mutate `outreach_calls` or `patient_screenings`.
- It does **not** invent new contact info — `missing_patient_contact`
  flags a gap; the recommendation rule proposes intake collection.

## Recommendation rules

Each new detector has a paired entry in `RECOMMENDATION_RULES`:

| Detector | Action | Why |
| --- | --- | --- |
| `missing_patient_contact` | `request_more_info` | collect from intake |
| `lvm_followup_overdue` | `schedule_callback` | follow up on voicemail |
| `no_answer_followup_overdue` | `schedule_callback` | retry next allowed channel |
| `unable_to_reach_threshold_met` | `escalate_to_admin` | switch strategy |

All rules still emit with `modelProvider = rules_engine` and
`confidenceLabel = not_applicable` per the AI safety contract.
