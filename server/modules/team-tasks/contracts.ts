// Team-task spine — type contracts.
//
// Read-only union view across the two parallel "task" models that exist
// today in this codebase:
//   1. plexus_tasks               (shared/schema/plexus.ts:23-47)
//   2. scheduler_assignments      (shared/schema/outreach.ts:75-102)
//
// This module is INTENTIONALLY read-only and INTENTIONALLY not wired to
// any route or portal in this batch. It exists so future portal-wiring
// batches (orchestrator Batches 13/14/15) have a single typed shape to
// consume.
//
// See server/modules/team-tasks/repo.ts for the source-to-TeamTask
// mappings and docs/architecture/team-task-spine-design.md for the
// rationale + cutover plan.

export const TEAM_TASK_OWNER_TYPES = [
  "plexus_task",
  "scheduler_assignment",
] as const;

export type TeamTaskOwnerType = (typeof TEAM_TASK_OWNER_TYPES)[number];

/**
 * Unified task shape across plexus_tasks and scheduler_assignments.
 *
 * Naming choice: `id` is a *composite source-prefixed string* (`"pt:42"` or
 * `"sa:17"`) so a single list can hold both kinds without numeric collisions.
 * Callers that need the raw row id use `ownerId` instead.
 */
export type TeamTask = {
  // Composite identifier: `${ownerType[0..2]}:${ownerId}`.
  // Example: `"pt:42"` for plexus_tasks.id=42, `"sa:17"` for scheduler_assignments.id=17.
  id: string;
  ownerType: TeamTaskOwnerType;
  ownerId: number;

  // Assignee fields. For plexus_task: assignedToUserId.
  // For scheduler_assignment: derived from the scheduler (an outreach_schedulers
  // row); the userId may be null if the scheduler isn't tied to a user row.
  assigneeUserId: string | null;
  assigneeName: string | null;
  schedulerId: number | null;

  // Patient + facility context. Both nullable because plexus_tasks can be
  // unscoped (project-level) and scheduler_assignments always have a patient
  // but facility comes from the scheduler row (joined in the repo).
  patientScreeningId: number | null;
  facility: string | null;

  // Status as a free-form text column (plexus_tasks.status and
  // scheduler_assignments.status are both `text`). The two sources use
  // different vocabularies; this module does NOT normalize them. See the
  // design doc §5 for the per-source status enums.
  status: string;

  // plexus_task fields (null for scheduler_assignment source rows).
  title: string | null;
  description: string | null;
  taskType: string | null;
  urgency: string | null;
  priority: string | null;
  parentTaskId: number | null;
  projectId: number | null;
  batchId: number | null;
  dueAt: string | null; // plexus_tasks.dueDate (text column, not a timestamp)

  // scheduler_assignment fields (null for plexus_task source rows).
  source: string | null; // scheduler_assignments.source ("auto" | "manual" | "reassigned")
  asOfDate: string | null;
  originalSchedulerId: number | null;
  reason: string | null;
  completedAt: Date | null;

  // Timestamps. createdAt is always present (both sources have it under
  // different column names — `created_at` vs `assigned_at`).
  createdAt: Date;
  updatedAt: Date | null;
};

// ────────────────────────────────────────────────────────────────────────
// Query/filter input shapes
// ────────────────────────────────────────────────────────────────────────

/**
 * Filters for listing team tasks for a given user. Both filters are AND-ed.
 * - `facility`: matches plexus_tasks via `plexus_projects.facility` (when
 *    the task has a project) AND scheduler_assignments via the scheduler's
 *    `outreach_schedulers.facility`. The exact join semantics are
 *    documented in repo.ts.
 * - `includeCompleted`: when false (the default), excludes
 *    plexus_tasks with status `"done"` / `"closed"` and
 *    scheduler_assignments with status `"completed"` / `"released"`.
 */
export type ListTeamTasksForUserFilters = {
  facility?: string;
  includeCompleted?: boolean;
};

/**
 * Filters for listing team tasks tied to a specific patient.
 * - `ownerType`: optional restriction to one source.
 */
export type ListTeamTasksByPatientFilters = {
  ownerType?: TeamTaskOwnerType;
  includeCompleted?: boolean;
};
