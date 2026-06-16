// callPriorityApi — Phase 3 PR 3.7 client.

import type { ExceptionRow } from "./exceptionsApi";

export type CallPriorityItem = {
  exception: ExceptionRow;
  score: number;
  reasons: string[];
};

export type CallPriorityResponse = {
  version: string;
  items: CallPriorityItem[];
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchCallPriority(filters: { facilityId?: string; ownerRole?: string; limit?: number } = {}): Promise<CallPriorityResponse> {
  const qs = new URLSearchParams();
  if (filters.facilityId) qs.set("facilityId", filters.facilityId);
  if (filters.ownerRole) qs.set("ownerRole", filters.ownerRole);
  if (filters.limit) qs.set("limit", String(filters.limit));
  const res = await fetch(`/api/call-priority${qs.toString() ? `?${qs}` : ""}`, { credentials: "include" });
  return jsonOrThrow(res);
}
