import type { CompletedBillingPackage } from "@shared/schema";

// Thin client helper for /api/completed-billing-packages. Pure
// read-only paths live here; the payment + transition actions stay
// on the existing dedicated routes (`/payment`,
// `/complete-package-payment`, `/transition`) so this helper isn't a
// second source of truth for package mutations.

export type CompletedBillingPackageFilters = {
  executionCaseId?: number;
  patientScreeningId?: number;
  procedureEventId?: number;
  billingReadinessCheckId?: number;
  billingDocumentRequestId?: number;
  facilityId?: string;
  serviceType?: string;
  packageStatus?: string;
  paymentStatus?: string;
  limit?: number;
};

function buildQuery(filters: CompletedBillingPackageFilters): string {
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
  if (filters.billingReadinessCheckId != null) {
    params.set("billingReadinessCheckId", String(filters.billingReadinessCheckId));
  }
  if (filters.billingDocumentRequestId != null) {
    params.set("billingDocumentRequestId", String(filters.billingDocumentRequestId));
  }
  if (filters.facilityId) params.set("facilityId", filters.facilityId);
  if (filters.serviceType) params.set("serviceType", filters.serviceType);
  if (filters.packageStatus) params.set("packageStatus", filters.packageStatus);
  if (filters.paymentStatus) params.set("paymentStatus", filters.paymentStatus);
  if (filters.limit != null) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchCompletedBillingPackages(
  filters: CompletedBillingPackageFilters = {},
): Promise<CompletedBillingPackage[]> {
  const res = await fetch(
    `/api/completed-billing-packages${buildQuery(filters)}`,
    { credentials: "include" },
  );
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error ?? "";
    } catch {
      /* noop */
    }
    throw new Error(
      `fetchCompletedBillingPackages failed (${res.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  const data = await res.json();
  return Array.isArray(data) ? (data as CompletedBillingPackage[]) : [];
}

export async function fetchCompletedBillingPackageById(
  id: number,
): Promise<CompletedBillingPackage | null> {
  const res = await fetch(`/api/completed-billing-packages/${id}`, {
    credentials: "include",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`fetchCompletedBillingPackageById failed (${res.status})`);
  }
  return (await res.json()) as CompletedBillingPackage;
}
