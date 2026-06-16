// operationalSummaryApi — Phase 3 PR 3.8 client.

import type { AiSafetyPolicy } from "./aiRecommendationsApi";

export type OperationalSummary = {
  version: string;
  generatedAt: string;
  scope: { facilityId: string | null };
  exceptions: {
    totalByStatus: Record<string, number>;
    totalByType: Record<string, number>;
    bySeverity: Record<string, number>;
    avgHoursToAcknowledge: number | null;
    avgHoursToResolve: number | null;
  };
  recommendations: {
    totalByStatus: Record<string, number>;
    totalByAction: Record<string, number>;
    totalByProvider: Record<string, number>;
    acceptanceRatePercent: number | null;
  };
  topFacilitiesByOpen: { facilityId: string | null; openCount: number }[];
  topDetectorsByOpen: { exceptionType: string; openCount: number }[];
  safety: AiSafetyPolicy;
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchOperationalSummary(facilityId?: string): Promise<OperationalSummary> {
  const qs = new URLSearchParams();
  if (facilityId) qs.set("facilityId", facilityId);
  const res = await fetch(`/api/operational-summary${qs.toString() ? `?${qs}` : ""}`, { credentials: "include" });
  return jsonOrThrow(res);
}
