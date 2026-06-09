# Operational queue — unified read-model design (Batch 11a)

**Branch:** `architecture/batch-11a-operational-queue-foundation`
**Date:** 2026-06-09
**Scope:** Server-only additive read model + design doc. Zero schema change. Zero migration. Zero route registration. Zero portal cutover. Existing endpoints continue serving their current UIs unchanged.

> Cross-reference: `call-list-source-map.md`, `scheduler-task-source-map.md`, `visit-schedule-source-map.md`, `global-calendar-source-map.md`, `team-task-spine-design.md` (Batch 11), `patient-directory-design.md` (Batch 5), `full-21-batch-orchestrator-review.md`.

---

## 1. Why this needs to happen

Today there are at least **four distinct read surfaces** that each portal/page assembles independently:

1. **Call list** — `/api/portal/outreach-call-list` (scheduler portal).
2. **Scheduler tasks** — `/api/plexus/tasks/my-work` + engagement-board rows + scheduling-triage + billing-readiness.
3. **Visit schedule** — `/api/portal/today-schedule` (clinic day-of view).
4. **Global calendar** — `/api/global-schedule-events` (multi-facility executive view).

Each of these joins its own subset of `patient_screenings`, `patient_execution_cases`, `outreach_schedulers`, `scheduler_assignments`, `ancillary_appointments`, `global_schedule_events`, `plexus_tasks`. The shapes differ; the discriminators differ; the status vocabularies differ.

The user-stated goals are:

- *"Team Portals are properly wired"* — requires one read model the portal can consume.
- *"call lists populate from Engagement Center assignments"* — requires the engagement-board → call-list bridge.
- *"visit schedules work"* — requires the schedule view to read from the same canonical model.
- *"global calendar works"* — same.
- *"schedules and calendars should come from canonical operational data"* — requires a single typed read model.

**This batch ships the foundation:** four discovery docs + a server-only `OperationalQueueItem` read model that unifies all four surfaces. Routes continue to read their existing endpoints; the unified model is consumed by zero callers in this batch. Future batches (11b–11e) wire one portal at a time.

---

## 2. What ships in this batch

### Docs (5 new files)

- `call-list-source-map.md` — every file/endpoint contributing to the call list.
- `scheduler-task-source-map.md` — five task sources documented (plexus_tasks, scheduler_assignments, engagement-board, scheduling-triage, billing-readiness).
- `visit-schedule-source-map.md` — `/api/portal/today-schedule` + technician-liaison + ultrasound-tech surfaces.
- `global-calendar-source-map.md` — `/api/global-schedule-events` + calendar-summary surfaces.
- `operational-queue-design.md` — this doc.

### Server module (4 files; **unwired**)

- `server/modules/operational-queue/contracts.ts` — `OperationalQueueItem` discriminated union covering four kinds (call_list_item, scheduler_task, visit_appointment, global_calendar_event). Filter / scope inputs.
- `server/modules/operational-queue/repo.ts` — four read queries, one per source. Each maps to `OperationalQueueItem`.
- `server/modules/operational-queue/service.ts` — `getOperationalQueueForUser(userId, filters)` and `getOperationalQueueForFacility(facility, filters)` public helpers.
- `server/modules/operational-queue/index.ts` — barrel.

### Optional parity-test fixture

- `server/modules/operational-queue/__tests__/parity.test.ts` — assertion that the union of per-source counts equals what each existing endpoint returns for a canned `(user, facility)` pair. Runnable via `npx tsx`. **NOT wired to CI.** The fixture uses fictional data inline; no DB connection required for the structural assertions.

### Zero changes elsewhere

- No `server/routes/*.ts` modified.
- No `server/services/*.ts` modified.
- No `shared/schema/*.ts` modified.
- No migration created.
- No client/ file modified.
- No `package.json` / `package-lock.json` modified.

---

## 3. The unified shape

```ts
type OperationalQueueItemKind =
  | "call_list_item"        // scheduler_assignments row
  | "scheduler_task"        // plexus_tasks row, or engagement-board row
  | "visit_appointment"     // ancillary_appointments row
  | "global_calendar_event" // global_schedule_events row

type OperationalQueueItem = {
  // Composite source-prefixed id (`cl:<n>`, `st:<n>`, `va:<n>`, `gc:<n>`).
  id: string;
  kind: OperationalQueueItemKind;
  ownerType: "scheduler_assignment" | "plexus_task" | "engagement_case"
           | "ancillary_appointment" | "global_schedule_event";
  ownerId: number;
  // Who owns this item (when scoped to a user).
  assigneeUserId: string | null;
  assigneeName: string | null;
  // Patient context.
  patientScreeningId: number | null;
  patientName: string | null;
  patientDob: string | null;
  // Spatial / temporal scope.
  facility: string | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  // Status as the SOURCE returns it. NOT normalized across sources.
  status: string;
  isOpen: boolean; // derived: true when the source considers the item actionable
  // Per-source extra fields collapsed into one optional metadata blob.
  metadata: Record<string, unknown> | null;
  // Timestamps.
  createdAt: Date;
  updatedAt: Date | null;
};
```

Key design rules:

- **`id` is a composite source-prefixed string.** Prevents numeric collisions across sources (same pattern as Batch 11's `TeamTask` and Batch 5's `CanonicalPatient`).
- **`status` is the raw text from the source.** No normalization. See the source maps for per-source vocabularies. `isOpen` is the derived "is this actionable?" boolean — that's the only normalization.
- **`assigneeUserId` is nullable.** Many `global_schedule_events` rows have no individual owner (they're facility-scoped). Many `scheduler_assignments` link to a scheduler via `outreach_schedulers.userId` which may itself be null.
- **`metadata` is the catch-all** for per-source extras (e.g., `plexus_tasks.priority`, `scheduler_assignments.source`, `global_schedule_events.kind`).

---

## 4. Source-to-`OperationalQueueItem` mapping

| Source row | Kind | Notes |
| --- | --- | --- |
| `scheduler_assignments` (status = active) | `call_list_item` | `assigneeUserId` from joined `outreach_schedulers.userId`. `scheduledDate = asOfDate`. |
| `plexus_tasks` (status NOT IN done/closed) | `scheduler_task` | Joined to project (facility) + assigned user. |
| `patient_execution_cases` (assignedTeamMemberId is not null AND lifecycleStatus = active AND engagementStatus NOT IN closed/completed/cancelled/archived) | `scheduler_task` | The engagement-board → task bridge. **This is the operative wiring the user requested.** |
| `ancillary_appointments` (scheduledDate = today; filterable to a date range) | `visit_appointment` | Per appointment row, not per patient. |
| `global_schedule_events` (filterable to a date range; kind != team_availability for the operational view) | `global_calendar_event` | Includes clinic_visit + ancillary kinds. Excludes team_availability by default in the operator-facing helpers. |

---

## 5. Public service surface

```ts
// server/modules/operational-queue/service.ts

/**
 * Returns the unified operational queue for a single user across all four sources.
 * Sorted by (scheduledDate ASC, scheduledTime ASC, kind, id). Default limit per
 * source: 200. Total cap: 1000.
 */
function getOperationalQueueForUser(
  userId: string,
  filters: {
    facility?: string;
    dateFrom?: string;  // YYYY-MM-DD
    dateTo?: string;
    includeClosed?: boolean;  // default false
    kinds?: OperationalQueueItemKind[];  // default: all
  },
  limit?: number,
): Promise<OperationalQueueItem[]>;

/**
 * Facility-scoped variant — used by team-ops and global-calendar views.
 * No assigneeUserId filter. Otherwise identical.
 */
function getOperationalQueueForFacility(
  facility: string,
  filters: {
    dateFrom?: string;
    dateTo?: string;
    includeClosed?: boolean;
    kinds?: OperationalQueueItemKind[];
  },
  limit?: number,
): Promise<OperationalQueueItem[]>;
```

---

## 6. The Engagement-Center → call-list bridge

The user explicitly named this requirement: *"call lists populate from Engagement Center assignments"*.

Mapping in this batch:

- An Engagement-Center assignment that's tied to a `scheduler_assignments` row appears in the unified queue as kind `call_list_item` (one item).
- An Engagement-Center assignment WITHOUT a corresponding `scheduler_assignments` row (e.g., the engagement-board bulk-assign writes `patient_execution_cases.assignedTeamMemberId` directly) appears as kind `scheduler_task` (so the assignee sees it even when the morning rebuild hasn't run yet).
- A future batch (11b) introduces a write-side helper that, on engagement-board bulk-assign, ALSO writes the `scheduler_assignments` row for the matching scheduler if the assignment is `(facility, scheduleDate)`-resolvable. This is the "make the call list populate from the assignment" plumbing — **not in this batch**.

This batch's read model SURFACES both situations correctly; it doesn't make engagement-board writes auto-create scheduler assignments.

---

## 7. Cutover plan (multi-batch)

| Phase | Ships |
| --- | --- |
| **11a (this batch)** | Module + design + source maps. Zero portal cutover. |
| **11b** | Additive endpoint `GET /api/operational-queue/me` + parity tests against existing portal endpoints for one canned `(user, facility)`. UI not switched. |
| **11c** | Engagement-Center → scheduler-assignments write-side helper (on bulk-assign, create scheduler_assignments row when `(facility, scheduleDate)` resolves). Behind `ENGAGEMENT_TO_CALL_LIST_BRIDGE` flag. Defaults OFF. |
| **11d** | Switch Scheduler Portal to read from `/api/operational-queue/me?kinds=call_list_item`. Visual + functional regression. |
| **11e** | Switch Team Portal "My Tasks" tab to read from `/api/operational-queue/me?kinds=scheduler_task`. |
| **11f** | Switch Visit Schedule + Global Calendar views to read from `getOperationalQueueForFacility`. |
| **11g** | Add cross-source aggregates / "what's left today" widget. |

Each phase is a separate PR with its own approval.

---

## 8. Compatibility rules (load-bearing — do not regress)

- **No writes.** Every helper in this module is read-only. Phase 11c+ may introduce writes, but only behind a flag.
- **No existing endpoint replaced.** All current portal/calendar endpoints stay registered with their current shapes.
- **No schema change.** No new column, no new index, no migration.
- **No client change.** No UI re-design. Future portal-cutover phases (11d–11f) update one client at a time.
- **No qualification logic touched.** Read model never reads `reasoning` or `qualifyingTests` (those are presented as opaque arrays/blobs by upstream endpoints — this module doesn't peek inside).
- **No Admin Review touched.** The unified queue does not surface admin-approval state directly.
- **No PDFs touched.**
- **No scheduler-assignment write behavior changed.** Read joins to `scheduler_assignments`; writes stay in `schedulerAutoAssign.ts` + `morningRebuildScheduler.ts`.
- **No billing money / claim logic touched.**

---

## 9. Hard protected areas — verification

| Area | Touched by this batch? | Why |
| --- | --- | --- |
| Patient qualification logic | no | Module reads scheduling joins only. |
| Plexus IQ qualification flow | no | Untouched. |
| Plexus IQ import | no | Untouched. |
| Admin Review reasoning behavior | no | Module never reads reasoning. |
| Supporting button assignment logic | no | Unaffected. |
| Canonical reasoning shape | no | Unaffected. |
| Plexus packets / Clinician packets / PDFs | no | PDF code untouched. |
| Selected patient PDF actions | no | Untouched. |
| Scheduler-to-patient assignment correctness | no | Module reads; writes stay on existing paths. |
| Patient-to-scheduler assignment persistence | no | No writes. |
| Report/document source data used by PDFs | no | Untouched. |
| Billing / invoice correctness | no | Module never touches billing tables. |

---

## 10. Risks acknowledged

- **In-memory cross-source merge.** The service runs 1–4 queries per call and merges in code. For typical user volumes (one user, one date range, ≤200 rows per source) this is well within a single response budget. The phase 11b parity tests will surface any user with anomalous queue size.
- **Status text drift.** Same issue called out in Batch 11's team-task design doc §10. The raw status is preserved; `isOpen` abstracts the "actionable" question; portals must defensively handle unknown status text.
- **Patient-context joins.** Each source needs a `patient_screenings` join for name/dob/facility-fallback. The cost is small but not free; phase 11b's parity test should capture per-source latency.
- **Engagement-board overlap.** A patient whose `patient_execution_cases.assignedTeamMemberId` matches the user AND who ALSO has an active `scheduler_assignments` row produces TWO `OperationalQueueItem`s (one `scheduler_task`, one `call_list_item`). This is the correct surfacing today — both are real obligations — but portals MUST de-duplicate visually if they choose to.
- **Time-zone.** Until Batch 6's `facilities.timezone` ships, `scheduledDate` is interpreted in the route's local time. The unified queue inherits this caveat.

---

## 11. Rollback plan

`git rm -r server/modules/operational-queue/` + `git rm` the 5 docs. Zero runtime state to unwind. No table, no migration, no consumer.

---

## 12. Stop conditions for follow-up phases

A future batch in this cutover MUST stop and ask if:

1. Any cutover changes the order of items shown vs. the existing endpoint for the same `(user, facility, date)` without an explicit feature-flagged opt-in.
2. Any portal cutover replaces the existing endpoint with the unified one in the same PR. Pattern: ship the unified endpoint additively first, switch a single portal, soak, then switch the next.
3. The Engagement-Center → call-list bridge (phase 11c) writes to `scheduler_assignments` outside the morning-rebuild advisory-lock semantics.
4. Any phase changes `outreach_schedulers.userId` resolution semantics — that join is load-bearing for several sources.
5. Any cutover removes the existing endpoint before its consumers are off it. Existing endpoints stay registered until phase 11g's "what's left today" rollout proves zero callers remain.

End of design.
