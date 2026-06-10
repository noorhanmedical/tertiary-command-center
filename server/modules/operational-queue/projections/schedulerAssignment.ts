// Operational queue → SchedulerAssignment projection module
// (Batch 11d.2 / Bundle 13).
//
// Lifts the reference algorithm from
// server/modules/operational-queue/__tests__/projection-parity.test.ts
// (Bundle 12 / PR #94) into a real, importable module.
//
// PURPOSE
//   Project `OperationalQueueItem` rows of kind "call_list_item" into
//   the legacy `SchedulerAssignment[]` shape consumed by
//   GET /api/scheduler-assignments. The projection is the load-bearing
//   piece that lets a future Batch 11d.3 PR flip
//   USE_OPERATIONAL_QUEUE_CALL_LIST from shadow-read to fully-pivoted
//   without changing the response body.
//
//   This module is INTENTIONALLY NOT wired to any route in this batch.
//   The legacy `GET /api/scheduler-assignments` handler in
//   server/routes/schedulerAssignments.ts continues to respond with the
//   direct-query rows; the flag default stays OFF.
//
// SAFETY INVARIANTS (mirrors the design doc §2.2)
//   - NEVER throws on partial results — missing rows are dropped.
//   - NEVER mutates the input items array.
//   - ALWAYS returns rows in queue order (not DB order).
//   - Performs EXACTLY one bulk fetch (the injected `fetchByIds`
//     callback is invoked at most once per call).
//   - Read-only — no writes to any table.
//
// PHI SAFETY
//   The only log line this module emits is the missing-row counter,
//   and it carries counts only — never ownerIds, patient names, DOBs,
//   or any other identifier. See §2.3 of the design doc.
//
// CALLER CONTRACT
//   This module is pure and does NOT import the DB pool, the Drizzle
//   schema, or any service-layer module. The caller injects a
//   `fetchByIds` function that performs the actual bulk fetch (a
//   default Drizzle-bound implementation lives in
//   ./schedulerAssignmentDefaultFetcher.ts and is intended for the
//   future runtime wiring PR). Keeping the algorithm pure means the
//   parity test under
//   server/modules/operational-queue/__tests__/projection-parity.test.ts
//   can run with zero DB dependency.
//
// REFERENCES
//   docs/architecture/operational-queue-call-list-projection-design.md
//   server/modules/operational-queue/contracts.ts
//   shared/schema/outreach.ts:75-103   (legacy SchedulerAssignment row)

import type { OperationalQueueItem } from "../contracts";

/**
 * Structural shape of a legacy `scheduler_assignments` row. Mirrors
 * `SchedulerAssignment` from shared/schema/outreach.ts:114 without
 * importing it — keeps this module free of any schema runtime cost
 * and lets the parity test run without pulling in Drizzle.
 *
 * Callers that already have `SchedulerAssignment` from the schema can
 * pass it as `TRow` to `projectQueueItemsToSchedulerAssignments` and
 * get `SchedulerAssignment[]` back — TypeScript structural typing
 * keeps the two shapes interchangeable.
 *
 * SOURCE: shared/schema/outreach.ts:75-103 + :114
 */
export type LegacySchedulerAssignmentRowShape = {
  id: number;
  patientScreeningId: number;
  schedulerId: number;
  asOfDate: string;
  assignedAt: Date;
  source: string;
  originalSchedulerId: number | null;
  reason: string | null;
  status: string;
  completedAt: Date | null;
};

/**
 * Bulk-fetch callback. The projection calls it AT MOST ONCE per
 * invocation, with the deduplicated, queue-order ownerId list as
 * input. Implementations MUST return only rows whose id is in the
 * requested list; the projection will silently drop any input id that
 * has no matching row (the "race between queue read and bulk fetch"
 * case described in the design doc §2.1).
 *
 * The default Drizzle-bound implementation lives in
 * ./schedulerAssignmentDefaultFetcher.ts.
 */
export type SchedulerAssignmentFetchByIds<
  TRow extends LegacySchedulerAssignmentRowShape = LegacySchedulerAssignmentRowShape,
> = (ids: number[]) => Promise<TRow[]>;

/**
 * Optional PHI-safe logger. Defaults to `console.log`. The projection
 * emits at most one log line per invocation, and only when at least
 * one ownerId could not be matched to a fetched row.
 */
export type ProjectionLogger = (line: string) => void;

/**
 * The canonical PHI-safe missing-row log prefix. Pinned by both the
 * parity test and the docs-integrity QA script so any drift fails CI.
 */
export const MISSING_ROW_LOG_PREFIX =
  "[operational-queue/projection/schedulerAssignment] missing_row" as const;

/**
 * Project a list of `OperationalQueueItem` rows into the legacy
 * `SchedulerAssignment[]` shape.
 *
 * Behavior (mirrors design doc §2.1):
 *   1. Filter input to `kind === "call_list_item"`.
 *   2. Extract `ownerId` values, preserving the queue order.
 *   3. Bulk fetch the matching rows via `fetchByIds` (one call only).
 *   4. Map fetched rows back into queue order. Rows whose ownerId has
 *      no matching fetched row are dropped (race condition).
 *   5. If any rows were dropped, emit ONE PHI-safe log line carrying
 *      counts only.
 *
 * @param items     The unified-queue items to project. Not mutated.
 * @param fetchByIds The bulk fetch callback. Called at most once.
 * @param logger    Optional logger. Defaults to `console.log`.
 */
export async function projectQueueItemsToSchedulerAssignments<
  TRow extends LegacySchedulerAssignmentRowShape,
>(
  items: ReadonlyArray<OperationalQueueItem>,
  fetchByIds: SchedulerAssignmentFetchByIds<TRow>,
  logger: ProjectionLogger = (line) => console.log(line),
): Promise<TRow[]> {
  // (1) Filter to call_list_item.
  const callListItems: OperationalQueueItem[] = [];
  for (const item of items) {
    if (item.kind === "call_list_item") callListItems.push(item);
  }
  if (callListItems.length === 0) return [];

  // (2) Extract ownerIds in queue order. Deduplicate for the fetch
  //     while preserving first-seen order in the queue-order array
  //     used to build the output.
  const orderedOwnerIds: number[] = callListItems.map((i) => i.ownerId);
  const uniqueOwnerIds: number[] = [];
  const seen = new Set<number>();
  for (const id of orderedOwnerIds) {
    if (!seen.has(id)) {
      seen.add(id);
      uniqueOwnerIds.push(id);
    }
  }

  // (3) Bulk fetch — exactly one call.
  const rows = await fetchByIds(uniqueOwnerIds);
  const byId = new Map<number, TRow>();
  for (const r of rows) byId.set(r.id, r);

  // (4) Map back in queue order, dropping any missing ids.
  const out: TRow[] = [];
  let dropped = 0;
  for (const id of orderedOwnerIds) {
    const hit = byId.get(id);
    if (hit) out.push(hit);
    else dropped += 1;
  }

  // (5) PHI-safe missing-row log. Counts only.
  if (dropped > 0) {
    logger(
      `${MISSING_ROW_LOG_PREFIX} ` +
        `{ requested: ${uniqueOwnerIds.length}, found: ${rows.length}, missing: ${dropped} }`,
    );
  }

  return out;
}
