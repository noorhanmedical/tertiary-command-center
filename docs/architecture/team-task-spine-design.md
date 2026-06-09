# Team-task spine design (Batch 11)

**Branch:** `architecture/batch-11-team-task-spine`
**Date:** 2026-06-09
**Scope:** Read-only server module + design doc. No route wiring. No schema changes. No client changes.

> Cross-reference: `docs/architecture/canonical-spine.md` §8 (current state of the two parallel task models), `docs/architecture/dependency-map.md`, `docs/architecture/full-21-batch-orchestrator-review.md` Batch 11 entry, `docs/architecture/refactor-batches.md`.

---

## 1. Why this batch exists

Three different portals each compute their own "task list" today, against different tables, with different shapes:

- **Engagement Center** — reads `patient_execution_cases` joined to `outreach_schedulers` + `patient_journey_events` (latest per case).
- **Scheduler Portal** — reads `scheduler_assignments` joined to `outreach_schedulers` + `patient_screenings`.
- **Team Portals** (Patient Care Specialist / Ancillary Care Specialist) — read a mix of `plexus_tasks` + `patient_execution_cases` + `scheduler_assignments`, through several `client/src/lib/workflow/*` and `client/src/lib/portal/*` API helpers.

The two parallel **task** models are:

1. `plexus_tasks` (`shared/schema/plexus.ts:23–47`) — generic operational task system: project-scoped, hierarchical (parent task id), with type / urgency / priority / status, collaborators, messages, events, read receipts. Used for absence alerts, ad-hoc operational work, and (per the original review) team-portal task surfaces.
2. `scheduler_assignments` (`shared/schema/outreach.ts:75–102`) — daily auto-assignment rows produced by the morning rebuild + absence-watcher pipeline. One row per `(patient_screenings.id, as_of_date)`. Status enum: `active | completed | reassigned | released`.

Today's portals re-implement the union ad-hoc, on the client, with different field names per source. Adding a unified read view here is the cheapest first step toward the user goal *"Team Portals are properly wired"* and the orchestrator goal of consolidating onto the canonical operational spine.

This batch is **read-only** and **not wired**. The portals stay on their existing API paths. Future batches will switch them over one at a time.

---

## 2. What ships in this batch

- `server/modules/team-tasks/contracts.ts` — `TeamTask` type + filter inputs.
- `server/modules/team-tasks/repo.ts` — two source queries (`listPlexusTasksForUser`, `listSchedulerAssignmentsForUser`) plus a single per-patient helper (`listTeamTasksByPatient`).
- `server/modules/team-tasks/service.ts` — `getTeamTaskView(userId, filters)` and `getTeamTaskViewByPatient(patientId, filters)`. Both sort by `createdAt DESC`.
- `server/modules/team-tasks/index.ts` — barrel.
- This design doc.

**Zero routes registered. Zero existing code modified. Zero schema changes.**

---

## 3. Unified `TeamTask` shape

The contract lives in `server/modules/team-tasks/contracts.ts`. Key design choices:

- **`id` is a composite source-prefixed string** (`"pt:<id>"` for plexus_tasks, `"sa:<id>"` for scheduler_assignments). Numeric ids collide across the two source tables; the prefix prevents that and stays human-readable.
- **`ownerType` is a discriminated union tag** (`"plexus_task" | "scheduler_assignment"`). Callers that need source-specific fields key off this tag.
- **`ownerId` carries the raw row id** (number) for callers that need to write back to the source. Today no writers exist; future portal-write batches will use this.
- **All source-specific fields are nullable** on the union. A `plexus_task`-source row has `null` for `source`, `asOfDate`, `originalSchedulerId`, `reason`, `completedAt`; a `scheduler_assignment`-source row has `null` for `title`, `description`, `taskType`, `urgency`, `priority`, `parentTaskId`, `projectId`, `batchId`, `dueAt`.
- **`status` is left as the raw text** from each source — the two vocabularies are NOT normalized in this batch. See §5.

---

## 4. Source ⇄ TeamTask mapping table

| Field on TeamTask | plexus_tasks source | scheduler_assignments source |
| --- | --- | --- |
| `id` | `` `pt:${id}` `` | `` `sa:${id}` `` |
| `ownerType` | `"plexus_task"` | `"scheduler_assignment"` |
| `ownerId` | `plexus_tasks.id` | `scheduler_assignments.id` |
| `assigneeUserId` | `plexus_tasks.assignedToUserId` | `outreach_schedulers.userId` (joined) |
| `assigneeName` | `users.username` (joined) | `outreach_schedulers.name` (joined) |
| `schedulerId` | `null` | `scheduler_assignments.schedulerId` |
| `patientScreeningId` | `plexus_tasks.patientScreeningId` | `scheduler_assignments.patientScreeningId` |
| `facility` | `plexus_projects.facility` (joined) | `outreach_schedulers.facility` (joined) ?? `patient_screenings.facility` (fallback) |
| `status` | `plexus_tasks.status` (raw text) | `scheduler_assignments.status` (raw text) |
| `title` | `plexus_tasks.title` | `null` |
| `description` | `plexus_tasks.description` | `null` |
| `taskType` | `plexus_tasks.taskType` | `null` |
| `urgency` | `plexus_tasks.urgency` | `null` |
| `priority` | `plexus_tasks.priority` | `null` |
| `parentTaskId` | `plexus_tasks.parentTaskId` | `null` |
| `projectId` | `plexus_tasks.projectId` | `null` |
| `batchId` | `plexus_tasks.batchId` | `null` |
| `dueAt` | `plexus_tasks.dueDate` (text) | `null` |
| `source` | `null` | `scheduler_assignments.source` |
| `asOfDate` | `null` | `scheduler_assignments.asOfDate` |
| `originalSchedulerId` | `null` | `scheduler_assignments.originalSchedulerId` |
| `reason` | `null` | `scheduler_assignments.reason` |
| `completedAt` | `null` | `scheduler_assignments.completedAt` |
| `createdAt` | `plexus_tasks.createdAt` | `scheduler_assignments.assignedAt` |
| `updatedAt` | `plexus_tasks.updatedAt` | `null` |

---

## 5. Status vocabularies — per source, NOT normalized

The two source tables use different status enums. **This module deliberately does NOT normalize them** in v1. The `includeCompleted` filter applies per-source rules:

### `plexus_tasks.status` (free-form text; observed values today)
- `"open"` (default)
- `"in_progress"`
- `"done"` ← terminal
- `"closed"` ← terminal
- ad-hoc values may exist (the column is `text`, not enum)

When `includeCompleted: false` (default), `done` + `closed` are filtered out.

### `scheduler_assignments.status` (typed via `SCHEDULER_ASSIGNMENT_STATUSES`)
- `"active"` (default)
- `"completed"` ← terminal
- `"reassigned"` ← intermediate, but conceptually "moved on"
- `"released"` ← terminal

When `includeCompleted: false` (default), `completed` + `released` are filtered out. `reassigned` rows are kept (they represent the recent history of an active patient).

### Why no normalization yet

- The two vocabularies serve different domains (operational tasking vs. daily call-list assignment). Forcing them into a single enum hides information.
- Portal UIs today already render the two differently (Scheduler Portal shows `(re)assigned` chips; Team Portals show task urgency/priority chips). Normalizing the status would break those affordances.
- A future batch (Batch 12 — journey-event standardization) can introduce a normalized "lifecycle" enum at a higher layer; this module's responsibility is just to surface raw status text without lying.

---

## 6. Facility derivation rules

| Source | Facility resolution |
| --- | --- |
| `plexus_tasks` | `plexus_projects.facility` via the `projectId` LEFT JOIN. If the task has no project, facility is `null`. |
| `scheduler_assignments` | Primary: `outreach_schedulers.facility` (joined). Fallback: `patient_screenings.facility` (joined for the patient context). The fallback exists because some legacy scheduler rows have `null` facility, which would otherwise hide them from facility-filtered portal views. |

A future batch (Batch 6 — facility canonicalization design) will replace the text columns with `facility_id` FKs; this module will need the same edit at that point.

---

## 7. Cutover plan

This is a **multi-batch** cutover. Each step is a separate PR with its own approval.

1. **Batch 11 — this batch.** Module ships read-only and unwired. No portal change.
2. **Batch 11a — additive portal endpoint (future PR).** Add `GET /api/team-tasks?userId=…&facility=…&includeCompleted=…` route that calls `getTeamTaskView`. Backed by tests in `server/modules/team-tasks/__tests__/parity.test.ts` that compare the union to the existing Scheduler Portal + Team Portal responses for one canned user. Do NOT switch any client yet.
3. **Batch 11b — Scheduler Portal cutover.** Switch the Scheduler Portal call list to read from `GET /api/team-tasks?ownerType=scheduler_assignment`. Visual + functional regression required.
4. **Batch 11c — Team Portal "My Tasks" cutover.** Same pattern: switch `client/src/components/portal/*` task views to `getTeamTaskView`.
5. **Batch 11d — engagement-board side join (optional).** Engagement Center keeps its existing read because it joins `patient_execution_cases`, not `plexus_tasks`/`scheduler_assignments`. Will be subsumed by Batch 13 (Engagement Center read-model optimization).

Until 11a ships, this module costs zero runtime: no route imports it, no scheduled job consumes it, no test runs it.

---

## 8. Compatibility rules

- **No writes from this module.** All write paths (`POST /api/plexus/tasks`, `POST /api/scheduler-assignments/redistribute`, etc.) stay on their existing handlers. Future batches add typed writers; this batch does not.
- **No schema changes.** Adding `facility_id`, normalizing status enums, splitting `plexus_tasks` into a separate task table — all out of scope.
- **No migration file.** This batch is purely additive at the application layer.
- **No client change.** Portals continue calling their current endpoints.
- **The user-id join can be `null`.** Both `plexus_tasks.assignedToUserId` and `outreach_schedulers.userId` are `set null` references; the helpers tolerate this with `LEFT JOIN`s.

---

## 9. Hard protected areas — none touched

| Area | Touched? | Why |
| --- | --- | --- |
| Patient qualification logic | no | Module never reads `qualifyingTests` or `reasoning`. |
| Plexus IQ qualification flow | no | No route registered; no caller. |
| Admin Review reasoning behavior | no | No Admin Review code touched. |
| Supporting button assignment logic | no | No reasoning touched. |
| Canonical reasoning shape | no | No writes to `patient_screenings.reasoning`. |
| Plexus packets / Clinician packets | no | No PDF code touched. |
| Plexus PDF / Clinician PDF / Collection PDF | no | No PDF code touched. |
| Selected patient PDF actions | no | No client code touched. |
| Scheduler-to-patient assignment correctness | no | No writes to `scheduler_assignments`. |
| Patient-to-scheduler assignment persistence | no | Read-only join. |
| Report/document source data used by PDFs | no | No document code touched. |
| Billing / invoice correctness | no | No billing tables touched. |

---

## 10. Risks acknowledged

- **Status text drift.** Both source tables use `text` for status. If a future writer introduces a new status value (e.g., `"on_hold"`), this module surfaces it as-is. Callers that depend on a fixed enum will break; portals must defensively handle unknown status text.
- **Facility-null rows visible.** When a `plexus_task` has no project (and hence no facility) or a `scheduler_assignment` has a scheduler with null facility AND a patient with null facility, the row's `facility` is `null`. Facility filters omit these rows. Portals must decide whether "all facilities" listings include null-facility rows or not — current behavior excludes them via facility filter; "no facility filter" includes them.
- **Performance.** Each list call runs one query against each source. For users with hundreds of active assignments, the union grows; the per-source `limit` (default 200, max 1000) caps the cost. Pagination is the caller's responsibility — a future batch can paginate, but only after a portal consumes the view (otherwise we'd be optimizing dead code).

---

## 11. Rollback plan

`git rm -r server/modules/team-tasks/` and `git rm docs/architecture/team-task-spine-design.md`. No runtime state to unwind. No other code references the module.

---

## 12. Stop conditions for follow-up batches (11a through 11d)

A future implementation batch MUST stop and ask before continuing if:

1. A portal cutover changes the visible status chip color/label for any task type.
2. A cutover changes the order or selection of tasks shown vs. the pre-cutover view (parity test must catch this; if it slips, stop and revert).
3. Adding the additive route requires touching `server/routes.ts` in a way that changes route ordering for any other route.
4. Adding the additive route requires touching `server/services/morningRebuildScheduler.ts`, `absenceWatcher.ts`, `callListEngine.ts`, or `callListPriority.ts` — those are advisory-locked daily flows and should not be modified by a portal cutover.
5. The future patient-detail view requires this module to write — it doesn't yet, and adding writes belongs to a separate batch with its own approval.

End of design doc.
