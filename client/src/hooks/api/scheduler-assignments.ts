import { useQuery } from "@tanstack/react-query";
import { qk } from "./keys";

// Canonical shape lives in the shared schema. The hook returns rows
// from GET /api/scheduler-assignments which is `SchedulerAssignment[]`.
// See shared/schema/outreach.ts.
import type { SchedulerAssignment } from "@shared/schema";

export type SchedulerAssignmentRow = SchedulerAssignment;

/**
 * @deprecated Legacy scheduler assignment model. Do not use for live ownership.
 * Canonical ownership is patient_execution_cases.assignedTeamMemberId.
 * This hook has zero active importers as of Phase 1 convergence.
 */
export function useSchedulerAssignments() {
  return useQuery<SchedulerAssignmentRow[]>({
    queryKey: qk.schedulerAssignments.all(),
    refetchInterval: 60_000,
  });
}
