import { apiRequest } from "@/lib/queryClient";

// ─── Completed billing packages ──────────────────────────────────────────────

export type CompletedBillingPackage = {
  id: number;
  executionCaseId: number | null;
  patientScreeningId: number | null;
  procedureEventId: number | null;
  billingReadinessCheckId: number | null;
  billingDocumentRequestId: number | null;
  patientName: string | null;
  patientInitials: string | null;
  patientDob: string | null;
  facilityId: string | null;
  serviceType: string;
  dos: string | null;
  packageStatus: string;
  paymentStatus: string;
  fullAmountPaid: string | null;
  paymentDate: string | null;
  paymentUpdatedAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type CompletedBillingPackagesFilters = {
  packageStatus?: string;
  paymentStatus?: string;
  facilityId?: string;
  serviceType?: string;
  limit?: number;
};

function buildPackageQuery(filters: CompletedBillingPackagesFilters): string {
  const params = new URLSearchParams();
  if (filters.packageStatus) params.set("packageStatus", filters.packageStatus);
  if (filters.paymentStatus) params.set("paymentStatus", filters.paymentStatus);
  if (filters.facilityId) params.set("facilityId", filters.facilityId);
  if (filters.serviceType) params.set("serviceType", filters.serviceType);
  if (filters.limit != null) params.set("limit", String(filters.limit));
  return params.toString();
}

export function completedBillingPackagesQueryKey(
  filters: CompletedBillingPackagesFilters,
): string[] {
  return ["/api/completed-billing-packages", buildPackageQuery(filters)];
}

export async function fetchCompletedBillingPackages(
  filters: CompletedBillingPackagesFilters = {},
): Promise<CompletedBillingPackage[]> {
  const qs = buildPackageQuery(filters);
  const res = await apiRequest("GET", `/api/completed-billing-packages${qs ? `?${qs}` : ""}`);
  return res.json();
}

// ─── Billing readiness checks ────────────────────────────────────────────────

export type BillingReadinessCheck = {
  id: number;
  executionCaseId: number | null;
  patientScreeningId: number | null;
  procedureEventId: number | null;
  patientName: string | null;
  patientDob: string | null;
  facilityId: string | null;
  serviceType: string;
  readinessStatus: string;
  missingRequirements: string[];
  readyAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type BillingReadinessChecksFilters = {
  readinessStatus?: string;
  facilityId?: string;
  serviceType?: string;
  limit?: number;
};

function buildReadinessQuery(filters: BillingReadinessChecksFilters): string {
  const params = new URLSearchParams();
  if (filters.readinessStatus) params.set("readinessStatus", filters.readinessStatus);
  if (filters.facilityId) params.set("facilityId", filters.facilityId);
  if (filters.serviceType) params.set("serviceType", filters.serviceType);
  if (filters.limit != null) params.set("limit", String(filters.limit));
  return params.toString();
}

export function billingReadinessChecksQueryKey(
  filters: BillingReadinessChecksFilters,
): string[] {
  return ["/api/billing-readiness-checks", buildReadinessQuery(filters)];
}

export async function fetchBillingReadinessChecks(
  filters: BillingReadinessChecksFilters = {},
): Promise<BillingReadinessCheck[]> {
  const qs = buildReadinessQuery(filters);
  const res = await apiRequest("GET", `/api/billing-readiness-checks${qs ? `?${qs}` : ""}`);
  return res.json();
}
