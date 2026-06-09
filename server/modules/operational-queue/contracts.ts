// Operational queue — type contracts (Batch 11a).
//
// Read-only union view across four work sources that together drive the
// Team Portal + Scheduler Portal + Visit Schedule + Global Calendar
// surfaces:
//
//   1. call_list_item        ← scheduler_assignments
//   2. scheduler_task        ← plexus_tasks AND engagement-board rows
//                             (patient_execution_cases.assignedTeamMemberId)
//   3. visit_appointment     ← ancillary_appointments
//   4. global_calendar_event ← global_schedule_events
//
// This module is INTENTIONALLY read-only and INTENTIONALLY not wired to
// any route in this batch. Source detail per surface lives in:
//   - docs/architecture/call-list-source-map.md
//   - docs/architecture/scheduler-task-source-map.md
//   - docs/architecture/visit-schedule-source-map.md
//   - docs/architecture/global-calendar-source-map.md
//
// Design rationale: docs/architecture/operational-queue-design.md.
// Cutover plan: phases 11b–11g in the design doc §7.

export const OPERATIONAL_QUEUE_ITEM_KINDS = [
  "call_list_item",
  "scheduler_task",
  "visit_appointment",
  "global_calendar_event",
] as const;

export type OperationalQueueItemKind =
  (typeof OPERATIONAL_QUEUE_ITEM_KINDS)[number];

export const OPERATIONAL_QUEUE_OWNER_TYPES = [
  "scheduler_assignment",
  "plexus_task",
  "engagement_case",
  "ancillary_appointment",
  "global_schedule_event",
] as const;

export type OperationalQueueOwnerType =
  (typeof OPERATIONAL_QUEUE_OWNER_TYPES)[number];

/**
 * The unified work-queue item.
 *
 * `id` is a composite source-prefixed string (`cl:<n>` | `st-pt:<n>` |
 * `st-ec:<n>` | `va:<n>` | `gc:<n>`) so a single response can carry items
 * from all four sources without numeric collisions. Callers that need
 * the raw source-table row id use `ownerId`.
 *
 * `status` is the raw text from the underlying source — NOT normalized
 * across sources (the four vocabularies serve different domains).
 * `isOpen` is the only derived/normalized field.
 */
export type OperationalQueueItem = {
  id: string;
  kind: OperationalQueueItemKind;
  ownerType: OperationalQueueOwnerType;
  ownerId: number;

  // Assignee context — null on facility-scoped events with no individual
  // owner (e.g. many global_schedule_events rows).
  assigneeUserId: string | null;
  assigneeName: string | null;

  // Patient context — null when the item is not patient-scoped.
  patientScreeningId: number | null;
  patientName: string | null;
  patientDob: string | null;

  // Spatial / temporal scope. All nullable because each source resolves
  // these differently (see operational-queue-design.md §4).
  facility: string | null;
  scheduledDate: string | null;
  scheduledTime: string | null;

  // Raw source status text, plus the derived "is actionable today" boolean.
  status: string;
  isOpen: boolean;

  // Per-source extras (priority, urgency, callback hours, etc.).
  metadata: Record<string, unknown> | null;

  createdAt: Date;
  updatedAt: Date | null;
};

// ────────────────────────────────────────────────────────────────────────
// Query/filter input shapes
// ────────────────────────────────────────────────────────────────────────

export type OperationalQueueDateRange = {
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD
};

/**
 * Filters for the per-user queue.
 *
 * - `facility`: matches the per-source facility field (see source maps
 *   for the per-source resolution rules).
 * - `dateFrom` / `dateTo`: limits scheduledDate; items with no
 *   scheduledDate (e.g. some scheduler_task rows) are returned when the
 *   filter is absent, and filtered out when present.
 * - `includeClosed`: when false (default), each source's "closed" rows
 *   are filtered out (see service.ts for the per-source rules).
 * - `kinds`: limit which sources contribute. Defaults to all four.
 */
export type OperationalQueueForUserFilters = OperationalQueueDateRange & {
  facility?: string;
  includeClosed?: boolean;
  kinds?: OperationalQueueItemKind[];
};

/**
 * Filters for the per-facility queue. Same as the user filter minus
 * the user-scoping. Used by team-ops and the global-calendar surface.
 */
export type OperationalQueueForFacilityFilters = OperationalQueueDateRange & {
  includeClosed?: boolean;
  kinds?: OperationalQueueItemKind[];
};
