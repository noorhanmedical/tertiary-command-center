// invoiceFinancialService — Phase 4 PR 4.6.
//
// Posts payments / adjustments / denials / remittance events
// against an invoice and recomputes its totals.
// Honest "paid" only when totalBalance <= 0 (or explicit close).

import { db } from "../../db";
import { eq } from "drizzle-orm";
import { invoices, invoicePayments } from "@shared/schema/invoices";
import {
  invoiceAdjustments, invoiceDenials, remittanceEvents,
} from "@shared/schema/invoiceFinancialEvents";

export async function recomputeInvoiceTotals(invoiceId: number): Promise<{ totalPaid: number; totalAdjusted: number; totalBalance: number } | null> {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!inv) return null;
  const charges = Number(inv.totalCharges ?? 0);
  const initialPaid = Number(inv.initialPaid ?? 0);

  const payments = await db.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, invoiceId));
  const adjustments = await db.select().from(invoiceAdjustments).where(eq(invoiceAdjustments.invoiceId, invoiceId));

  let totalPaid = initialPaid;
  for (const p of payments) totalPaid += Number(p.amount ?? 0);

  let totalAdjusted = 0;
  for (const a of adjustments) totalAdjusted += Number(a.amount ?? 0);

  const totalBalance = Number((charges - totalPaid - totalAdjusted).toFixed(2));
  const status = (() => {
    if (totalBalance <= 0) return "Paid";
    if (totalPaid > 0 || totalAdjusted > 0) return "Partially Paid";
    return inv.status; // leave existing legacy status alone
  })();

  await db.update(invoices).set({
    totalPaid: String(totalPaid.toFixed(2)),
    totalBalance: String(totalBalance.toFixed(2)),
    status,
  }).where(eq(invoices.id, invoiceId));

  return { totalPaid, totalAdjusted, totalBalance };
}

export type PostPaymentInput = {
  invoiceId: number;
  amount: number;
  paymentDate?: string | null;
  paymentMethod?: string | null;
  reference?: string | null;
  notes?: string | null;
  actorUserId: string | null;
};

export async function postPayment(input: PostPaymentInput): Promise<{ paymentId: number } | { error: string; status: 404 | 400 }> {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId)).limit(1);
  if (!inv) return { error: "Invoice not found", status: 404 };
  if (input.amount <= 0) return { error: "amount must be > 0", status: 400 };

  const [row] = await db.insert(invoicePayments).values({
    invoiceId: input.invoiceId,
    amount: String(input.amount.toFixed(2)),
    paymentDate: input.paymentDate ?? new Date().toISOString().slice(0, 10),
    paymentMethod: (input.paymentMethod ?? "Other") as any,
    reference: input.reference ?? null,
    notes: input.notes ?? null,
    recordedByUserId: input.actorUserId,
  } as any).returning();

  await db.insert(remittanceEvents).values({
    invoiceId: input.invoiceId,
    payer: null,
    reference: input.reference ?? null,
    amount: String(input.amount.toFixed(2)),
    eventType: "payment_posted",
    actorUserId: input.actorUserId,
    metadata: { paymentId: row.id },
  });

  await recomputeInvoiceTotals(input.invoiceId);
  return { paymentId: row.id };
}

export type PostAdjustmentInput = {
  invoiceId: number;
  lineItemId?: number | null;
  adjustmentType: string;
  amount: number;
  reason?: string | null;
  actorUserId: string | null;
};

export async function postAdjustment(input: PostAdjustmentInput): Promise<{ adjustmentId: number } | { error: string; status: 404 | 400 }> {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId)).limit(1);
  if (!inv) return { error: "Invoice not found", status: 404 };
  if (input.amount === 0) return { error: "amount must be non-zero", status: 400 };

  const [row] = await db.insert(invoiceAdjustments).values({
    invoiceId: input.invoiceId,
    lineItemId: input.lineItemId ?? null,
    adjustmentType: input.adjustmentType,
    amount: String(input.amount.toFixed(2)),
    reason: input.reason ?? null,
    actorUserId: input.actorUserId,
  } as any).returning();

  await db.insert(remittanceEvents).values({
    invoiceId: input.invoiceId,
    eventType: "adjustment_posted",
    amount: String(input.amount.toFixed(2)),
    actorUserId: input.actorUserId,
    metadata: { adjustmentId: row.id, adjustmentType: input.adjustmentType },
  });

  await recomputeInvoiceTotals(input.invoiceId);
  return { adjustmentId: row.id };
}

export type PostDenialInput = {
  invoiceId: number;
  lineItemId?: number | null;
  denialCode?: string | null;
  denialReason?: string | null;
  payer?: string | null;
  nextActionAt?: string | null;
  actorUserId: string | null;
};

export async function postDenial(input: PostDenialInput): Promise<{ denialId: number } | { error: string; status: 404 }> {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId)).limit(1);
  if (!inv) return { error: "Invoice not found", status: 404 };

  const [row] = await db.insert(invoiceDenials).values({
    invoiceId: input.invoiceId,
    lineItemId: input.lineItemId ?? null,
    denialCode: input.denialCode ?? null,
    denialReason: input.denialReason ?? null,
    payer: input.payer ?? null,
    status: "open",
    nextActionAt: input.nextActionAt ? new Date(input.nextActionAt) : null,
    actorUserId: input.actorUserId,
  } as any).returning();

  await db.insert(remittanceEvents).values({
    invoiceId: input.invoiceId,
    eventType: "denial_received",
    payer: input.payer ?? null,
    actorUserId: input.actorUserId,
    metadata: { denialId: row.id, denialCode: input.denialCode },
  });

  return { denialId: row.id };
}

export type PostRemittanceInput = {
  invoiceId: number;
  payer?: string | null;
  reference?: string | null;
  amount?: number | null;
  metadata?: Record<string, unknown>;
  actorUserId: string | null;
};

export async function postRemittanceEvent(input: PostRemittanceInput): Promise<{ eventId: number }> {
  const [row] = await db.insert(remittanceEvents).values({
    invoiceId: input.invoiceId,
    payer: input.payer ?? null,
    reference: input.reference ?? null,
    amount: input.amount != null ? String(input.amount.toFixed(2)) : null,
    eventType: "remittance_received",
    actorUserId: input.actorUserId,
    metadata: input.metadata ?? {},
  }).returning();
  return { eventId: row.id };
}

export async function patchDenialStatus(
  denialId: number,
  status: string,
  actorUserId: string | null,
): Promise<{ ok: true } | { error: string; status: 404 | 400 }> {
  const VALID = ["open", "appealed", "overturned", "upheld", "closed"];
  if (!VALID.includes(status)) return { error: "invalid status", status: 400 };
  const [row] = await db.update(invoiceDenials).set({ status, updatedAt: new Date() }).where(eq(invoiceDenials.id, denialId)).returning();
  if (!row) return { error: "Denial not found", status: 404 };
  return { ok: true };
}
