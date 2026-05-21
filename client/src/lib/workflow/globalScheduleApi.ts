import type { GlobalScheduleEvent } from "@shared/schema";

// Thin client helper for /api/global-schedule-events. Read-only —
// mutations live on the dedicated schedule action routes (e.g.
// schedule-ancillary, reschedule, cancel). This helper just gives
// every page that needs the canonical schedule one consistent fetch
// path with full filter coverage.

export type GlobalScheduleEventFilters = {
  facilityId?: string;
  eventType?: string;
  status?: string;
  assignedUserId?: string;
  assignedRole?: string;
  executionCaseId?: number;
  patientScreeningId?: number;
  startDate?: string | Date;
  endDate?: string | Date;
  limit?: number;
};

function toIsoDateString(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function buildQuery(filters: GlobalScheduleEventFilters): string {
  const params = new URLSearchParams();
  if (filters.facilityId) params.set("facilityId", filters.facilityId);
  if (filters.eventType) params.set("eventType", filters.eventType);
  if (filters.status) params.set("status", filters.status);
  if (filters.assignedUserId) params.set("assignedUserId", filters.assignedUserId);
  if (filters.assignedRole) params.set("assignedRole", filters.assignedRole);
  if (filters.executionCaseId != null) {
    params.set("executionCaseId", String(filters.executionCaseId));
  }
  if (filters.patientScreeningId != null) {
    params.set("patientScreeningId", String(filters.patientScreeningId));
  }
  const startIso = toIsoDateString(filters.startDate);
  if (startIso) params.set("startDate", startIso);
  const endIso = toIsoDateString(filters.endDate);
  if (endIso) params.set("endDate", endIso);
  if (filters.limit != null) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchGlobalScheduleEvents(
  filters: GlobalScheduleEventFilters = {},
): Promise<GlobalScheduleEvent[]> {
  const res = await fetch(`/api/global-schedule-events${buildQuery(filters)}`, {
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
      `fetchGlobalScheduleEvents failed (${res.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  const data = (await res.json()) as GlobalScheduleEvent[];
  return Array.isArray(data) ? data : [];
}

export async function fetchGlobalScheduleEventById(
  id: number,
): Promise<GlobalScheduleEvent | null> {
  const res = await fetch(`/api/global-schedule-events/${id}`, {
    credentials: "include",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`fetchGlobalScheduleEventById failed (${res.status})`);
  }
  return (await res.json()) as GlobalScheduleEvent;
}
