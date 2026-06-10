// Operational queue — projections barrel (Batch 11d.2 / Bundle 13).
//
// Pure projection algorithm + Drizzle-bound default fetcher. Neither
// is wired to a runtime route in this batch — see
// docs/architecture/operational-queue-call-list-projection-design.md §3
// for the cutover sequence (Batches 11d.3 → 11d.5).

export {
  MISSING_ROW_LOG_PREFIX,
  projectQueueItemsToSchedulerAssignments,
  type LegacySchedulerAssignmentRowShape,
  type ProjectionLogger,
  type SchedulerAssignmentFetchByIds,
} from "./schedulerAssignment";

export { defaultFetchSchedulerAssignmentsByIds } from "./schedulerAssignmentDefaultFetcher";
