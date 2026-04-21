import { useQuery } from "@tanstack/react-query";
import { qk } from "./keys";

export type SchedulerAssignmentRow = {
  id: number;
  patientScreeningId: number;
  schedulerId: number;
  source: string;
  originalSchedulerId: number | null;
  reason: string | null;
};

export function useSchedulerAssignments() {
  return useQuery<SchedulerAssignmentRow[]>({
    queryKey: qk.schedulerAssignments.all(),
    refetchInterval: 60_000,
  });
}
