// Team-task spine — read-only service layer.
//
// Thin wrapper over repo.ts. The two helpers exported here are the public
// service surface; future portal/route wiring will consume these (and
// these only).
//
// Sorting note: getTeamTaskView merges plexus_tasks and scheduler_assignments
// and sorts the union by createdAt DESC. This is a deterministic ordering
// across both sources; callers needing per-source ordering should call
// the repo helpers directly.

import {
  listPlexusTasksForUser,
  listSchedulerAssignmentsForUser,
  listTeamTasksByPatient,
} from "./repo";
import type {
  ListTeamTasksByPatientFilters,
  ListTeamTasksForUserFilters,
  TeamTask,
} from "./contracts";

/**
 * Returns the unified team-task view for a user across BOTH sources.
 * The result is sorted by createdAt DESC.
 *
 * This is the function future portal wiring will consume. Today it is
 * not called from any route.
 */
export async function getTeamTaskView(
  userId: string,
  filters: ListTeamTasksForUserFilters = {},
  limit?: number,
): Promise<TeamTask[]> {
  const [plexus, scheduler] = await Promise.all([
    listPlexusTasksForUser(userId, filters, limit),
    listSchedulerAssignmentsForUser(userId, filters, limit),
  ]);
  const combined = [...plexus, ...scheduler];
  combined.sort((a, b) => {
    const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
    const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
    return bTime - aTime;
  });
  return combined;
}

/**
 * Returns the unified team-task view for a single patient_screenings row,
 * across both sources. Useful for the future "patient-centric" task lists
 * in team-portal patient detail panes.
 *
 * Today this is not called from any route. Sorted by createdAt DESC.
 */
export async function getTeamTaskViewByPatient(
  patientScreeningId: number,
  filters: ListTeamTasksByPatientFilters = {},
  limit?: number,
): Promise<TeamTask[]> {
  const tasks = await listTeamTasksByPatient(patientScreeningId, filters, limit);
  tasks.sort((a, b) => {
    const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
    const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
    return bTime - aTime;
  });
  return tasks;
}
