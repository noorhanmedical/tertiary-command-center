// invoiceFinancialEvents.repo.ts — Phase 5 architecture hardening.
//
// Extracted from server/routes/invoiceFinancialEvents.ts. Every read is
// bounded by invoiceId + orderBy created_at DESC.

import { db } from "../db";
import { desc, eq } from "drizzle-orm";
import { invoicePayments } from "@shared/schema/invoices";
import {
  invoiceAdjustments,
  invoiceDenials,
  remittanceEvents,
} from "@shared/schema/invoiceFinancialEvents";

export async function listPaymentsForInvoice(invoiceId: number) {
  return db
    .select()
    .from(invoicePayments)
    .where(eq(invoicePayments.invoiceId, invoiceId))
    .orderBy(desc(invoicePayments.createdAt));
}

export async function listAdjustmentsForInvoice(invoiceId: number) {
  return db
    .select()
    .from(invoiceAdjustments)
    .where(eq(invoiceAdjustments.invoiceId, invoiceId))
    .orderBy(desc(invoiceAdjustments.createdAt));
}

export async function listDenialsForInvoice(invoiceId: number) {
  return db
    .select()
    .from(invoiceDenials)
    .where(eq(invoiceDenials.invoiceId, invoiceId))
    .orderBy(desc(invoiceDenials.createdAt));
}

export async function listRemittanceEventsForInvoice(invoiceId: number) {
  return db
    .select()
    .from(remittanceEvents)
    .where(eq(remittanceEvents.invoiceId, invoiceId))
    .orderBy(desc(remittanceEvents.createdAt));
}

export async function loadFinancialEventsForInvoice(invoiceId: number) {
  const [payments, adjustments, denials, remittances] = await Promise.all([
    listPaymentsForInvoice(invoiceId),
    listAdjustmentsForInvoice(invoiceId),
    listDenialsForInvoice(invoiceId),
    listRemittanceEventsForInvoice(invoiceId),
  ]);
  return { payments, adjustments, denials, remittances };
}
