import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  insuranceEligibilityReviews,
  type InsuranceEligibilityReview,
  type InsertInsuranceEligibilityReview,
} from "@shared/schema/insuranceEligibility";

export type ListInsuranceEligibilityReviewsFilters = {
  executionCaseId?: number;
  patientScreeningId?: number;
  facilityId?: string;
  eligibilityStatus?: string;
  approvalStatus?: string;
  priorityClass?: string;
  insuranceType?: string;
};

export async function createInsuranceEligibilityReview(
  input: InsertInsuranceEligibilityReview,
): Promise<InsuranceEligibilityReview> {
  const [result] = await db
    .insert(insuranceEligibilityReviews)
    .values(input)
    .returning();
  return result;
}

export async function updateInsuranceEligibilityReview(
  id: number,
  updates: Partial<InsertInsuranceEligibilityReview>,
): Promise<InsuranceEligibilityReview | undefined> {
  const [result] = await db
    .update(insuranceEligibilityReviews)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(insuranceEligibilityReviews.id, id))
    .returning();
  return result;
}

export async function getInsuranceEligibilityReviewById(id: number): Promise<InsuranceEligibilityReview | undefined> {
  const [result] = await db
    .select()
    .from(insuranceEligibilityReviews)
    .where(eq(insuranceEligibilityReviews.id, id))
    .limit(1);
  return result;
}

export async function listInsuranceEligibilityReviews(
  filters: ListInsuranceEligibilityReviewsFilters = {},
  limit = 100,
): Promise<InsuranceEligibilityReview[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.executionCaseId != null) conditions.push(eq(insuranceEligibilityReviews.executionCaseId, filters.executionCaseId));
  if (filters.patientScreeningId != null) conditions.push(eq(insuranceEligibilityReviews.patientScreeningId, filters.patientScreeningId));
  if (filters.facilityId) conditions.push(eq(insuranceEligibilityReviews.facilityId, filters.facilityId));
  if (filters.eligibilityStatus) conditions.push(eq(insuranceEligibilityReviews.eligibilityStatus, filters.eligibilityStatus));
  if (filters.approvalStatus) conditions.push(eq(insuranceEligibilityReviews.approvalStatus, filters.approvalStatus));
  if (filters.priorityClass) conditions.push(eq(insuranceEligibilityReviews.priorityClass, filters.priorityClass));
  if (filters.insuranceType) conditions.push(eq(insuranceEligibilityReviews.insuranceType, filters.insuranceType));

  const query = db.select().from(insuranceEligibilityReviews).$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(insuranceEligibilityReviews.createdAt)).limit(safeLimit)
    : query.orderBy(desc(insuranceEligibilityReviews.createdAt)).limit(safeLimit);
}
