# Operational Queue → SchedulerAssignment projection design

**Date:** 2026-06-09
**Scope:** READ-ONLY design doc. No source code changed by this doc.
**Purpose:** Define the projection layer that the future Batch 11d.2 PR will add so the operational-queue read path can return the legacy `SchedulerAssignment[]` shape from `GET /api/scheduler-assignments` without changing the response body. **No pivot in this PR. No UI cutover.**

> Cross-reference: `operational-queue-design.md`, `call-list-source-map.md`, `portals-route-parity-inventory.md` §2, `canonical-workflow-wiring-map.md` §15, PR #80 (the shadow-read flag added by Batch 11d).

---

## 0. How this document is used

Every operational-queue cutover PR after Batch 11d.2 cites the relevant §-number from this doc. The projection is the load-bearing piece that lets `USE_OPERATIONAL_QUEUE_CALL_LIST=1` go from shadow-read to fully-pivoted without a visible API change.

---

## 1. Why a projection layer is required

`OperationalQueueItem` (defined in `server/modules/operational-queue/contracts.ts`) does NOT round-trip every field that `SchedulerAssignment` carries:

| `SchedulerAssignment` field | Present in `OperationalQueueItem`? | Where it lives today |
| --- | --- | --- |
| `id` (number) | yes — as `ownerId` | direct mapping |
| `patientScreeningId` | yes | direct mapping |
| `schedulerId` (numeric outreach_schedulers id) | **NO** | `OperationalQueueItem` carries `assigneeUserId: string` instead |
| `asOfDate` | yes — as `scheduledDate` | direct mapping |
| `assignedAt` (Date) | **NO** | not preserved; only `createdAt: Date` on the queue item |
| `source` | only inside `metadata.source` | requires explicit extraction |
| `originalSchedulerId` | **NO** | not preserved |
| `reason` | **NO** | not preserved |
| `status` | yes | direct mapping |
| `completedAt` | **NO** | not preserved |

Five fields are **lossy** through the unified queue model: `schedulerId`, `assignedAt`, `originalSchedulerId`, `reason`, `completedAt`. The projection layer's job is to fill them back in.

---

## 2. Projection contract

`projectQueueItemsToSchedulerAssignments(items: OperationalQueueItem[]): Promise<SchedulerAssignment[]>` lives in `server/modules/operational-queue/projections/schedulerAssignment.ts` (path reserved; not created in this PR).

### 2.1 Behavior

1. **Filter** to `kind === "call_list_item"` items (drop everything else).
2. **Extract** `ownerId` values into a numeric array.
3. **Bulk fetch** the matching `scheduler_assignments` rows in one query (`WHERE id IN (...)`). This is the trade-off: the projection makes ONE extra round-trip to recover the lossy fields.
4. **Map** by id and return the rows in the operational-queue's sort order (preserves the unified-queue sort that legacy callers don't get today, which is itself an improvement — but the response BODY shape is byte-stable).
5. **Drop** any `ownerId` whose `scheduler_assignments` row has gone missing (race condition where the row was deleted between the queue read and the bulk fetch). Logged PHI-safely as `[projection] missing_row` with the ownerId count.

### 2.2 Invariants

- The function NEVER throws on partial results. Missing rows are dropped with a PHI-safe log.
- The function NEVER mutates the input items array.
- The function ALWAYS returns rows in queue order (not DB order).
- The function performs EXACTLY one DB query (the bulk fetch). No N+1.
- The function is **read-only** — no writes to any table.

### 2.3 PHI safety

The log line is:

```
[operational-queue/projection/schedulerAssignment] missing_row
  { requested: N, found: M, missing: N-M }
```

Counts only. Never ownerIds, never patient names, never DOBs.

---

## 3. Cutover sequence (Batch 11d.2 → 11d.3)

**Batch 11d** (already shipped, PR #80) — shadow-read flag instrumented; legacy `res.json(rows)` is the only response path.

**Batch 11d.2** — adds:
1. `server/modules/operational-queue/projections/schedulerAssignment.ts` (this design's contract).
2. A unit test that asserts: same input → same output set, lossy fields preserved, missing-row drop semantics, sort-order preservation.
3. NO route change. Flag-OFF and flag-ON behavior stays as today (shadow-read only).

**Batch 11d.3** — flips the response source when `USE_OPERATIONAL_QUEUE_CALL_LIST=1`:
- Flag OFF: legacy path. Byte-identical to today.
- Flag ON: call `getOperationalQueueForUser(...)` → `projectQueueItemsToSchedulerAssignments(...)` → `res.json(projected)`. Response shape unchanged.

**Batch 11d.4** — once a production observation window confirms parity (e.g., 14 days of `parityMatch: true` from the shadow-read log), the legacy code path is removed and the flag becomes a no-op (deletion follows in 11d.5).

---

## 4. Verification gates between batches

Before 11d.2 → 11d.3:
- Shadow-read log shows `parityMatch: true` for ≥ 7 consecutive days in production AND staging.
- `inLegacyOnly + inQueueOnly < 0.1%` of the average daily `legacyCount`.

Before 11d.3 → 11d.4:
- 14 consecutive days of `parityMatch: true` after the flag flipped ON in production.
- Zero `[projection] missing_row` log lines during the 14-day window.

Before 11d.4 → 11d.5:
- 7 days with the flag forcibly OFF (rollback drill).
- Then 30 days at flag ON before the legacy path is deleted.

These windows are intentionally conservative — the call list is read by every scheduler every morning, so a parity miss is high-blast-radius.

---

## 5. Stop conditions

A future operational-queue PR MUST stop and ask if:

1. The projection layer is built into `service.ts` instead of `projections/schedulerAssignment.ts` (separation of concerns; the service is for unified-queue semantics, the projection is shape-preservation).
2. The projection performs more than one DB query (the bulk-fetch invariant is the whole point — N+1 here is a perf incident).
3. Missing rows would CRASH instead of being dropped (the operational-queue cap is 1000, so a single missing row should not 500 the whole response).
4. The verification gate windows above are shortened without an explicit risk write-up.
5. The projection ever WRITES (writes belong in their own service, not in a read-side shape-preserver).

End of design.
