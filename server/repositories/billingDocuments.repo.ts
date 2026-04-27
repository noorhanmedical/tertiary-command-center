import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  billingDocumentRequests,
  type BillingDocumentRequest,
  type InsertBillingDocumentRequest,
} from "@shared/schema/billingDocuments";
import type { BillingReadinessCheck } from "@shared/schema/billingReadiness";

export type ListBillingDocumentRequestsFilters = {
  executionCaseId?: number;
  patientScreeningId?: number;
  procedureEventId?: number;
  billingReadinessCheckId?: number;
  serviceType?: string;
  requestStatus?: string;
};

export async function createBillingDocumentRequest(
  input: InsertBillingDocumentRequest,
): Promise<BillingDocumentRequest> {
  const [result] = await db.insert(billingDocumentRequests).values(input).returning();
  return result;
}

export async function updateBillingDocumentRequest(
  id: number,
  updates: Partial<InsertBillingDocumentRequest>,
): Promise<BillingDocumentRequest | undefined> {
  const [result] = await db
    .update(billingDocumentRequests)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(billingDocumentRequests.id, id))
    .returning();
  return result;
}

export async function getBillingDocumentRequestById(id: number): Promise<BillingDocumentRequest | undefined> {
  const [result] = await db
    .select()
    .from(billingDocumentRequests)
    .where(eq(billingDocumentRequests.id, id))
    .limit(1);
  return result;
}

export async function listBillingDocumentRequests(
  filters: ListBillingDocumentRequestsFilters = {},
  limit = 100,
): Promise<BillingDocumentRequest[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.executionCaseId != null) conditions.push(eq(billingDocumentRequests.executionCaseId, filters.executionCaseId));
  if (filters.patientScreeningId != null) conditions.push(eq(billingDocumentRequests.patientScreeningId, filters.patientScreeningId));
  if (filters.procedureEventId != null) conditions.push(eq(billingDocumentRequests.procedureEventId, filters.procedureEventId));
  if (filters.billingReadinessCheckId != null) conditions.push(eq(billingDocumentRequests.billingReadinessCheckId, filters.billingReadinessCheckId));
  if (filters.serviceType) conditions.push(eq(billingDocumentRequests.serviceType, filters.serviceType));
  if (filters.requestStatus) conditions.push(eq(billingDocumentRequests.requestStatus, filters.requestStatus));

  const query = db.select().from(billingDocumentRequests).$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(billingDocumentRequests.createdAt)).limit(safeLimit)
    : query.orderBy(desc(billingDocumentRequests.createdAt)).limit(safeLimit);
}

/** Create or update a pending billing_document_request when readiness is ready_to_generate.
 *  Primary dedup: billingReadinessCheckId.
 *  Fallback dedup: procedureEventId + serviceType. */
export async function createPendingBillingDocumentRequestFromReadiness(
  check: BillingReadinessCheck,
): Promise<BillingDocumentRequest> {
  // Try to find existing by billingReadinessCheckId first
  let existing: BillingDocumentRequest | undefined;

  const [byReadiness] = await db
    .select()
    .from(billingDocumentRequests)
    .where(eq(billingDocumentRequests.billingReadinessCheckId, check.id))
    .limit(1);
  existing = byReadiness;

  // Fallback: match by procedureEventId + serviceType
  if (!existing && check.procedureEventId != null) {
    const [byProcedure] = await db
      .select()
      .from(billingDocumentRequests)
      .where(
        and(
          eq(billingDocumentRequests.procedureEventId, check.procedureEventId),
          eq(billingDocumentRequests.serviceType, check.serviceType),
        ),
      )
      .limit(1);
    existing = byProcedure;
  }

  const sharedFields = {
    executionCaseId: check.executionCaseId ?? undefined,
    patientScreeningId: check.patientScreeningId ?? undefined,
    procedureEventId: check.procedureEventId ?? undefined,
    billingReadinessCheckId: check.id,
    patientName: check.patientName ?? undefined,
    patientDob: check.patientDob ?? undefined,
    facilityId: check.facilityId ?? undefined,
    serviceType: check.serviceType,
    requestStatus: "pending" as const,
    generatedByAi: false,
    metadata: { triggeredByReadinessCheckId: check.id },
  };

  if (existing) {
    const [updated] = await db
      .update(billingDocumentRequests)
      .set({ ...sharedFields, updatedAt: new Date() })
      .where(eq(billingDocumentRequests.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(billingDocumentRequests)
    .values(sharedFields)
    .returning();
  return created;
}
