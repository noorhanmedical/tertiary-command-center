// invoiceFinancialApi — Phase 4 PR 4.6 client.

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export type FinancialEventsResponse = {
  payments: Array<{ id: number; amount: string; paymentDate: string; paymentMethod: string; reference: string | null; notes: string | null; createdAt: string }>;
  adjustments: Array<{ id: number; adjustmentType: string; amount: string; reason: string | null; createdAt: string }>;
  denials: Array<{ id: number; status: string; denialCode: string | null; denialReason: string | null; payer: string | null; nextActionAt: string | null; createdAt: string }>;
  remittances: Array<{ id: number; payer: string | null; reference: string | null; amount: string | null; eventType: string; createdAt: string }>;
};

export async function fetchFinancialEvents(invoiceId: number): Promise<FinancialEventsResponse> {
  const res = await fetch(`/api/invoices/${invoiceId}/financial-events`, { credentials: "include" });
  return jsonOrThrow<FinancialEventsResponse>(res);
}

export async function postPayment(invoiceId: number, body: { amount: number; paymentDate?: string; paymentMethod?: string; reference?: string; notes?: string }) {
  const res = await fetch(`/api/invoices/${invoiceId}/payments`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return jsonOrThrow(res);
}

export async function postAdjustment(invoiceId: number, body: { adjustmentType: string; amount: number; reason?: string; lineItemId?: number }) {
  const res = await fetch(`/api/invoices/${invoiceId}/adjustments`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return jsonOrThrow(res);
}

export async function postDenial(invoiceId: number, body: { denialCode?: string; denialReason?: string; payer?: string; lineItemId?: number; nextActionAt?: string }) {
  const res = await fetch(`/api/invoices/${invoiceId}/denials`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return jsonOrThrow(res);
}

export async function postRemittance(invoiceId: number, body: { payer?: string; reference?: string; amount?: number }) {
  const res = await fetch(`/api/invoices/${invoiceId}/remittance-events`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return jsonOrThrow(res);
}

export async function patchDenialStatus(denialId: number, status: string) {
  const res = await fetch(`/api/denials/${denialId}/status`, {
    method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
  });
  return jsonOrThrow(res);
}
