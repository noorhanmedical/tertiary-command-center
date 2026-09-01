import { requestJson } from "@/lib/workflow/safeFetch";
import type { AncillaryAppointmentProjection } from "@shared/types/canonicalAppointment";

export type SchedulerPortalCase = {
  id: number;
  patientScreeningId: number | null;
  patientName: string;
  patientDob: string | null;
  facilityId: string | null;
  engagementBucket: string;
  lifecycleStatus: string;
  engagementStatus: string;
  qualificationStatus: string;
  selectedServices: string[] | null;
  source: string;
  assignedTeamMemberId: number | null;
  assignedRole: string | null;
  priorityScore: number | null;
  nextActionAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Phase 2D-D1 — canonical per-service appointment projection. Present
  // only when the server flag is ON and ?withAppointments=true was
  // requested. Keyed by serviceType.
  appointmentByService?: Record<string, AncillaryAppointmentProjection>;
};

export type SchedulerPortalCasesFilters = {
  facilityId?: string;
  assignedTeamMemberId?: number;
  engagementBucket?: string;
  lifecycleStatus?: string;
  engagementStatus?: string;
  qualificationStatus?: string;
  limit?: number;
  /** Phase 2D-D1 — request the canonical per-service appointment projection. */
  withAppointments?: boolean;
};

function buildQuery(filters: SchedulerPortalCasesFilters): string {
  const params = new URLSearchParams();
  if (filters.facilityId) params.set("facilityId", filters.facilityId);
  if (filters.assignedTeamMemberId != null) params.set("assignedTeamMemberId", String(filters.assignedTeamMemberId));
  if (filters.engagementBucket) params.set("engagementBucket", filters.engagementBucket);
  if (filters.lifecycleStatus) params.set("lifecycleStatus", filters.lifecycleStatus);
  if (filters.engagementStatus) params.set("engagementStatus", filters.engagementStatus);
  if (filters.qualificationStatus) params.set("qualificationStatus", filters.qualificationStatus);
  if (filters.limit != null) params.set("limit", String(filters.limit));
  if (filters.withAppointments) params.set("withAppointments", "true");
  return params.toString();
}

export function schedulerPortalCasesQueryKey(filters: SchedulerPortalCasesFilters): string[] {
  return ["/api/scheduler-portal/cases", buildQuery(filters)];
}

export async function fetchSchedulerPortalCases(
  filters: SchedulerPortalCasesFilters = {},
): Promise<SchedulerPortalCase[]> {
  const qs = buildQuery(filters);
  return requestJson<SchedulerPortalCase[]>(
    "GET",
    `/api/scheduler-portal/cases${qs ? `?${qs}` : ""}`,
  );
}
