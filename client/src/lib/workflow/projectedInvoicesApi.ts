import type { ProjectedInvoiceRow } from "@shared/schema";

// Thin client helper for /api/projected-invoice-rows. Read-only.
// Projected invoice rows model the *projected* revenue side of the
// invoice spine; `realInvoiceLineItemId` is the canonical join into
// `invoice_line_items` once the package converts. Variance shows in
// `varianceAmount`.

export type ProjectedInvoiceRowFilters = {
  executionCaseId?: number;
  patientScreeningId?: number;
  procedureEventId?: number;
  realInvoiceLineItemId?: number;
  facilityId?: string;
  serviceType?: string;
  projectedStatus?: string;
  limit?: number;
};

function buildQuery(filters: ProjectedInvoiceRowFilters): string {
  const params = new URLSearchParams();
  if (filters.executionCaseId != null) {
    params.set("executionCaseId", String(filters.executionCaseId));
  }
  if (filters.patientScreeningId != null) {
    params.set("patientScreeningId", String(filters.patientScreeningId));
  }
  if (filters.procedureEventId != null) {
    params.set("procedureEventId", String(filters.procedureEventId));
  }
  if (filters.realInvoiceLineItemId != null) {
    params.set("realInvoiceLineItemId", String(filters.realInvoiceLineItemId));
  }
  if (filters.facilityId) params.set("facilityId", filters.facilityId);
  if (filters.serviceType) params.set("serviceType", filters.serviceType);
  if (filters.projectedStatus) params.set("projectedStatus", filters.projectedStatus);
  if (filters.limit != null) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchProjectedInvoiceRows(
  filters: ProjectedInvoiceRowFilters = {},
): Promise<ProjectedInvoiceRow[]> {
  const res = await fetch(`/api/projected-invoice-rows${buildQuery(filters)}`, {
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
      `fetchProjectedInvoiceRows failed (${res.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  const data = await res.json();
  return Array.isArray(data) ? (data as ProjectedInvoiceRow[]) : [];
}

export async function fetchProjectedInvoiceRowById(
  id: number,
): Promise<ProjectedInvoiceRow | null> {
  const res = await fetch(`/api/projected-invoice-rows/${id}`, {
    credentials: "include",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`fetchProjectedInvoiceRowById failed (${res.status})`);
  }
  return (await res.json()) as ProjectedInvoiceRow;
}

// Compute simple variance summary for a projected row. Returns null
// when no real linkage has landed yet — UI should render "not yet
// linked" in that case instead of fabricating a zero variance.
export function summarizeProjectedVariance(row: ProjectedInvoiceRow): {
  hasRealLink: boolean;
  projectedAmount: string | null;
  variance: string | null;
  varianceSign: "positive" | "negative" | "zero" | null;
} {
  const hasRealLink = row.realInvoiceLineItemId != null;
  const projectedAmount =
    row.projectedOurPortionAmount ?? row.projectedFullAmount ?? null;
  const variance = row.varianceAmount ?? null;
  let varianceSign: "positive" | "negative" | "zero" | null = null;
  if (variance != null && variance !== "") {
    const numeric = Number(String(variance).replace(/[^0-9.\-]/g, ""));
    if (!Number.isNaN(numeric)) {
      varianceSign = numeric > 0 ? "positive" : numeric < 0 ? "negative" : "zero";
    }
  }
  return { hasRealLink, projectedAmount, variance, varianceSign };
}
