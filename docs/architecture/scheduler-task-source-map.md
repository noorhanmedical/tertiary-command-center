# Scheduler-task source map (Batch 11a)

**Branch:** `architecture/batch-11a-operational-queue-foundation`
**Date:** 2026-06-09
**Scope:** READ-ONLY inventory. Companion to `operational-queue-design.md`.
**Purpose:** Identify every surface that contributes to "what does this scheduler/team-member have to do today?" — not the call list (covered separately in `call-list-source-map.md`), but the broader work backlog: tasks, absence alerts, scheduling triage, document readiness items, billing readiness items.

> Cross-reference: `call-list-source-map.md`, `visit-schedule-source-map.md`, `global-calendar-source-map.md`, `team-task-spine-design.md` (Batch 11), `protected-flows.md` §8.

---

## 0. What "scheduler task" means

A "scheduler task" (in this map's scope) is any persistent operational work item that a team member must address. It is distinct from the call list (one-day-scoped, auto-generated daily) and distinct from the visit schedule (today's appointments). Tasks may be ad-hoc (created by an operator), absence-driven (auto-created by `absenceWatcher.ts`), or system-derived (scheduling triage cases, billing readiness checks).

This map covers FIVE persistent task sources today.

---

## 1. Source 1 — `plexus_tasks` (the generic task system)

**Schema:** `shared/schema/plexus.ts:23–47`.
**Project parent:** `plexus_projects` (`plexus.ts:5–17`).
**Related child tables:** `plexus_task_collaborators`, `plexus_task_messages`, `plexus_task_events`, `plexus_task_reads`.

**Status enum:** free-form text. Observed values: `"open" | "in_progress" | "done" | "closed"` (others may exist; the column is `text`).

**Type enum:** `taskType` column, defaults to `"task"`. Observed values include `"task" | "absence_alert" | "scheduler_handoff" | "billing_followup"`.

**Endpoints:**

| Endpoint | File | Role |
| --- | --- | --- |
| `GET /api/plexus/tasks` | `server/routes/plexusTasks.ts:280` | List with rich filters. |
| `GET /api/plexus/tasks/my-work` | `plexusTasks.ts:318` | Current user's open tasks. |
| `GET /api/plexus/tasks/sent` | `plexusTasks.ts:327` | Tasks the current user assigned to others. |
| `GET /api/plexus/tasks/urgent` | `plexusTasks.ts:339` | Urgent-flagged tasks. |
| `GET /api/plexus/tasks/overdue` | `plexusTasks.ts:348` | Past-due tasks. |
| `GET /api/plexus/tasks/unread-count` | `plexusTasks.ts:362` | Unread-message count per user. |
| `GET /api/plexus/tasks/by-patient/:patientId` | `plexusTasks.ts:380` | Tasks scoped to one patient. |
| `GET /api/plexus/tasks/by-project/:projectId` | `plexusTasks.ts:415` | Tasks scoped to one project. |
| `POST /api/plexus/tasks` | `plexusTasks.ts:546` | Generic create. |
| `POST /api/plexus/tasks/patient-task` | `plexusTasks.ts:447` | Patient-scoped create (special-case). |
| `PATCH /api/plexus/tasks/:id` | `plexusTasks.ts:567` | Update. |
| `DELETE /api/plexus/tasks/:id` | `plexusTasks.ts:613` | Delete. |
| `POST /api/plexus/tasks/:id/call-outcome` | `plexusTasks.ts:732` | Log a call outcome against a task. |

**Auto-create paths:** `absenceWatcher.ts` creates absence-alert tasks. `commitPatient` does NOT create plexus tasks directly.

---

## 2. Source 2 — `scheduler_assignments` (covered separately in §3)

See `call-list-source-map.md` for the full coverage. In the operational-queue read model, scheduler assignments are kind `call_list_item`. Reproduced here so the source-map list is complete.

| Schema | `shared/schema/outreach.ts:75–102` |
| Key endpoints | See call-list source map §1. |

---

## 3. Source 3 — Engagement-board assignments

The Engagement Center board (`server/routes/engagementAssignmentBoard.ts`) reads `patient_execution_cases` joined to `outreach_schedulers` and presents one row per active case. A row assigned to a team member IS a task: that member is expected to engage the patient (call, schedule, escalate).

**Endpoints:**

| Endpoint | File | Role |
| --- | --- | --- |
| `GET /api/engagement/assignment-board` | `engagementAssignmentBoard.ts:165` | Returns rows + summary. |
| `POST /api/engagement/assignment-board/assign` | `engagementAssignmentBoard.ts:431` | Bulk assign N patients to one team member. Conflict-guarded. |
| `POST /api/engagement/assignment-board/cancel-many` | `engagementAssignmentBoard.ts:588` | Bulk cancel. |

**Status field:** `patient_execution_cases.engagementStatus`. Observed values: `"new" | "ready" | "assigned" | "not_reached" | "completed" | "closed" | "cancelled" | "archived"`.

**Backing table:** `patient_execution_cases` (`shared/schema/executionCase.ts:29–52`). Holds `engagementBucket`, `engagementStatus`, `assignedTeamMemberId`, `assignedRole`, `nextActionAt`.

---

## 4. Source 4 — Scheduling triage cases

**Schema:** `shared/schema/schedulingTriage.ts`.
**Purpose:** When an outreach call result is `"needs_scheduling_review"` or similar, a scheduling-triage case is opened. Resolved by a triage operator (often the same person who placed the call, but the resolution flow is separate).

**Endpoint (write side):** `POST /api/engagement-center/call-result` (`server/routes/executionCases.ts:174`) opens triage cases when the call result requires it.

**Read endpoint:** No dedicated triage-list endpoint surfaces today — the cases are surfaced via the Engagement Center board (where they appear as `engagementBucket = "scheduling_triage"`).

This source is a **derived task surface**: a scheduling-triage case IS an engagement-board row with a specific bucket.

---

## 5. Source 5 — Billing readiness checks

**Schema:** `shared/schema/billingReadiness.ts`.
**Purpose:** Tracks whether a completed procedure has the required documents + billing prerequisites before invoicing. A failed check IS a task: a biller must resolve the missing document.

**Endpoints:** See `server/routes/billingReadiness.ts`. Read endpoints surface the readiness state per case.

**Surfaced in Team Portal?** No dedicated UI today; surfaces via the billing-records page.

---

## 6. Behavioral invariants (do not regress)

1. **`plexus_tasks` is the canonical generic task store.** Operators can create / edit / delete. Absence-watcher writes here.
2. **Absence-alert tasks have a strict TTL.** If untouched for 30 minutes, the absence-watcher auto-executes redistribute (calling the scheduler-assignments redistribute endpoint).
3. **Engagement-board assignments DO NOT show up in `plexus_tasks`.** They're a separate model. The future read model unifies these two sources.
4. **Scheduling-triage cases stay surfaced via engagement board** until a future batch separates them.
5. **Conflict guard on the engagement board** (`findConflictingActiveAssignment`) rejects assigning the same `(patient name, dob, scheduleDate)` to a different team member. This rule does NOT apply across sources — `plexus_tasks` can have any number of tasks for the same patient.

---

## 7. Status vocabulary table (the cross-source mess this map highlights)

Each source uses different status text. **The future unified queue does NOT normalize them** (per Batch 11 design doc §5):

| Source | Status enum |
| --- | --- |
| `plexus_tasks.status` | free text — observed `open / in_progress / done / closed` |
| `scheduler_assignments.status` | `active / completed / reassigned / released` (typed) |
| `patient_execution_cases.engagementStatus` | free text — observed `new / ready / assigned / not_reached / completed / closed / cancelled / archived` |
| scheduling_triage status | free text — observed `pending / in_review / resolved / escalated` |
| billing_readiness checks | per-check pass/fail booleans, not a status enum |

**Implication for `operational-queue-design.md`:** the queue presents the raw status from each source, plus a derived `isOpen: boolean` field that abstracts over "this task is still actionable" without losing the per-source detail.

---

## 8. Client consumers

| File | Role |
| --- | --- |
| `client/src/pages/plexus-tasks.tsx` | Plexus tasks page. |
| `client/src/pages/engagement-center.tsx` | Engagement Center board view. |
| `client/src/components/portal/TeamPortalShell.tsx` + `PortalShell.tsx` | Team Portal task tab. Reads multiple endpoints today. |
| `client/src/lib/workflow/teamMemberWorkspaceApi.ts` | Workflow helpers for team-portal task views. |

---

## 9. What this map does NOT cover

- Per-task message thread surfacing (separate concern; out of scope for read model).
- Plexus task collaborators / read-receipts — those are subordinate to the parent task row.
- The scheduler-AI helper at `server/routes/schedulerAi.ts` (AI-assisted scheduling decisions; doesn't produce tasks).

End of source map.
