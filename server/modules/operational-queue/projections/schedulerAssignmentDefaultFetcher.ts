// Operational queue → SchedulerAssignment projection — default
// Drizzle-bound fetcher (Batch 11d.2 / Bundle 13).
//
// Lives in a separate file from ./schedulerAssignment.ts so the pure
// projection module — and the parity test that exercises it — never
// transitively pulls in the DB pool or the Drizzle schema runtime.
//
// This module is INTENTIONALLY NOT wired to any route in this batch.
// It exists so the future Batch 11d.3 route-wiring PR can adopt it
// with a single import instead of re-implementing the bulk fetch.
//
// SAFETY
//   - One bulk fetch (`WHERE id IN (...)`) per call.
//   - Read-only — no writes.
//   - Returns rows in whatever order the DB chose; the projection
//     module re-orders them into queue order.
//
// REFERENCES
//   ./schedulerAssignment.ts                                  (projection)
//   shared/schema/outreach.ts:75-103                          (table)
//   docs/architecture/operational-queue-call-list-projection-design.md §2.1
//   docs/architecture/operational-queue-call-list-projection-design.md §3 (Batch 11d.3 cutover)

import { inArray } from "drizzle-orm";
import { db } from "../../../db";
import {
  schedulerAssignments,
  type SchedulerAssignment,
} from "@shared/schema";
import type { SchedulerAssignmentFetchByIds } from "./schedulerAssignment";

/**
 * Default Drizzle-bound bulk fetcher for the projection. Pass this as
 * the `fetchByIds` argument to
 * `projectQueueItemsToSchedulerAssignments` when wiring the projection
 * into a runtime path.
 *
 * Empty input short-circuits without issuing a query — preserves the
 * "exactly one fetch when there is work to do" invariant from the
 * projection module without adding a wasted round-trip on no-op
 * invocations.
 */
export const defaultFetchSchedulerAssignmentsByIds: SchedulerAssignmentFetchByIds<SchedulerAssignment> =
  async (ids) => {
    if (ids.length === 0) return [];
    return db
      .select()
      .from(schedulerAssignments)
      .where(inArray(schedulerAssignments.id, ids));
  };
