// invoiceApprovalApi — Phase 4 PR 4.4 client.

export type InvoiceApprovalStatus = "draft" | "pending_review" | "approved" | "voided" | "revised";

export type InvoiceAudit = {
  invoiceId: number;
  approvalStatus: InvoiceApprovalStatus;
  approvedByUserId: string | null;
  approvedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  deliveryStatus: string;
  policySnapshot: Record<string, unknown>;
  recipientSnapshot: Record<string, unknown>;
  dueDate: string | null;
  paymentTerms: string | null;
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function postCreateDraftsFromBatch(batchId: number): Promise<{ invoiceId: number; invoiceNumber: string; lineCount: number; totalCharges: number }> {
  const res = await fetch(`/api/invoice-batches/${batchId}/create-drafts`, {
    method: "POST",
    credentials: "include",
  });
  return jsonOrThrow(res);
}

export async function submitInvoiceForReview(id: number) {
  const res = await fetch(`/api/invoices/${id}/submit-for-review`, { method: "POST", credentials: "include" });
  return jsonOrThrow(res);
}
export async function approveInvoice(id: number) {
  const res = await fetch(`/api/invoices/${id}/approve`, { method: "POST", credentials: "include" });
  return jsonOrThrow(res);
}
export async function voidInvoice(id: number, reason: string) {
  const res = await fetch(`/api/invoices/${id}/void`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  return jsonOrThrow(res);
}
export async function reviseInvoice(id: number) {
  const res = await fetch(`/api/invoices/${id}/revise`, { method: "POST", credentials: "include" });
  return jsonOrThrow(res);
}
export async function fetchInvoiceAudit(id: number): Promise<InvoiceAudit> {
  const res = await fetch(`/api/invoices/${id}/audit`, { credentials: "include" });
  return jsonOrThrow<InvoiceAudit>(res);
}
