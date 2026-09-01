# Queue & Assignment Model

> **Scope:** State on `main` (`88c0a1d`), derived from the approved
> audit + main-branch verification. The Exception Queue is **branch-only**
> and not included in the operating-day queue set.

## 1. Operating-day queues (on main)

Each queue is a separate read surface with its own owner and
next-action logic. Listed in the order an operator typically encounters
them through the day.

| # | Queue / worklist | Read path | Owner logic | Next-action timing | Status values | Persisted vs derived |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Engagement Assignment Board | `server/routes/engagementAssignmentBoard.ts:147-410` (GET); UI `client/src/components/engagement/EngagementAssignmentBoard.tsx` | live select over `patient_execution_cases` filtered by `lifecycleStatus='active'` AND `engagementStatus NOT IN (archived,closed,cancelled,completed)` | `nextActionAt` on the case | engagementStatus open-set (`new`, `ready`, `assigned`, `not_reached`, `contacted`, `in_progress`, `needs_followup`, …) | persisted |
| 2 | Engagement Call List (canonical, flag-gated) | `server/routes/executionCases.ts:260-315` | server resolves `assignedTeamMemberId` from session via `resolveCallListAssignmentScope` (`server/services/teamMemberScope.ts`) | uses `nextActionAt` | from `patient_execution_cases.engagementStatus` | flag-gated read (default 404) |
| 3 | Scheduler Portal call queue (legacy) | `server/services/outreachService.ts buildOutreachDashboard`, route `/api/outreach/dashboard` (`server/routes/outreach.ts:112`) | scheduler-by-scheduler aggregates over `scheduler_assignments` + `outreach_calls` | scheduler `userId` from `outreach_schedulers` mapped to session | derived from `callback_at`, `appointmentStatus` | scheduled / declined / no_answer / callback / pending | persisted (assignments) + derived (counts) |
| 4 | Scheduler call-list engine (daily rebuild) | `server/services/callListEngine.ts` (`buildAssignmentsForPool`) | `outreach_schedulers.capacityPercent` greedy weighted partition | `asOfDate` (today) | `scheduler_assignments.status` | runs in `server/services/morningRebuildScheduler.ts:26` |
| 5 | Portal outreach call list | `server/routes/portal.ts:358-508` | `/api/portal/outreach-call-list` reads batch + screenings live, partitions by worker | `outreach_schedulers.userId` mapped to session | not stored; cap = `PORTAL_OUTREACH_BASE_CAP × PORTAL_OUTREACH_HEAVY_DAY_CAP_FACTOR` when heavy | facility `appointmentStatus` | derived live per request |
| 6 | Team Portal call list (workspace) | `client/src/lib/workflow/teamMemberWorkspaceApi.ts fetchWorkspaceCallList` → `/api/scheduler-portal/cases?workspace=pcs|acs` (`server/routes/executionCases.ts:958`) | same as engagement call list but with viewAs scoping | session user (or admin view-as) | `nextActionAt` | engagementStatus / lifecycleStatus | persisted |
| 7 | Today's clinic schedule | `/api/portal/today-schedule` (`server/routes/portal.ts:201`) | `ancillary_appointments` JOIN screening JOIN batch | facility-scoped via `outreach_schedulers.userId` | from `scheduled_time` | appointment status | persisted |
| 8 | Plexus Tasks (urgent / open) | `/api/portal/my-tasks` (`server/routes/portal.ts:596-630`); `plexus_tasks` schema | tasks where `assignedToUserId=session` AND `taskType='tech_assignment'` AND `status≠'closed'` | `users.id` | `dueDate` | open / closed | persisted |
| 9 | ACS workflow snapshot | `/api/acs-workflow/:executionCaseId` (`server/routes/acsWorkflow.ts:10`) | reads execution case + `global_schedule_events` + `case_document_readiness` + `billing_readiness_checks` + `procedure_events` | none (per case) | derived from `globalScheduleEvents.startsAt` and document statuses | enum `AcsWorkflowStatus` (16 values, `server/services/ancillary/acsWorkflowRuntime.ts:23-40`) | derived live |
| 10 | Scheduling Triage queue | `/api/scheduling-triage*` | `scheduling_triage_cases` (`shared/schema/schedulingTriage.ts:39`) | `nextOwnerRole` from `TRIAGE_MAPPINGS` (`server/routes/executionCases.ts:155-173`) | derived | 8 statuses (`shared/schema/schedulingTriage.ts:22-31`) | persisted |
| 11 | **Operational Queue (UNIFIED, additive)** | `/api/operational-queue/me` (`server/routes/operationalQueue.ts:78`); service `server/modules/operational-queue/service.ts:57` | merges 4 sources (call_list_item, scheduler_task, visit_appointment, global_calendar_event) | per source | `scheduledDate` | per-source | **read-only / NOT consumed by any UI today** (intentionally additive per file header) |
| 12 | Billing Auditor worklist | `server/services/billing/billingAuditorWorklistService.ts` | live select over `billing_records` + `invoices` | manual claim | n/a | by remittance status | derived |
| 13 | Invoice Readiness worklist | `/billing/readiness` reads `invoice_readiness_snapshots` | per (case, serviceType) | n/a | `evaluatedAt` | 6 statuses (`shared/schema/invoiceReadiness.ts:16-23`) | persisted |
| 14 | Invoice Batches / Review / Delivery | `/billing/invoice-batches` etc. | `invoice_batches`, `invoices.approvalStatus`, `invoices.deliveryStatus` | `created_by` + `approved_by` | `due_date` | approval × delivery enums | persisted |

### Branch-only queue (NOT on main)

- **Exception Queue** at `/exceptions` + `exception_snapshots`. Only on
  the `phase-3-ai-exception-intelligence` branch. Not part of the
  operating-day queue set on `main`.

## 2. Ownership model

### 2.1 The two-id problem

`patient_execution_cases.assignedTeamMemberId` is **integer** and
references `outreach_schedulers.id`, **not** `users.id`
(`shared/schema/executionCase.ts:41`). Portal authorization therefore
requires a double join:

```
session.userId
  → outreach_schedulers.userId   (varchar → users.id)
  → outreach_schedulers.id       (integer)
  → patient_execution_cases.assignedTeamMemberId
```

This is enforced at routes such as `server/routes/portal.ts:76-96` and
`server/routes/outreach.ts:61`. Any new ownership-aware code must
remember this indirection.

### 2.2 Defensive person-level guard

`engagementAssignmentBoard.ts:30-89, 469-482` enforces "two schedulers
cannot share the same patient on the same date" by walking sibling
cases via `lower(name) + dob`. This is a code-level guard layered on
top of the per-screening-id schema, because no canonical person id
exists today
(see [PATIENT_DIRECTORY_SOURCE_OF_TRUTH.md](./PATIENT_DIRECTORY_SOURCE_OF_TRUTH.md)).

### 2.3 Auto-assign

`commitPatient` (`server/services/patientCommitService.ts:61`) calls
`autoAssignSchedulerForExecutionCase` (via `schedulerAutoAssign.ts`) as
one of the fire-and-forget side effects. Failure here does not surface
back to the admin-approval response — see
[OPERATIONAL_FLOW_MAP.md §4](./OPERATIONAL_FLOW_MAP.md#4-cross-cutting-silent-failure-surfaces).

### 2.4 Daily rebuild

`server/services/morningRebuildScheduler.ts:26` rebuilds
`scheduler_assignments` once per day, partitioning patients across
schedulers via the call-list engine (`callListEngine.ts`).

### 2.5 Absence redistribution

`server/services/absenceWatcher.ts:42-44` redistributes assignments
when a scheduler goes out (PTO / sick).

## 3. Next-action timing

| Source | What it sets | Used by |
| --- | --- | --- |
| `patient_execution_cases.nextActionAt` | timestamp of next operator action | Engagement Center, Engagement Call List, Team Portal call list |
| `scheduler_assignments.callback_at` (via `outreach_calls.callback_at`) | callback target for the per-scheduler queue | Scheduler Portal |
| `scheduling_triage_cases.dueAt` | triage SLA | Triage queue |
| `ancillary_appointments.scheduled_time` | clinic schedule | PCS/ACS clinic schedule view |
| `global_schedule_events.startsAt` | calendar entries | Global calendar + Team Portal calendar drawer |
| `plexus_tasks.dueDate` | task SLA | `/api/portal/my-tasks` |

There are **two parallel sources of "next action"** on a case — the
case's own `nextActionAt` column and any associated
`scheduling_triage_cases.dueAt`. They can diverge.

A `callback` outcome whose `callback_at` is not supplied defaults to
`now + 4h` in the canonical planner
(`server/services/callResult/recordCallResult.ts:421-426`) — a silent
magic value.

## 4. Status vocabulary by queue

| Queue | Status enum / values | Source |
| --- | --- | --- |
| Engagement assignment board | `engagementStatus` open-set; case `lifecycleStatus` | `executionCase.ts:26` |
| Scheduler Portal | `appointmentStatus`: scheduled / declined / no_answer / callback / pending (legacy text) | `shared/schema/screening.ts` |
| Scheduler assignments | active / completed / reassigned / released | `shared/schema/outreach.ts:75-102` |
| Scheduling Triage | 8 statuses | `shared/schema/schedulingTriage.ts:22-31` |
| ACS Workflow | 16 statuses (`AcsWorkflowStatus`) | `acsWorkflowRuntime.ts:23-40` |
| Procedure events | 6 statuses | `shared/schema/procedureEvents.ts:10-17` |
| Invoice readiness | 6 statuses | `shared/schema/invoiceReadiness.ts:16-23` |
| Invoices | `status` ("Draft" / "Sent" / "Partially Paid" / "Paid") + `approvalStatus` + `deliveryStatus` (3 parallel machines) | `shared/schema/invoices.ts:14,35-37` |
| Admin approval | `pending / approved / needs_info / rejected` | `shared/schema/screening.ts:91-97` |
| Commit status | `Draft / Ready / …` | `shared/schema/screening.ts` |

## 5. Failure-mode observations on main

- **Empty queues silently render as "no rows" — there is no "queue is
  empty because filter X excluded everything" hint.** Risk when one
  queue diverges from another (e.g. case is in Engagement Center but
  not Team Portal because of the `engagementStatus` filter).
- **The unified `/api/operational-queue/me` exists but no UI consumes
  it** (`server/routes/operationalQueue.ts:9-21` declares it
  intentionally additive). Promoting it is tracked in
  [PLATFORM_HARDENING_BACKLOG.md](./PLATFORM_HARDENING_BACKLOG.md).
- **No "this is on my call list because …" surface** in Team Portal —
  debugging a missing patient requires admin-only access to the data.
- **Owner / nextAction can be null** on `patient_execution_cases`
  without UI explaining why.
- **Bulk operations show counts but per-item failure reasons vary in UI surfacing.**
  The Engagement assignment board returns a `failed[]` array in the
  response; the client surfacing of those rows is uneven.
