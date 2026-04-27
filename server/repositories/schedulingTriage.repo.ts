import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  schedulingTriageCases,
  type SchedulingTriageCase,
  type InsertSchedulingTriageCase,
} from "@shared/schema/schedulingTriage";

export type ListSchedulingTriageCasesFilters = {
  executionCaseId?: number;
  patientScreeningId?: number;
  globalScheduleEventId?: number;
  facilityId?: string;
  mainType?: string;
  subtype?: string;
  status?: string;
  assignedUserId?: string;
  nextOwnerRole?: string;
};

export async function createSchedulingTriageCase(
  input: InsertSchedulingTriageCase,
): Promise<SchedulingTriageCase> {
  const [result] = await db
    .insert(schedulingTriageCases)
    .values(input)
    .returning();
  return result;
}

export async function updateSchedulingTriageCase(
  id: number,
  updates: Partial<InsertSchedulingTriageCase>,
): Promise<SchedulingTriageCase | undefined> {
  const [result] = await db
    .update(schedulingTriageCases)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(schedulingTriageCases.id, id))
    .returning();
  return result;
}

export async function getSchedulingTriageCaseById(id: number): Promise<SchedulingTriageCase | undefined> {
  const [result] = await db
    .select()
    .from(schedulingTriageCases)
    .where(eq(schedulingTriageCases.id, id))
    .limit(1);
  return result;
}

export async function listSchedulingTriageCases(
  filters: ListSchedulingTriageCasesFilters = {},
  limit = 100,
): Promise<SchedulingTriageCase[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.executionCaseId != null) conditions.push(eq(schedulingTriageCases.executionCaseId, filters.executionCaseId));
  if (filters.patientScreeningId != null) conditions.push(eq(schedulingTriageCases.patientScreeningId, filters.patientScreeningId));
  if (filters.globalScheduleEventId != null) conditions.push(eq(schedulingTriageCases.globalScheduleEventId, filters.globalScheduleEventId));
  if (filters.facilityId) conditions.push(eq(schedulingTriageCases.facilityId, filters.facilityId));
  if (filters.mainType) conditions.push(eq(schedulingTriageCases.mainType, filters.mainType));
  if (filters.subtype) conditions.push(eq(schedulingTriageCases.subtype, filters.subtype));
  if (filters.status) conditions.push(eq(schedulingTriageCases.status, filters.status));
  if (filters.assignedUserId) conditions.push(eq(schedulingTriageCases.assignedUserId, filters.assignedUserId));
  if (filters.nextOwnerRole) conditions.push(eq(schedulingTriageCases.nextOwnerRole, filters.nextOwnerRole));

  const query = db.select().from(schedulingTriageCases).$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(schedulingTriageCases.createdAt)).limit(safeLimit)
    : query.orderBy(desc(schedulingTriageCases.createdAt)).limit(safeLimit);
}
