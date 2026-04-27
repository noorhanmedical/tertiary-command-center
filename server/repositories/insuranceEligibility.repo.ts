import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  insuranceEligibilityReviews,
  type InsuranceEligibilityReview,
  type InsertInsuranceEligibilityReview,
} from "@shared/schema/insuranceEligibility";
import type { PatientScreening } from "@shared/schema/screening";

type DerivedEligibility = {
  priorityClass: string;
  eligibilityStatus: string;
  approvalStatus: string;
};

function deriveEligibility(insurance: string | null | undefined): DerivedEligibility {
  const raw = (insurance ?? "").toLowerCase();

  if (!raw.trim()) {
    return { priorityClass: "unknown", eligibilityStatus: "unknown", approvalStatus: "pending" };
  }

  const hasMedicare = raw.includes("medicare");
  const isAdvantage = raw.includes("advantage") || raw.includes("replacement") || raw.includes("mapd");
  const isStraightMedicare = hasMedicare && !isAdvantage;
  const isPpo = raw.includes("ppo");

  if (isStraightMedicare) {
    return { priorityClass: "straight_medicare", eligibilityStatus: "preferred", approvalStatus: "not_required" };
  }
  if (isPpo) {
    return { priorityClass: "ppo", eligibilityStatus: "allowed", approvalStatus: "not_required" };
  }
  return { priorityClass: "other", eligibilityStatus: "requires_admin_approval", approvalStatus: "pending" };
}

/** Upsert an insurance eligibility review from a screening commit.
 *  Deduplicates by patientScreeningId — updates in place if one already exists. */
export async function createOrUpdateInsuranceEligibilityReviewFromScreening(
  screening: PatientScreening,
  executionCaseId: number,
): Promise<{ review: InsuranceEligibilityReview; created: boolean }> {
  const { priorityClass, eligibilityStatus, approvalStatus } = deriveEligibility(screening.insurance);

  const [existing] = await db
    .select()
    .from(insuranceEligibilityReviews)
    .where(eq(insuranceEligibilityReviews.patientScreeningId, screening.id))
    .limit(1);

  const payload = {
    executionCaseId,
    patientName: screening.name,
    patientDob: screening.dob ?? undefined,
    facilityId: screening.facility ?? undefined,
    insuranceName: screening.insurance ?? undefined,
    insuranceType: priorityClass,
    eligibilityStatus,
    approvalStatus,
    priorityClass,
  };

  if (existing) {
    const [updated] = await db
      .update(insuranceEligibilityReviews)
      .set({ ...payload, updatedAt: new Date() })
      .where(eq(insuranceEligibilityReviews.id, existing.id))
      .returning();
    return { review: updated, created: false };
  }

  const [created] = await db
    .insert(insuranceEligibilityReviews)
    .values({ ...payload, patientScreeningId: screening.id })
    .returning();
  return { review: created, created: true };
}

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
