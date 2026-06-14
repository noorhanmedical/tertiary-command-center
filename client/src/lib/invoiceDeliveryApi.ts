// invoiceDeliveryApi — Phase 4 PR 4.5 client.

export type DeliveryEvent = {
  id: number;
  invoiceId: number;
  eventType: "queued" | "sent" | "failed" | "reminder_sent" | "download_generated" | "blocked";
  recipientSnapshot: Record<string, unknown>;
  actorUserId: string | null;
  messageId: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type InvoiceQueueRow = {
  id: number;
  invoiceNumber: string;
  facility: string;
  totalCharges: string;
  totalBalance: string;
  approvalStatus?: string;
  deliveryStatus?: string;
  sentTo?: string | null;
  sentAt?: string | null;
  lastRemindedAt?: string | null;
  recipientSnapshot?: Record<string, unknown>;
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchDeliveryQueue(): Promise<InvoiceQueueRow[]> {
  const res = await fetch(`/api/invoice-delivery-queue`, { credentials: "include" });
  return jsonOrThrow<InvoiceQueueRow[]>(res);
}

export async function fetchDeliveryEvents(invoiceId: number): Promise<DeliveryEvent[]> {
  const res = await fetch(`/api/invoices/${invoiceId}/delivery-events`, { credentials: "include" });
  return jsonOrThrow<DeliveryEvent[]>(res);
}

export async function queueInvoice(id: number) {
  const res = await fetch(`/api/invoices/${id}/queue-delivery`, { method: "POST", credentials: "include" });
  return jsonOrThrow(res);
}

export async function sendInvoiceEmail(id: number) {
  const res = await fetch(`/api/invoices/${id}/send-email`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
  });
  return jsonOrThrow(res);
}

export async function sendInvoiceReminder(id: number) {
  const res = await fetch(`/api/invoices/${id}/send-reminder`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
  });
  return jsonOrThrow(res);
}
