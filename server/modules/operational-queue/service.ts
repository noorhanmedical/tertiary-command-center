// Operational queue — read-only service layer (Batch 11a).
//
// Public surface that future portal-wiring batches consume. Today no
// route imports these helpers. The module ships dormant.
//
// Sorting note: getOperationalQueueForUser/ForFacility merge multiple
// sources and sort the union by `(scheduledDate ASC, scheduledTime ASC,
// kind, id)`. Items with no scheduledDate sort to the end. This is the
// "what should I see first today" order; callers that want a different
// order should call the repo helpers directly.

import {
  listCallListItemsForUser,
  listGlobalCalendarEventsForFacility,
  listGlobalCalendarEventsForUser,
  listSchedulerTasksFromEngagementBoardForUser,
  listSchedulerTasksFromPlexusForUser,
  listVisitAppointmentsForFacility,
} from "./repo";
import type {
  OperationalQueueForFacilityFilters,
  OperationalQueueForUserFilters,
  OperationalQueueItem,
  OperationalQueueItemKind,
} from "./contracts";

const TOTAL_CAP = 1000;

function kindWanted(
  kinds: OperationalQueueItemKind[] | undefined,
  candidate: OperationalQueueItemKind,
): boolean {
  if (!kinds || kinds.length === 0) return true;
  return kinds.includes(candidate);
}

function sortQueue(items: OperationalQueueItem[]): OperationalQueueItem[] {
  return items.sort((a, b) => {
    const aDate = a.scheduledDate ?? "9999-12-31";
    const bDate = b.scheduledDate ?? "9999-12-31";
    if (aDate !== bDate) return aDate < bDate ? -1 : 1;
    const aTime = a.scheduledTime ?? "99:99";
    const bTime = b.scheduledTime ?? "99:99";
    if (aTime !== bTime) return aTime < bTime ? -1 : 1;
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.id.localeCompare(b.id);
  });
}

/**
 * Returns the unified operational queue for a single user across all four
 * sources. Default per-source limit 200; total cap 1000.
 *
 * No route consumes this today. Future portal cutover batches (11b–11e)
 * call this helper. See operational-queue-design.md §7.
 */
export async function getOperationalQueueForUser(
  userId: string,
  filters: OperationalQueueForUserFilters = {},
  perSourceLimit?: number,
): Promise<OperationalQueueItem[]> {
  const tasks: Array<Promise<OperationalQueueItem[]>> = [];

  if (kindWanted(filters.kinds, "call_list_item")) {
    tasks.push(listCallListItemsForUser(userId, filters, perSourceLimit));
  }
  if (kindWanted(filters.kinds, "scheduler_task")) {
    tasks.push(
      listSchedulerTasksFromPlexusForUser(userId, filters, perSourceLimit),
    );
    tasks.push(
      listSchedulerTasksFromEngagementBoardForUser(
        userId,
        filters,
        perSourceLimit,
      ),
    );
  }
  if (kindWanted(filters.kinds, "global_calendar_event")) {
    tasks.push(listGlobalCalendarEventsForUser(userId, filters, perSourceLimit));
  }
  // visit_appointment is intentionally facility-scoped today; if a caller
  // really wants user-scoped visit appointments, they need to compose
  // ForFacility helpers themselves.

  const settled = await Promise.all(tasks);
  const merged = settled.flat();
  const sorted = sortQueue(merged);
  return sorted.slice(0, TOTAL_CAP);
}

/**
 * Facility-scoped variant. Used by team-ops + global-calendar surfaces.
 * No assignee filter.
 */
export async function getOperationalQueueForFacility(
  facility: string,
  filters: OperationalQueueForFacilityFilters = {},
  perSourceLimit?: number,
): Promise<OperationalQueueItem[]> {
  const tasks: Array<Promise<OperationalQueueItem[]>> = [];

  if (kindWanted(filters.kinds, "visit_appointment")) {
    tasks.push(
      listVisitAppointmentsForFacility(facility, filters, perSourceLimit),
    );
  }
  if (kindWanted(filters.kinds, "global_calendar_event")) {
    tasks.push(
      listGlobalCalendarEventsForFacility(facility, filters, perSourceLimit),
    );
  }
  // call_list_item and scheduler_task are user-scoped today; future
  // batches may add facility-wide variants when team-ops dashboards
  // surface them.

  const settled = await Promise.all(tasks);
  const merged = settled.flat();
  const sorted = sortQueue(merged);
  return sorted.slice(0, TOTAL_CAP);
}
