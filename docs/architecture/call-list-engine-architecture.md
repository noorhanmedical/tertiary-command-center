# Call List Engine Architecture (Option 2)

This document describes how Engagement Center–assigned call work flows to the
Team Member Portal call list, and the operational tooling that keeps it
healthy. It reflects the **Option 2** decision: `patient_execution_cases` is
the canonical source of truth for engagement-assigned work. The legacy
`scheduler_assignments` table remains only as the auto-generated daily pool for
the Scheduler Portal and is **not** written for engagement assignments.

## Source of truth

- **Engagement-assigned call work** lives on `patient_execution_cases`
  (`assigned_team_member_id` → `outreach_schedulers.id`, plus
  `engagement_status`, `next_action_at`, `call_attempt_count`,
  `last_call_outcome`, `priority_score`, `selected_services`).
- The Team Member Portal call list reads from
  `GET /api/operational-queue/me`, which merges
  `listSchedulerTasksFromEngagementBoardForUser` (engagement cases) with the
  other operational sources. Engagement cases are emitted with
  `kind: "scheduler_task"`, `ownerType: "engagement_case"`.
- `scheduler_assignments` is the **legacy** daily auto pool only. It has no
  `next_action_at` / `priority` / `execution_case_id` columns and must not be
  used to carry engagement assignments.

## Scheduler ↔ user mapping

A logged-in user only sees engagement work assigned to the
`outreach_schedulers` row whose `user_id` equals their user id. When `user_id`
is NULL the user can never see their assigned work.

- `server/services/callList/schedulerUserMapping.ts`:
  - `resolveSchedulerForUser(userId)` returns a **structured** result —
    `{ status: "ok", schedulers }` or
    `{ status: "missing_user_mapping", code: MISSING_SCHEDULER_USER_MAPPING }`
    — so callers can tell "no work" apart from "unmapped account".
  - `buildSchedulerMappingAudit()` proposes a single user link only when
    exactly one username matches the scheduler name (case-insensitive). It
    never auto-applies.
  - `applySchedulerUserMapping(schedulerId, userId)` performs an explicit,
    admin-gated link.
- `GET /api/operational-queue/me` returns
  `meta.schedulerMapping: "ok" | "missing_user_mapping"`. The portal renders a
  banner when the mapping is missing instead of an ambiguous empty list.

## next_action_at policy

`server/services/callList/nextActionPolicy.ts` is the single source of truth
for "when should this case next surface". It is used by the assignment path
and mirrors the windows the call-result path already applies.

| Outcome                                  | Bucket        | next_action_at        |
| ---------------------------------------- | ------------- | --------------------- |
| assignment (no disposition)              | now           | now                   |
| callback / call-later                    | callback      | explicit ?? now+callbackHours |
| no_answer                                | retry         | now + noAnswerHours   |
| voicemail                                | retry         | now + voicemailHours  |
| wrong_number (no alt)                    | inactive      | null                  |
| wrong_number (alt number)                | retry         | now                   |
| declined / completed / cancelled/no_show | inactive      | null                  |
| scheduled                                | scheduled     | null                  |
| needs_admin_review / manager_review      | admin_review  | null                  |

An explicit `explicitNextActionAt` overrides the derived time for the active
buckets (now / callback / retry); terminal, scheduled and admin_review buckets
stay null regardless.

## Assignment path

`POST /api/engagement/assignment-board/assign`
(`server/routes/engagementAssignmentBoard.ts`):

- Sets `assigned_team_member_id`, `assigned_role`, `engagement_status`.
- Sets `next_action_at` via `calculateNextActionAt({ isAssignment: true })`.
  A pending **future** callback is preserved; otherwise the case surfaces now.
- Computes per-assignment `visibility` (`visible` vs `missing_user_mapping`,
  based on whether the target scheduler has a `user_id`) and returns it in the
  response `summary` and per-row `updated[]`. This lets the Engagement Center
  warn immediately when assigned work would be invisible.
- Does **not** write `scheduler_assignments` (the flag-gated legacy bridge
  stays OFF).

## Call-result propagation

`POST /api/engagement-center/call-result`
(`server/routes/executionCases.ts`) already computes `next_action_at` from
admin settings (callback / no-answer / voicemail hours), appends an
`outreach_calls` history row, and records journey events. Its timing windows
match `nextActionPolicy`; the policy module is the canonical reference for new
code.

## Audit & repair

`server/routes/callListAudit.ts` (admin-gated via `requireRole("admin")`):

- `GET /api/admin/call-list-audit` — every active assigned case with a
  computed `visibility` status: `visible`, `visible_but_overdue`,
  `missing_user_mapping`, `missing_next_action_at`, `missing_patient`,
  `needs_admin_review`, `assigned_scheduler_missing`. Includes the full
  scheduler→user mapping table and per-status counts.
- `POST /api/admin/call-list-audit/repair/dry-run` — proposes unambiguous
  mapping links and `next_action_at` backfills, and reports orphan scheduler
  references and missing patients. **Writes nothing.**
- `POST /api/admin/call-list-audit/repair/apply` — applies only the explicit
  changes named in the request body (`{ apply: true, mappings, backfillCaseIds }`).
  Backfill only touches cases that are genuinely missing `next_action_at`, so a
  stale id can never clobber a pending callback.

Admin UI: `client/src/pages/call-list-audit.tsx` (route `/call-list-audit`,
GlobalNav "Call List Audit", admin only) renders the audit and a dry-run
trigger.

## Frontend wiring

- `client/src/hooks/api/operationalQueue.ts` → `useMyOperationalQueue()` reads
  `/api/operational-queue/me` (`{ items, meta }`).
- `client/src/components/outreach/useOutreachData.ts` merges engagement
  screening IDs into the visible set, synthesizes rows for assigned patients
  not present in the facility dashboard list, and exposes
  `schedulerMappingMissing`.
- The Outreach/Team portal renders a missing-mapping banner above the call
  list when `schedulerMappingMissing` is true.
