// invoiceReadinessApi — Phase 4 PR 4.2 client.

export type InvoiceReadinessStatus =
  | "not_ready" | "blocked" | "ready_to_invoice"
  | "invoice_draft_created" | "invoiced" | "excluded";

export type InvoiceReadinessSnapshotRow = {
  id: number;
  executionCaseId: number | null;
  patientScreeningId: number | null;
  procedureEventId: number | null;
  facilityId: string | null;
  serviceType: string;
  patientName: string | null;
  patientDob: string | null;
  readinessStatus: InvoiceReadinessStatus;
  blockers: string[];
  unitPrice: string | null;
  priceSnapshot: Record<string, unknown>;
  policySnapshot: Record<string, unknown>;
  evaluatedAt: string;
  invoiceId: number | null;
  metadata: Record<string, unknown>;
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchInvoiceReadiness(filters: {
  facilityId?: string;
  serviceType?: string;
  readinessStatus?: string;
  blockersIncludeAny?: string[];
  limit?: number;
} = {}): Promise<InvoiceReadinessSnapshotRow[]> {
  const qs = new URLSearchParams();
  if (filters.facilityId) qs.set("facilityId", filters.facilityId);
  if (filters.serviceType) qs.set("serviceType", filters.serviceType);
  if (filters.readinessStatus) qs.set("readinessStatus", filters.readinessStatus);
  if (filters.blockersIncludeAny?.length) qs.set("blockersIncludeAny", filters.blockersIncludeAny.join(","));
  if (filters.limit) qs.set("limit", String(filters.limit));
  const res = await fetch(`/api/invoice-readiness${qs.toString() ? `?${qs}` : ""}`, { credentials: "include" });
  return jsonOrThrow<InvoiceReadinessSnapshotRow[]>(res);
}

export async function postEvaluateInvoiceReadiness(input: {
  executionCaseId: number;
  serviceType: string;
}): Promise<InvoiceReadinessSnapshotRow> {
  const res = await fetch(`/api/invoice-readiness/evaluate`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<InvoiceReadinessSnapshotRow>(res);
}

export async function postEvaluateFacility(input: {
  facilityId: string;
  maxCases?: number;
}): Promise<{ evaluated: number; snapshots: InvoiceReadinessSnapshotRow[] }> {
  const res = await fetch(`/api/invoice-readiness/evaluate-facility`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<{ evaluated: number; snapshots: InvoiceReadinessSnapshotRow[] }>(res);
}

export const BLOCKER_LABELS: Record<string, string> = {
  missing_report: "Missing report",
  missing_consent: "Missing consent",
  missing_screening: "Missing screening",
  missing_order_note: "Missing order note",
  missing_procedure_note: "Missing procedure note",
  physician_signature_pending: "Physician signature pending",
  billing_readiness_pending: "Billing readiness pending",
  insurance_verification_pending: "Insurance pending",
  procedure_not_complete: "Procedure not complete",
  cancelled: "Cancelled",
  no_show_not_billable: "No-show (not billable)",
  missing_price: "Missing price",
  missing_recipient: "Missing recipient",
  already_invoiced: "Already invoiced",
  duplicate_risk: "Duplicate risk",
  facility_policy_missing: "Facility policy missing",
  test_type_policy_missing: "Test type policy missing",
};
