# Call-list source map (Batch 11a)

**Branch:** `architecture/batch-11a-operational-queue-foundation`
**Date:** 2026-06-09
**Scope:** READ-ONLY inventory. Companion to `operational-queue-design.md`.
**Purpose:** Identify every place in the codebase that reads, computes, or renders a scheduler's daily call list so the future unified queue can replace the ad-hoc computations without losing data.

> Cross-reference: `operational-queue-design.md`, `scheduler-task-source-map.md`, `visit-schedule-source-map.md`, `global-calendar-source-map.md`, `protected-flows.md` §7.

---

## 0. What "call list" means

A scheduler's call list is the ordered set of patients they are expected to contact today. It is computed daily by `morningRebuildScheduler.ts` (advisory-locked at 7 AM) and surfaced by `/api/portal/outreach-call-list` to the Scheduler Portal. Mid-day eligibility changes (admin approval; AI re-analysis) inject patients via `assignNewlyEligiblePatient()`.

---

## 1. Canonical endpoint surface

| Endpoint | File | Role |
| --- | --- | --- |
| `GET /api/portal/outreach-call-list` | `server/routes/portal.ts:286` | Read API consumed by the Scheduler Portal. Returns the scheduler's ordered list for a given `(facility, date)`. Authenticated via `requirePortalRole`. |
| `POST /api/scheduler-assignments/rebuild` | `server/routes/schedulerAssignments.ts:55` | Operator-triggered rebuild for a `(facility, date)`. Advisory-locked. |
| `POST /api/scheduler-assignments/redistribute` | `server/routes/schedulerAssignments.ts:89` | Redistribute due to absence/handoff. |
| `POST /api/scheduler-assignments/approve-absence` | `server/routes/schedulerAssignments.ts:112` | Absence approval → triggers redistribute. |
| `GET /api/scheduler-assignments` | `server/routes/schedulerAssignments.ts:26` | Raw rows (not portal-shaped). |
| `GET /api/scheduler-assignments/dashboard` | `server/routes/schedulerAssignments.ts:143` | Aggregate dashboard. |

**Backing table:** `scheduler_assignments` (`shared/schema/outreach.ts:75–102`). One row per `(patient_screenings.id, as_of_date)`. Status enum: `active | completed | reassigned | released`. Unique partial index on `(patient_screening_id, as_of_date) WHERE status = 'active'` enforces "one active assignment per patient per day".

---

## 2. Compute pipeline (build path)

The build pipeline writes `scheduler_assignments` rows. The portal endpoint reads them.

| File | Role |
| --- | --- |
| `server/services/morningRebuildScheduler.ts` | Cron-like scheduler that runs every weekday morning at 7 AM (advisory-locked). For each facility, calls `callListEngine.buildCallList()` and persists results. |
| `server/services/callListEngine.ts` | The actual build engine. Pulls eligible patients (committed + qualifying tests + facility + date), runs priority ranking via `callListPriority.ts`, applies greedy capacity allocation across active schedulers. |
| `server/services/callListPriority.ts` | Pure priority-scoring helpers used by `callListEngine.ts`. |
| `server/services/absenceWatcher.ts` | Every 10 minutes during business hours. Detects schedulers who haven't logged in / responded; creates `absence_alert` plexus tasks; if no action within 30 min, auto-executes `redistribute`. |
| `server/services/outreachService.ts` | Lower-level helpers for outreach calls; reads the call list shape. |
| `server/services/schedulerSettings.ts` | `lookupSchedulerFromSettings(facility)` resolves the canonical scheduler row for a `(facility)` pair. Used by `commitPatient()` and admin-approval routing. |
| `server/services/patients.ts` `assignNewlyEligiblePatient()` (called from `server/routes/patients.ts:1267`) | Mid-day eligibility hook. After AI analysis succeeds + qualifying tests + facility, slots the patient into today's queue without waiting for next morning. |
| `server/services/patientCommitService.ts` (`commitPatient`) | On commit (`auto: true` or manual), calls `autoAssignSchedulerForExecutionCase()` which writes the active scheduler row. |
| `server/services/schedulerAutoAssign.ts` | `autoAssignSchedulerForExecutionCase()` — the canonical auto-assign helper. Reads `outreach_schedulers` for the matching facility and writes the `scheduler_assignments` row. |

---

## 3. Client consumers

| File | Role |
| --- | --- |
| `client/src/pages/outreach.tsx` | Scheduler Portal landing. |
| `client/src/pages/outreach-scheduler-portal.tsx` | Scheduler-specific portal view (`/outreach/scheduler/:id`). Renders the call list via `/api/portal/outreach-call-list`. |
| `client/src/lib/portal/scheduleInvalidations.ts:69` | Query-key invalidation for `["/api/portal/outreach-call-list"]` — fires when assignments change. |
| `client/src/lib/portal/commandCenterApi.ts` | Higher-level helpers used by command-center views. |
| `client/src/lib/workflow/teamMemberWorkspaceApi.ts` | Workflow helpers consumed by Team Portals. |
| `client/src/components/portal/PortalShell.tsx` + `TeamPortalShell.tsx` | Render the call list inside the portal shell tabs. |

---

## 4. Status fields surfaced to the operator

The call list endpoint joins `scheduler_assignments` to `patient_screenings` (and optionally `patient_execution_cases`). The visible columns are roughly:

| Column | Source |
| --- | --- |
| Patient name | `patient_screenings.name` |
| DOB | `patient_screenings.dob` |
| Facility | `outreach_schedulers.facility` (with patient fallback) |
| Schedule date | `screening_batches.scheduleDate` |
| Phone | `patient_screenings.phoneNumber` |
| Qualifying tests | `patient_screenings.qualifyingTests` |
| Assigned scheduler | `outreach_schedulers.name` |
| Engagement status | `patient_execution_cases.engagementStatus` (when present) |
| Last call result | latest `outreach_calls` row for `(patient, date)` |
| Next action at | `patient_execution_cases.nextActionAt` |

---

## 5. Behavioral invariants (do not regress without an explicit batch)

1. **Morning rebuild is advisory-locked.** Two `morningRebuildScheduler` instances must not run the same `(facility, date)` in parallel.
2. **One active assignment per `(patient, date)`.** Enforced by the partial unique index `uq_scheduler_assignments_active_per_patient_day`.
3. **Status transitions:** `active → reassigned` (when handed off) | `active → completed` (when call result logged + outcome closes the call) | `active → released` (operator-initiated release).
4. **Source tracking:** `scheduler_assignments.source` is one of `auto | manual | reassigned`. Defaults to `auto`. Manual assignments via the Engagement Center bulk-assign endpoint set `manual`.
5. **Reason audit.** Reassignments and absence-driven redistributes carry a `reason` text.
6. **Mid-day inject.** `assignNewlyEligiblePatient()` creates an active row; the morning rebuild will see it on subsequent runs.

**Future read-model rule (operational-queue-design.md §3):** the unified queue treats one `scheduler_assignments` row as one `OperationalQueueItem` of kind `call_list_item`. Sort key is `(priority_score DESC, scheduledDate ASC, name)`.

---

## 6. Hidden couplings to watch

- **Absence-watcher → plexus_tasks.** When a scheduler is detected absent, a row is created in `plexus_tasks` with `taskType = "absence_alert"`. The future unified queue must show this task in the affected scheduler's queue (kind `scheduler_task` via Batch 11) AND in their backup's queue.
- **Engagement Center assign overrides scheduler assignment.** The Engagement Center bulk-assign endpoint writes `patient_execution_cases.assignedTeamMemberId` directly. The Scheduler Portal call list is derived from `scheduler_assignments`, so an Engagement Center assign does NOT immediately appear in a scheduler's call list — it appears in their **team-task surface** (Batch 11 union). The future unified queue must reconcile these in the operator UI.
- **Outreach call write side effect.** `POST /api/outreach/calls` (`server/routes/outreach.ts:151`) writes both an `outreach_calls` row AND updates `patient_screenings.appointmentStatus` AND (when result closes the call) flips the `scheduler_assignments.status` to `completed`. The future read model must read whichever signal arrives first.

---

## 7. What this map does NOT cover

- Per-call write semantics (`POST /api/outreach/calls`) — that's a write path, out of scope for a read-model design.
- The Engagement Center bulk-assign endpoint conflict-guard rules — covered separately in `protected-flows.md` §6 and the parity inventory §4.2.
- Plexus task message threads — they're a downstream of the absence-watcher and out of scope for the call-list view.

End of source map.
