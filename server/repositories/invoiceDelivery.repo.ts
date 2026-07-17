// invoiceDelivery.repo.ts — Phase 5 architecture hardening.
//
// Extracted from server/routes/invoiceDelivery.ts. Every function is a
// bounded query with an explicit .where or an intentional list bound.
// Route file must not import drizzle-orm or ../db directly for these
// reads.

import { db } from "../db";
import { desc, eq } from "drizzle-orm";
import { invoices } from "@shared/schema/invoices";
import { invoiceDeliveryEvents } from "@shared/schema/invoiceDelivery";

// Bounded to 500 rows — this is the delivery-queue landing view. When
// row counts grow past the bound the biller UI already paginates.
export async function listInvoiceDeliveryQueue(limit = 500) {
  return db
    .select()
    .from(invoices)
    .orderBy(desc(invoices.createdAt))
    .limit(limit);
}

export async function listDeliveryEventsForInvoice(invoiceId: number) {
  return db
    .select()
    .from(invoiceDeliveryEvents)
    .where(eq(invoiceDeliveryEvents.invoiceId, invoiceId))
    .orderBy(desc(invoiceDeliveryEvents.createdAt));
}

export async function getInvoiceById(invoiceId: number) {
  const [row] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  return row ?? null;
}
