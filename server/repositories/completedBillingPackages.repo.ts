import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  completedBillingPackages,
  type CompletedBillingPackage,
  type InsertCompletedBillingPackage,
} from "@shared/schema/completedBillingPackages";

export type ListCompletedBillingPackagesFilters = {
  executionCaseId?: number;
  patientScreeningId?: number;
  procedureEventId?: number;
  billingReadinessCheckId?: number;
  billingDocumentRequestId?: number;
  facilityId?: string;
  serviceType?: string;
  packageStatus?: string;
  paymentStatus?: string;
};

export async function createCompletedBillingPackage(
  input: InsertCompletedBillingPackage,
): Promise<CompletedBillingPackage> {
  const [result] = await db.insert(completedBillingPackages).values(input).returning();
  return result;
}

export async function updateCompletedBillingPackage(
  id: number,
  updates: Partial<InsertCompletedBillingPackage>,
): Promise<CompletedBillingPackage | undefined> {
  const [result] = await db
    .update(completedBillingPackages)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(completedBillingPackages.id, id))
    .returning();
  return result;
}

export async function getCompletedBillingPackageById(id: number): Promise<CompletedBillingPackage | undefined> {
  const [result] = await db
    .select()
    .from(completedBillingPackages)
    .where(eq(completedBillingPackages.id, id))
    .limit(1);
  return result;
}

export type UpdatePaymentInput = {
  fullAmountPaid: string;
  paymentDate?: string | null;
  paymentStatus?: string;
  note?: string | null;
  metadata?: Record<string, unknown>;
  paymentUpdatedByUserId?: string | null;
};

export async function updateCompletedBillingPackagePayment(
  id: number,
  input: UpdatePaymentInput,
): Promise<CompletedBillingPackage | undefined> {
  const existing = await getCompletedBillingPackageById(id);
  if (!existing) return undefined;

  const now = new Date();
  const mergedMetadata: Record<string, unknown> = {
    ...(typeof existing.metadata === "object" && existing.metadata !== null ? existing.metadata as Record<string, unknown> : {}),
    ...(input.metadata ?? {}),
    ...(input.note != null ? { paymentNote: input.note } : {}),
  };

  const [result] = await db
    .update(completedBillingPackages)
    .set({
      fullAmountPaid: input.fullAmountPaid,
      paymentDate: input.paymentDate ?? undefined,
      paymentStatus: input.paymentStatus ?? "updated",
      packageStatus: "completed_package",
      paymentUpdatedAt: now,
      paymentUpdatedByUserId: input.paymentUpdatedByUserId ?? undefined,
      metadata: mergedMetadata,
      updatedAt: now,
    })
    .where(eq(completedBillingPackages.id, id))
    .returning();
  return result;
}

export async function listCompletedBillingPackages(
  filters: ListCompletedBillingPackagesFilters = {},
  limit = 100,
): Promise<CompletedBillingPackage[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.executionCaseId != null) conditions.push(eq(completedBillingPackages.executionCaseId, filters.executionCaseId));
  if (filters.patientScreeningId != null) conditions.push(eq(completedBillingPackages.patientScreeningId, filters.patientScreeningId));
  if (filters.procedureEventId != null) conditions.push(eq(completedBillingPackages.procedureEventId, filters.procedureEventId));
  if (filters.billingReadinessCheckId != null) conditions.push(eq(completedBillingPackages.billingReadinessCheckId, filters.billingReadinessCheckId));
  if (filters.billingDocumentRequestId != null) conditions.push(eq(completedBillingPackages.billingDocumentRequestId, filters.billingDocumentRequestId));
  if (filters.facilityId) conditions.push(eq(completedBillingPackages.facilityId, filters.facilityId));
  if (filters.serviceType) conditions.push(eq(completedBillingPackages.serviceType, filters.serviceType));
  if (filters.packageStatus) conditions.push(eq(completedBillingPackages.packageStatus, filters.packageStatus));
  if (filters.paymentStatus) conditions.push(eq(completedBillingPackages.paymentStatus, filters.paymentStatus));

  const query = db.select().from(completedBillingPackages).$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(completedBillingPackages.createdAt)).limit(safeLimit)
    : query.orderBy(desc(completedBillingPackages.createdAt)).limit(safeLimit);
}
