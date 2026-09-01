// Canonical schedule-event transition writer.
//
// This is the CANONICAL cancellation/transition path for ancillary
// appointments surfaced in the Team Portal. It posts to
//   POST /api/global-schedule-events/:id/transition
// with { transition, reason?, newStartsAt?, newEndsAt?, note? } and routes
// through the server's applyCanonicalAncillaryTransition orchestrator (which
// writes the global_schedule_events row, appends a canonical journey event,
// and reflects status on the execution case).
//
// NOTE: this intentionally does NOT use the legacy PATCH /api/appointments/:id
// path (useCancelAppointment). The Team Portal is canonical on
// global_schedule_events; the legacy appointments table is a compatibility
// projection, not the source of truth.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type ScheduleEventTransition =
  | "cancel"
  | "reschedule"
  | "no_show"
  | "confirm"
  | "complete";

export type ScheduleEventTransitionInput = {
  /** global_schedule_events id — for ancillary rows this is the row `.id`. */
  eventId: number;
  transition: ScheduleEventTransition;
  /** Required by the server for cancel / no_show (nonblank). */
  reason?: string | null;
  newStartsAt?: string | null;
  newEndsAt?: string | null;
  note?: string | null;
};

export async function applyScheduleEventTransition(
  input: ScheduleEventTransitionInput,
): Promise<unknown> {
  const { eventId, ...body } = input;
  const res = await apiRequest(
    "POST",
    `/api/global-schedule-events/${eventId}/transition`,
    body,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update appointment");
  }
  return res.json().catch(() => ({}));
}

// Mutation wrapper that refreshes the Team Portal work-queue feeds on success
// so a cancelled ancillary disappears from the schedule and the call list
// reflects the reopened scheduling need without a manual reload.
export function useScheduleEventTransition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ScheduleEventTransitionInput) =>
      applyScheduleEventTransition(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-workspace-ancillary-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["team-workspace-clinic-schedule"] });
      queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) && q.queryKey[0] === "team-workspace-call-list",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/scheduler-portal/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/engagement-center/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/global-schedule-events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/patient-journey-events"] });
    },
  });
}
