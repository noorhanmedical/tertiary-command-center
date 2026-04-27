import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  projectedInvoiceRows,
  type ProjectedInvoiceRow,
  type InsertProjectedInvoiceRow,
} from "@shared/schema/projectedInvoices";

export type ListProjectedInvoiceRowsFilters = {
  executionCaseId?: number;
  patientScreeningId?: number;
  procedureEventId?: number;
  facilityId?: string;
  serviceType?: string;
  projectedStatus?: string;
  realInvoiceLineItemId?: number;
};

export async function createProjectedInvoiceRow(
  input: InsertProjectedInvoiceRow,
): Promise<ProjectedInvoiceRow> {
  const [result] = await db.insert(projectedInvoiceRows).values(input).returning();
  return result;
}

export async function updateProjectedInvoiceRow(
  id: number,
  updates: Partial<InsertProjectedInvoiceRow>,
): Promise<ProjectedInvoiceRow | undefined> {
  const [result] = await db
    .update(projectedInvoiceRows)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(projectedInvoiceRows.id, id))
    .returning();
  return result;
}

export async function getProjectedInvoiceRowById(id: number): Promise<ProjectedInvoiceRow | undefined> {
  const [result] = await db
    .select()
    .from(projectedInvoiceRows)
    .where(eq(projectedInvoiceRows.id, id))
    .limit(1);
  return result;
}

export async function listProjectedInvoiceRows(
  filters: ListProjectedInvoiceRowsFilters = {},
  limit = 100,
): Promise<ProjectedInvoiceRow[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.executionCaseId != null) conditions.push(eq(projectedInvoiceRows.executionCaseId, filters.executionCaseId));
  if (filters.patientScreeningId != null) conditions.push(eq(projectedInvoiceRows.patientScreeningId, filters.patientScreeningId));
  if (filters.procedureEventId != null) conditions.push(eq(projectedInvoiceRows.procedureEventId, filters.procedureEventId));
  if (filters.facilityId) conditions.push(eq(projectedInvoiceRows.facilityId, filters.facilityId));
  if (filters.serviceType) conditions.push(eq(projectedInvoiceRows.serviceType, filters.serviceType));
  if (filters.projectedStatus) conditions.push(eq(projectedInvoiceRows.projectedStatus, filters.projectedStatus));
  if (filters.realInvoiceLineItemId != null) conditions.push(eq(projectedInvoiceRows.realInvoiceLineItemId, filters.realInvoiceLineItemId));

  const query = db.select().from(projectedInvoiceRows).$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(projectedInvoiceRows.createdAt)).limit(safeLimit)
    : query.orderBy(desc(projectedInvoiceRows.createdAt)).limit(safeLimit);
}
