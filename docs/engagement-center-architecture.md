# Engagement Center Architecture

## Purpose

The Engagement Center is the Plexus command-center surface for
managing patients that have been **sent to Engagement** (i.e.
`commitStatus !== "Draft"`). It is the only place an Engagement
manager can re-route work across the team's PCS/ACS/scheduler
roster.

The Engagement Center never owns assignment data. It is a view +
write surface over the canonical spine.

## Canonical sources

| Concern | Canonical table |
| --- | --- |
| Patient identity / clinical | `patient_screenings` |
| Engagement case (bucket, status, lifecycle, assignment, priority) | `patient_execution_cases` |
| Team-member roster (name + facility + capacity) | `outreach_schedulers` |
| Assignment audit trail | `patient_journey_events` (`eventType = "engagement_assignment_changed"`) |
| Facility / scheduleDate context | `screening_batches` |
| Per-patient call/text/email/marketing timeline | `patient_communications` |

There is **no separate engagement-assignment table** and no parallel
call-list assignment store. PCS/ACS portal call lists already filter
by `patient_execution_cases.assignedTeamMemberId`, so changes made
in the Engagement Center flow to the assignee's queue immediately
once the standard query invalidations fire.

## Routes

| Method + Path | Purpose |
| --- | --- |
| `GET /api/engagement/assignment-board` | Read model: every active engagement case joined to its patient, batch, current assignee, latest journey event, and missing-info hint. Supports query filters `q`, `facility`, `assignedTeamMemberId`, `engagementStatus`, `engagementBucket`, `patientType`, `unassignedOnly`, `missingInfoOnly`. |
| `POST /api/engagement/assignment-board/assign` | Bulk or single assign. Body `{ patientScreeningIds[], schedulerId, assignedRole?, reason? }`. Updates `patient_execution_cases.assignedTeamMemberId` and appends a `patient_journey_events` row per patient. |
| `GET /api/patients/:id/engagement-assignment` | Single-patient assignment owner (used by `EngagementAssignmentBadge` on cards). |
| `GET /api/patients/:id/engagement-assignment/options` | Ranked scheduler picks (facility-match first, then capacity desc, then name). |
| `POST /api/patients/:id/engagement-assignment` | Single-patient assign (used by `ChangeEngagementAssignmentDialog`). |

## Default sort + filters

`GET /api/engagement/assignment-board` returns rows ordered by:

1. Unassigned first.
2. `nextActionAt` ascending (nearest first).
3. `lastActivityAt` descending (most recent first).

The summary block (counts by facility / assignee / engagement status)
respects whatever filters were applied.

## Status semantics on assignment

When an assignment is changed, `engagementStatus` is only advanced
to `"assigned"` when the case is in a soft state (`new`, `ready`,
`assigned`, `not_reached`). Strong states (`scheduled`, `completed`,
etc.) are preserved so an in-flight schedule isn't accidentally
reset to "assigned" just because the owner changed.

## Audit trail

Every change appends a `patient_journey_events` row:

```
eventType = "engagement_assignment_changed"
eventSource = "engagement_assignment_board" | "manual_assignment_change"
summary = "Assigned to <name> from Engagement Center"
metadata = {
  previousSchedulerId, previousSchedulerName, previousSchedulerFacility,
  newSchedulerId, newSchedulerName, newSchedulerFacility,
  assignedRole, reason, batch
}
```

The Patient Command Canvas's Journey folder + the Assignment Board's
"Last activity" column read from this same table — they never drift.

## Frontend

| File | Purpose |
| --- | --- |
| `client/src/components/engagement/EngagementAssignmentBoard.tsx` | Full-board UI: summary cards, filters, multi-select, bulk-assign panel, per-row Change. |
| `client/src/components/qualification/EngagementAssignmentBadge.tsx` | Compact "Sent to Engagement · <name>" badge with Change button on every card with `commitStatus !== "Draft"`. |
| `client/src/components/qualification/ChangeEngagementAssignmentDialog.tsx` | Single-patient pick dialog used by the badge. |
| `client/src/pages/outreach.tsx` (the Engagement Center page) | Wraps the existing dashboard cards + the new Assignment Board in a Tabs surface (`Dashboard` / `Assignments`). |

## QA

`npm run qa:engagement-assignment-board` (skips cleanly without
`DATABASE_URL`) verifies:

- `outreach_schedulers` reads.
- `patient_execution_cases` query layer.
- Writing through `patient_execution_cases` + appending a
  `patient_journey_events` row on an `isTest=true` patient.

`npm run qa:plexus-final-wiring` continues to verify the upstream
PDF-packet contract and the canonical engagement read paths.

## Refresh / invalidation

After any successful assignment write, the Engagement Center
invalidates:

- `/api/engagement/assignment-board` (all query variants)
- `engagement-assignment` (per-patient badge)
- `team-workspace-call-list`
- `/api/screening-batches`
- `/api/schedule/dashboard`
- `portal-command-center` (any patient key)

Result: the assignee's call list, the patient command canvas, the
clinic detail badge, and the schedule dashboard all reflect the
change without a manual refresh.

## Default tab

The Engagement Center now opens directly on **Assignments**
(previously it opened on Dashboard). The intent: the manager's first
question is "who needs an owner right now?", and that answer lives
on the Assignment Board. The Dashboard tab remains one click away.
