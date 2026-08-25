import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  plexusClinicalFindings,
  type PlexusClinicalFinding,
  type InsertPlexusClinicalFinding,
} from "@shared/schema/plexusClinicalFindings";

// ─── Filters ──────────────────────────────────────────────────────────────

export type ListFindingsFilters = {
  clinicId?: number;
  globalPlexusPatientId?: number;
  patientScreeningId?: number;
  facilityId?: string;
  findingType?: string;
  sourceType?: string;
  reviewStatus?: string;
  analysisRunId?: number;
  limit?: number;
};

// ─── Create ───────────────────────────────────────────────────────────────

export async function createFinding(
  input: InsertPlexusClinicalFinding,
): Promise<PlexusClinicalFinding> {
  const [result] = await db
    .insert(plexusClinicalFindings)
    .values(input)
    .returning();
  return result;
}

export async function createFindingsBulk(
  inputs: InsertPlexusClinicalFinding[],
): Promise<PlexusClinicalFinding[]> {
  if (inputs.length === 0) return [];
  const results = await db
    .insert(plexusClinicalFindings)
    .values(inputs)
    .returning();
  return results;
}

// ─── Read ─────────────────────────────────────────────────────────────────

export async function getFinding(id: number): Promise<PlexusClinicalFinding | undefined> {
  const [result] = await db
    .select()
    .from(plexusClinicalFindings)
    .where(eq(plexusClinicalFindings.id, id))
    .limit(1);
  return result;
}

export async function listFindings(
  filters: ListFindingsFilters = {},
): Promise<PlexusClinicalFinding[]> {
  const safeLimit = Math.min(Math.max(1, filters.limit ?? 200), 1000);
  const conditions = [];

  if (filters.clinicId != null) {
    conditions.push(eq(plexusClinicalFindings.clinicId, filters.clinicId));
  }
  if (filters.globalPlexusPatientId != null) {
    conditions.push(eq(plexusClinicalFindings.globalPlexusPatientId, filters.globalPlexusPatientId));
  }
  if (filters.patientScreeningId != null) {
    conditions.push(eq(plexusClinicalFindings.patientScreeningId, filters.patientScreeningId));
  }
  if (filters.facilityId) {
    conditions.push(eq(plexusClinicalFindings.facilityId, filters.facilityId));
  }
  if (filters.findingType) {
    conditions.push(eq(plexusClinicalFindings.findingType, filters.findingType));
  }
  if (filters.sourceType) {
    conditions.push(eq(plexusClinicalFindings.sourceType, filters.sourceType));
  }
  if (filters.reviewStatus) {
    conditions.push(eq(plexusClinicalFindings.reviewStatus, filters.reviewStatus));
  }
  if (filters.analysisRunId != null) {
    conditions.push(eq(plexusClinicalFindings.analysisRunId, filters.analysisRunId));
  }

  const query = db
    .select()
    .from(plexusClinicalFindings)
    .orderBy(desc(plexusClinicalFindings.createdAt))
    .limit(safeLimit);

  if (conditions.length > 0) {
    return query.where(and(...conditions));
  }
  return query;
}

export async function listFindingsForPatient(
  globalPlexusPatientId: number,
): Promise<PlexusClinicalFinding[]> {
  return db
    .select()
    .from(plexusClinicalFindings)
    .where(eq(plexusClinicalFindings.globalPlexusPatientId, globalPlexusPatientId))
    .orderBy(desc(plexusClinicalFindings.createdAt));
}

export async function listFindingsForScreening(
  patientScreeningId: number,
): Promise<PlexusClinicalFinding[]> {
  return db
    .select()
    .from(plexusClinicalFindings)
    .where(eq(plexusClinicalFindings.patientScreeningId, patientScreeningId))
    .orderBy(desc(plexusClinicalFindings.createdAt));
}

// ─── Update ───────────────────────────────────────────────────────────────

export async function updateFinding(
  id: number,
  updates: Partial<Omit<InsertPlexusClinicalFinding, "id">>,
): Promise<PlexusClinicalFinding | undefined> {
  const [result] = await db
    .update(plexusClinicalFindings)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(plexusClinicalFindings.id, id))
    .returning();
  return result;
}

// ─── Review ───────────────────────────────────────────────────────────────

export async function reviewFinding(
  id: number,
  review: {
    reviewStatus: string;
    reviewedByUserId: string;
    reviewNote?: string | null;
    confirmedIcd10?: string | null;
  },
): Promise<PlexusClinicalFinding | undefined> {
  const [result] = await db
    .update(plexusClinicalFindings)
    .set({
      reviewStatus: review.reviewStatus,
      reviewedByUserId: review.reviewedByUserId,
      reviewedAt: new Date(),
      reviewNote: review.reviewNote ?? undefined,
      confirmedIcd10: review.confirmedIcd10 ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(plexusClinicalFindings.id, id))
    .returning();
  return result;
}

// ─── Delete ───────────────────────────────────────────────────────────────

export async function deleteFinding(id: number): Promise<boolean> {
  const result = await db
    .delete(plexusClinicalFindings)
    .where(eq(plexusClinicalFindings.id, id));
  return (result as { rowCount?: number }).rowCount === 1;
}
