import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  ancillaryDocumentTemplates,
  type AncillaryDocumentTemplate,
  type InsertAncillaryDocumentTemplate,
} from "@shared/schema/ancillaryDocumentTemplates";

export type ListAncillaryDocumentTemplatesFilters = {
  serviceType?: string;
  documentType?: string;
  documentId?: number;
  facilityId?: string;
  active?: boolean;
  isDefault?: boolean;
  approvalStatus?: string;
  required?: boolean;
};

export async function createAncillaryDocumentTemplate(
  input: InsertAncillaryDocumentTemplate,
): Promise<AncillaryDocumentTemplate> {
  const [result] = await db.insert(ancillaryDocumentTemplates).values(input).returning();
  return result;
}

export async function updateAncillaryDocumentTemplate(
  id: number,
  updates: Partial<InsertAncillaryDocumentTemplate>,
): Promise<AncillaryDocumentTemplate | undefined> {
  const [result] = await db
    .update(ancillaryDocumentTemplates)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(ancillaryDocumentTemplates.id, id))
    .returning();
  return result;
}

export async function getAncillaryDocumentTemplateById(
  id: number,
): Promise<AncillaryDocumentTemplate | undefined> {
  const [result] = await db
    .select()
    .from(ancillaryDocumentTemplates)
    .where(eq(ancillaryDocumentTemplates.id, id))
    .limit(1);
  return result;
}

export async function listAncillaryDocumentTemplates(
  filters: ListAncillaryDocumentTemplatesFilters = {},
  limit = 100,
): Promise<AncillaryDocumentTemplate[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.serviceType) conditions.push(eq(ancillaryDocumentTemplates.serviceType, filters.serviceType));
  if (filters.documentType) conditions.push(eq(ancillaryDocumentTemplates.documentType, filters.documentType));
  if (filters.documentId != null) conditions.push(eq(ancillaryDocumentTemplates.documentId, filters.documentId));
  if (filters.facilityId) conditions.push(eq(ancillaryDocumentTemplates.facilityId, filters.facilityId));
  if (filters.active !== undefined) conditions.push(eq(ancillaryDocumentTemplates.active, filters.active));
  if (filters.isDefault !== undefined) conditions.push(eq(ancillaryDocumentTemplates.isDefault, filters.isDefault));
  if (filters.approvalStatus) conditions.push(eq(ancillaryDocumentTemplates.approvalStatus, filters.approvalStatus));
  if (filters.required !== undefined) conditions.push(eq(ancillaryDocumentTemplates.required, filters.required));

  const query = db.select().from(ancillaryDocumentTemplates).$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(ancillaryDocumentTemplates.createdAt)).limit(safeLimit)
    : query.orderBy(desc(ancillaryDocumentTemplates.createdAt)).limit(safeLimit);
}
