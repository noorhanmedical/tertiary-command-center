// invoiceBatchesApi — Phase 4 PR 4.3 client.

export type InvoiceBatchRow = {
  id: number;
  facilityId: string;
  invoicePeriodStart: string;
  invoicePeriodEnd: string;
  cutoffAt: string;
  batchStatus: "draft_preview" | "ready_for_review" | "invoice_drafts_created" | "voided";
  policySnapshot: Record<string, unknown>;
  recipientSnapshot: Record<string, unknown>;
  totals: { totalCharges?: number; currency?: string };
  itemCount: number;
  blockedCount: number;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceBatchItemRow = {
  id: number;
  batchId: number;
  invoiceReadinessSnapshotId: number | null;
  executionCaseId: number | null;
  patientScreeningId: number | null;
  procedureEventId: number | null;
  facilityId: string | null;
  testType: string;
  patientName: string | null;
  dateOfService: string | null;
  price: string | null;
  revenueSplit: Record<string, unknown>;
  lineStatus: "included" | "excluded" | "blocked" | "duplicate";
  blockers: string[];
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchInvoiceBatches(filters: { facilityId?: string; batchStatus?: string } = {}): Promise<InvoiceBatchRow[]> {
  const qs = new URLSearchParams();
  if (filters.facilityId) qs.set("facilityId", filters.facilityId);
  if (filters.batchStatus) qs.set("batchStatus", filters.batchStatus);
  const res = await fetch(`/api/invoice-batches${qs.toString() ? `?${qs}` : ""}`, { credentials: "include" });
  return jsonOrThrow<InvoiceBatchRow[]>(res);
}

export async function fetchInvoiceBatch(id: number): Promise<{ batch: InvoiceBatchRow; items: InvoiceBatchItemRow[] }> {
  const res = await fetch(`/api/invoice-batches/${id}`, { credentials: "include" });
  return jsonOrThrow<{ batch: InvoiceBatchRow; items: InvoiceBatchItemRow[] }>(res);
}

export async function postInvoiceBatchPreview(input: {
  facilityId: string;
  invoicePeriodStart?: string;
  invoicePeriodEnd?: string;
  cutoffAt?: string;
}): Promise<{ batchId: number; itemCount: number; blockedCount: number; totalCharges: number }> {
  const res = await fetch(`/api/invoice-batches/preview`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return jsonOrThrow(res);
}

export async function voidInvoiceBatch(id: number): Promise<InvoiceBatchRow> {
  const res = await fetch(`/api/invoice-batches/${id}/void`, { method: "POST", credentials: "include" });
  return jsonOrThrow<InvoiceBatchRow>(res);
}

export async function refreshInvoiceBatch(id: number): Promise<{ newBatchId: number }> {
  const res = await fetch(`/api/invoice-batches/${id}/refresh`, { method: "POST", credentials: "include" });
  return jsonOrThrow<{ newBatchId: number }>(res);
}
