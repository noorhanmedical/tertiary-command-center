// Read-only fetch helpers for the Team Member Workspace right-panel modes.
//
// Each helper is a thin wrapper around an existing canonical endpoint —
// this batch does not add any new backend routes. All three helpers
// surface canonical rows directly so PortalShell can render them in the
// right panel.
//
// Mode → endpoint:
//   Clinic Schedule    → /api/technician-liaison/clinic-visits
//                        (global_schedule_events doctor_visit + same_day_add)
//   Ancillary Schedule → /api/technician-liaison/ancillary-schedule
//                        (global_schedule_events ancillary_appointment)
//   Call List          → /api/scheduler-portal/cases
//                        (patient_execution_cases.nextActionAt /
//                         patient_journey_events). Both PCS and ACS read
//                        this — call list is a shared capability.

export type TeamWorkspaceClinicVisit = {
  id: string | number;
  patientName?: string | null;
  patientDob?: string | null;
  facilityId?: string | null;
  startsAt?: string | null;
  serviceType?: string | null;
  status?: string | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
};

export type TeamWorkspaceAncillaryAppointment = {
  id: string | number;
  patientName?: string | null;
  patientDob?: string | null;
  facilityId?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  serviceType?: string | null;
  status?: string | null;
  assignedUserId?: string | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
};

export type TeamWorkspaceCallListItem = {
  id: string | number;
  patientName?: string | null;
  patientDob?: string | null;
  facilityId?: string | null;
  nextActionAt?: string | null;
  assignedTeamMemberId?: number | string | null;
  assignedRole?: string | null;
  engagementStatus?: string | null;
  lifecycleStatus?: string | null;
  qualificationStatus?: string | null;
  patientScreeningId?: number | null;
  executionCaseId?: number | null;
};

type ScheduleParams = {
  facilityId?: string | null;
  assignedUserId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  limit?: number;
};

type AncillaryParams = ScheduleParams & {
  serviceType?: string | null;
};

type CallListParams = {
  facilityId?: string | null;
  assignedTeamMemberId?: number | string | null;
  assignedRole?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  limit?: number;
};

function appendIf(params: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null) return;
  if (typeof value === "string" && value.trim() === "") return;
  params.set(key, String(value));
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}) for ${url}`);
  }
  return (await res.json()) as T;
}

export async function fetchWorkspaceClinicSchedule(
  params: ScheduleParams = {},
): Promise<TeamWorkspaceClinicVisit[]> {
  const qs = new URLSearchParams();
  appendIf(qs, "facilityId", params.facilityId);
  appendIf(qs, "assignedUserId", params.assignedUserId);
  appendIf(qs, "startDate", params.startDate);
  appendIf(qs, "endDate", params.endDate);
  appendIf(qs, "limit", params.limit ?? 100);
  const url = `/api/technician-liaison/clinic-visits${qs.toString() ? `?${qs}` : ""}`;
  const rows = await fetchJson<unknown[]>(url);
  return Array.isArray(rows) ? (rows as TeamWorkspaceClinicVisit[]) : [];
}

export async function fetchWorkspaceAncillarySchedule(
  params: AncillaryParams = {},
): Promise<TeamWorkspaceAncillaryAppointment[]> {
  const qs = new URLSearchParams();
  appendIf(qs, "facilityId", params.facilityId);
  appendIf(qs, "assignedUserId", params.assignedUserId);
  appendIf(qs, "serviceType", params.serviceType);
  appendIf(qs, "startDate", params.startDate);
  appendIf(qs, "endDate", params.endDate);
  appendIf(qs, "limit", params.limit ?? 100);
  const url = `/api/technician-liaison/ancillary-schedule${qs.toString() ? `?${qs}` : ""}`;
  const rows = await fetchJson<unknown[]>(url);
  return Array.isArray(rows) ? (rows as TeamWorkspaceAncillaryAppointment[]) : [];
}

// /api/scheduler-portal/cases doesn't support startDate/endDate, so we
// fetch by facility/assigned and filter `nextActionAt` client-side when
// a date window is supplied.
export async function fetchWorkspaceCallList(
  params: CallListParams = {},
): Promise<TeamWorkspaceCallListItem[]> {
  const qs = new URLSearchParams();
  appendIf(qs, "facilityId", params.facilityId);
  appendIf(qs, "assignedTeamMemberId", params.assignedTeamMemberId);
  appendIf(qs, "assignedRole", params.assignedRole);
  appendIf(qs, "limit", params.limit ?? 100);
  const url = `/api/scheduler-portal/cases${qs.toString() ? `?${qs}` : ""}`;
  const rows = await fetchJson<unknown[]>(url);
  if (!Array.isArray(rows)) return [];
  let out = rows as TeamWorkspaceCallListItem[];
  if (params.startDate || params.endDate) {
    const startMs = params.startDate ? new Date(params.startDate).getTime() : -Infinity;
    const endMs = params.endDate ? new Date(params.endDate).getTime() : Infinity;
    out = out.filter((row) => {
      if (!row.nextActionAt) return false;
      const t = new Date(row.nextActionAt).getTime();
      return Number.isFinite(t) && t >= startMs && t <= endMs;
    });
  }
  return out;
}
