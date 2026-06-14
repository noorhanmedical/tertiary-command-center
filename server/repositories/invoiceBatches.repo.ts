import { db } from "../db";
import { and, eq, desc } from "drizzle-orm";
import {
  invoiceBatches, invoiceBatchItems,
  type InvoiceBatch, type InvoiceBatchItem,
} from "@shared/schema/invoiceBatches";

export async function listInvoiceBatches(filters: { facilityId?: string; batchStatus?: string } = {}, limit = 100): Promise<InvoiceBatch[]> {
  const conditions = [];
  if (filters.facilityId) conditions.push(eq(invoiceBatches.facilityId, filters.facilityId));
  if (filters.batchStatus) conditions.push(eq(invoiceBatches.batchStatus, filters.batchStatus));
  let q = db.select().from(invoiceBatches).$dynamic();
  if (conditions.length > 0) q = q.where(and(...conditions));
  return q.orderBy(desc(invoiceBatches.createdAt)).limit(Math.min(Math.max(1, limit), 500));
}

export async function getInvoiceBatchById(id: number): Promise<InvoiceBatch | undefined> {
  const [row] = await db.select().from(invoiceBatches).where(eq(invoiceBatches.id, id)).limit(1);
  return row;
}

export async function listInvoiceBatchItems(batchId: number): Promise<InvoiceBatchItem[]> {
  return db.select().from(invoiceBatchItems).where(eq(invoiceBatchItems.batchId, batchId));
}

export async function updateInvoiceBatchStatus(id: number, batchStatus: string): Promise<InvoiceBatch | undefined> {
  const [row] = await db
    .update(invoiceBatches)
    .set({ batchStatus, updatedAt: new Date() })
    .where(eq(invoiceBatches.id, id))
    .returning();
  return row;
}
