import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  cooldownRecords,
  type CooldownRecord,
  type InsertCooldownRecord,
} from "@shared/schema/cooldown";

export type ListCooldownRecordsFilters = {
  executionCaseId?: number;
  patientScreeningId?: number;
  facilityId?: string;
  serviceType?: string;
  cooldownStatus?: string;
  overrideStatus?: string;
};

export async function createCooldownRecord(
  input: InsertCooldownRecord,
): Promise<CooldownRecord> {
  const [result] = await db
    .insert(cooldownRecords)
    .values(input)
    .returning();
  return result;
}

export async function updateCooldownRecord(
  id: number,
  updates: Partial<InsertCooldownRecord>,
): Promise<CooldownRecord | undefined> {
  const [result] = await db
    .update(cooldownRecords)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(cooldownRecords.id, id))
    .returning();
  return result;
}

export async function getCooldownRecordById(id: number): Promise<CooldownRecord | undefined> {
  const [result] = await db
    .select()
    .from(cooldownRecords)
    .where(eq(cooldownRecords.id, id))
    .limit(1);
  return result;
}

export async function listCooldownRecords(
  filters: ListCooldownRecordsFilters = {},
  limit = 100,
): Promise<CooldownRecord[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.executionCaseId != null) conditions.push(eq(cooldownRecords.executionCaseId, filters.executionCaseId));
  if (filters.patientScreeningId != null) conditions.push(eq(cooldownRecords.patientScreeningId, filters.patientScreeningId));
  if (filters.facilityId) conditions.push(eq(cooldownRecords.facilityId, filters.facilityId));
  if (filters.serviceType) conditions.push(eq(cooldownRecords.serviceType, filters.serviceType));
  if (filters.cooldownStatus) conditions.push(eq(cooldownRecords.cooldownStatus, filters.cooldownStatus));
  if (filters.overrideStatus) conditions.push(eq(cooldownRecords.overrideStatus, filters.overrideStatus));

  const query = db.select().from(cooldownRecords).$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(cooldownRecords.createdAt)).limit(safeLimit)
    : query.orderBy(desc(cooldownRecords.createdAt)).limit(safeLimit);
}
