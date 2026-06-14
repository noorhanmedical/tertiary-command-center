// billingAuditorApi — Phase 4 PR 4.7.

export type WorklistQueueId =
  | "ready_to_invoice"
  | "blocked_missing_report"
  | "blocked_missing_order_note"
  | "blocked_missing_procedure_note"
  | "physician_signature_pending"
  | "insurance_verification_pending"
  | "missing_price"
  | "missing_recipient"
  | "invoice_draft_needs_review"
  | "invoice_approved_ready_to_send"
  | "invoice_delivery_failed"
  | "payment_overdue"
  | "denial_open"
  | "reminder_due";

export type WorklistSummary = {
  queues: WorklistQueueId[];
  summary: Record<WorklistQueueId, number>;
};

export type WorklistItem = {
  queueId: WorklistQueueId;
  itemId: number;
  invoiceId?: number | null;
  patientName?: string | null;
  facilityId?: string | null;
  testType?: string | null;
  label: string;
  reason?: string;
  detail?: string;
  createdAt?: string | null;
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchWorklistSummary(facilityId?: string): Promise<WorklistSummary> {
  const qs = new URLSearchParams();
  if (facilityId) qs.set("facilityId", facilityId);
  const res = await fetch(`/api/billing-auditor/summary${qs.toString() ? `?${qs}` : ""}`, { credentials: "include" });
  return jsonOrThrow<WorklistSummary>(res);
}

export async function fetchWorklistItems(queueId: WorklistQueueId, facilityId?: string, limit = 200): Promise<{ queueId: WorklistQueueId; items: WorklistItem[] }> {
  const qs = new URLSearchParams({ queueId });
  if (facilityId) qs.set("facilityId", facilityId);
  qs.set("limit", String(limit));
  const res = await fetch(`/api/billing-auditor/worklist?${qs}`, { credentials: "include" });
  return jsonOrThrow<{ queueId: WorklistQueueId; items: WorklistItem[] }>(res);
}

export const QUEUE_LABELS: Record<WorklistQueueId, string> = {
  ready_to_invoice: "Ready to invoice",
  blocked_missing_report: "Missing report",
  blocked_missing_order_note: "Missing order note",
  blocked_missing_procedure_note: "Missing procedure note",
  physician_signature_pending: "Physician signature",
  insurance_verification_pending: "Insurance pending",
  missing_price: "Missing price",
  missing_recipient: "Missing recipient",
  invoice_draft_needs_review: "Draft review",
  invoice_approved_ready_to_send: "Ready to send",
  invoice_delivery_failed: "Delivery failed",
  payment_overdue: "Payment overdue",
  denial_open: "Open denials",
  reminder_due: "Reminder due",
};
