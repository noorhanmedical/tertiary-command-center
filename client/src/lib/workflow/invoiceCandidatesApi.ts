// Thin client helper for /api/invoice-candidates.
//
// Read-only join over completed_billing_packages with the
// invoice-line-item / invoice linkage derived from the package
// metadata. UI surfaces consume this directly to show
// "ready for invoicing" vs "linked to invoice" without mutating
// the spine.

export type InvoiceCandidate = {
  completedBillingPackageId: number;
  patientScreeningId: number | null;
  executionCaseId: number | null;
  procedureEventId: number | null;
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
  ourPortionPercentage: number | null;
  invoiceLineItemId: number | null;
  invoiceId: number | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type InvoiceCandidateFilters = {
  facilityId?: string;
  serviceType?: string;
  packageStatus?: string;
  limit?: number;
};

function buildQuery(filters: InvoiceCandidateFilters): string {
  const params = new URLSearchParams();
  if (filters.facilityId) params.set("facilityId", filters.facilityId);
  if (filters.serviceType) params.set("serviceType", filters.serviceType);
  if (filters.packageStatus) params.set("packageStatus", filters.packageStatus);
  if (filters.limit != null) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchInvoiceCandidates(
  filters: InvoiceCandidateFilters = {},
): Promise<InvoiceCandidate[]> {
  const res = await fetch(`/api/invoice-candidates${buildQuery(filters)}`, {
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
      `fetchInvoiceCandidates failed (${res.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  const data = await res.json();
  return Array.isArray(data) ? (data as InvoiceCandidate[]) : [];
}

// Helper: terminal package statuses that mark a candidate as ready
// to be linked into an invoice.
export const TERMINAL_PACKAGE_STATUSES = [
  "completed_package",
  "added_to_invoice",
  "invoiced",
  "closed",
] as const;

export type TerminalPackageStatus = (typeof TERMINAL_PACKAGE_STATUSES)[number];

export function isInvoiceLinked(candidate: InvoiceCandidate): boolean {
  return candidate.invoiceLineItemId != null;
}
