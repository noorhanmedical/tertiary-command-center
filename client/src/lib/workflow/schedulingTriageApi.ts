import type { SchedulingTriageCase } from "@shared/schema";

// Thin client helper for /api/scheduling-triage-cases. Read-only.
// Triage state changes (assignment, status flips, owner hand-off) go
// through the dedicated triage action routes — this helper exists so
// every page that needs the canonical triage queue (Outreach, PCS,
// ACS, manager review, etc.) reads from the same place with full
// filter coverage.

export type SchedulingTriageCaseFilters = {
  executionCaseId?: number;
  patientScreeningId?: number;
  globalScheduleEventId?: number;
  facilityId?: string;
  mainType?: string;
  subtype?: string;
  status?: string;
  assignedUserId?: string;
  nextOwnerRole?: string;
  limit?: number;
};

function buildQuery(filters: SchedulingTriageCaseFilters): string {
  const params = new URLSearchParams();
  if (filters.executionCaseId != null) {
    params.set("executionCaseId", String(filters.executionCaseId));
  }
  if (filters.patientScreeningId != null) {
    params.set("patientScreeningId", String(filters.patientScreeningId));
  }
  if (filters.globalScheduleEventId != null) {
    params.set("globalScheduleEventId", String(filters.globalScheduleEventId));
  }
  if (filters.facilityId) params.set("facilityId", filters.facilityId);
  if (filters.mainType) params.set("mainType", filters.mainType);
  if (filters.subtype) params.set("subtype", filters.subtype);
  if (filters.status) params.set("status", filters.status);
  if (filters.assignedUserId) params.set("assignedUserId", filters.assignedUserId);
  if (filters.nextOwnerRole) params.set("nextOwnerRole", filters.nextOwnerRole);
  if (filters.limit != null) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchSchedulingTriageCases(
  filters: SchedulingTriageCaseFilters = {},
): Promise<SchedulingTriageCase[]> {
  const res = await fetch(`/api/scheduling-triage-cases${buildQuery(filters)}`, {
    credentials: "include",
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error ?? "";
    } catch {
      /* noop */
    }
    throw new Error(
      `fetchSchedulingTriageCases failed (${res.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  const data = (await res.json()) as SchedulingTriageCase[];
  return Array.isArray(data) ? data : [];
}

export async function fetchSchedulingTriageCaseById(
  id: number,
): Promise<SchedulingTriageCase | null> {
  const res = await fetch(`/api/scheduling-triage-cases/${id}`, {
    credentials: "include",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`fetchSchedulingTriageCaseById failed (${res.status})`);
  }
  return (await res.json()) as SchedulingTriageCase;
}

// Canonical triage main-type / subtype labels used across the
// outreach + portal surfaces. Mirrors `SCHEDULING_TRIAGE_*` enums on
// `shared/schema/schedulingTriage.ts`; kept here as a UI-facing label
// map so display strings don't fan out across pages.
export const TRIAGE_MAIN_TYPE_LABELS: Record<string, string> = {
  callback: "Callback",
  reschedule: "Reschedule",
  no_show: "No-show",
  cancellation: "Cancellation",
  wrong_number: "Wrong number",
  needs_records: "Needs records",
  manager_review: "Manager review",
  technician_unavailable: "Technician unavailable",
  insurance_issue: "Insurance / prior auth issue",
};
