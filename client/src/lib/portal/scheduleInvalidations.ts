// Centralized query-invalidation helper for schedule writes.
//
// Every team-portal scheduling write (SchedulePatientDialog,
// SchedulePatientPlayground, future inline schedule actions) should
// call this on success so the right-panel mini-calendar, workspace
// lists, and patient command center all reflect the new state.

import type { QueryClient } from "@tanstack/react-query";

export type ScheduleInvalidationContext = {
  facility?: string | null;
  selectedDate?: string | null;
  patientScreeningId?: number | null;
};

function monthIsoFromDate(date: string | null | undefined): string | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function invalidateTeamPortalScheduleQueries(
  queryClient: QueryClient,
  ctx: ScheduleInvalidationContext = {},
): void {
  const { facility, selectedDate, patientScreeningId } = ctx;

  // Right-panel patient mini calendar (facility/month keyed).
  if (facility) {
    const monthIso = monthIsoFromDate(selectedDate ?? null);
    if (monthIso) {
      queryClient.invalidateQueries({
        queryKey: ["/api/portal/month-summary", facility, monthIso],
      });
    }
    // Best-effort wider invalidation when the month can't be inferred.
    queryClient.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        q.queryKey[0] === "/api/portal/month-summary",
    });
  }

  // Workspace mode-switcher lists.
  queryClient.invalidateQueries({ queryKey: ["team-workspace-clinic-schedule"] });
  queryClient.invalidateQueries({ queryKey: ["team-workspace-ancillary-schedule"] });
  queryClient.invalidateQueries({ queryKey: ["team-workspace-call-list"] });

  // Day-context + playground caches used by the schedule popup.
  queryClient.invalidateQueries({ queryKey: ["schedule-patient-day-context"] });
  queryClient.invalidateQueries({
    queryKey: ["schedule-patient-playground-context"],
  });

  // Canonical schedule + portal feeds.
  queryClient.invalidateQueries({ queryKey: ["/api/global-schedule-events"] });
  queryClient.invalidateQueries({
    predicate: (q) =>
      Array.isArray(q.queryKey) &&
      q.queryKey[0] === "/api/technician-liaison/clinic-visits",
  });
  queryClient.invalidateQueries({
    predicate: (q) =>
      Array.isArray(q.queryKey) &&
      q.queryKey[0] === "/api/technician-liaison/ancillary-schedule",
  });
  queryClient.invalidateQueries({ queryKey: ["/api/portal/today-schedule"] });
  queryClient.invalidateQueries({ queryKey: ["/api/portal/outreach-call-list"] });
  queryClient.invalidateQueries({ queryKey: ["/api/schedule/dashboard"] });

  // Plexus IQ calendar summary so dots refresh.
  queryClient.invalidateQueries({
    queryKey: ["/api/screening-batches/calendar-summary"],
  });

  // Patient command canvas if the write targeted a specific patient.
  if (patientScreeningId != null) {
    queryClient.invalidateQueries({
      queryKey: ["portal-command-center", patientScreeningId],
    });
  }
}
