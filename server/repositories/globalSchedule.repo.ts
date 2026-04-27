import { db } from "../db";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import {
  globalScheduleEvents,
  type GlobalScheduleEvent,
  type InsertGlobalScheduleEvent,
} from "@shared/schema/globalSchedule";

export type ListGlobalScheduleEventsFilters = {
  facilityId?: string;
  eventType?: string;
  status?: string;
  assignedUserId?: string;
  assignedRole?: string;
  executionCaseId?: number;
  patientScreeningId?: number;
  startDate?: Date;
  endDate?: Date;
};

export async function createGlobalScheduleEvent(
  event: InsertGlobalScheduleEvent,
): Promise<GlobalScheduleEvent> {
  const [result] = await db
    .insert(globalScheduleEvents)
    .values(event)
    .returning();
  return result;
}

export async function updateGlobalScheduleEvent(
  id: number,
  updates: Partial<InsertGlobalScheduleEvent>,
): Promise<GlobalScheduleEvent | undefined> {
  const [result] = await db
    .update(globalScheduleEvents)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(globalScheduleEvents.id, id))
    .returning();
  return result;
}

export async function getGlobalScheduleEventById(id: number): Promise<GlobalScheduleEvent | undefined> {
  const [result] = await db
    .select()
    .from(globalScheduleEvents)
    .where(eq(globalScheduleEvents.id, id))
    .limit(1);
  return result;
}

export async function listGlobalScheduleEvents(
  filters: ListGlobalScheduleEventsFilters = {},
  limit = 100,
): Promise<GlobalScheduleEvent[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.facilityId) conditions.push(eq(globalScheduleEvents.facilityId, filters.facilityId));
  if (filters.eventType) conditions.push(eq(globalScheduleEvents.eventType, filters.eventType));
  if (filters.status) conditions.push(eq(globalScheduleEvents.status, filters.status));
  if (filters.assignedUserId) conditions.push(eq(globalScheduleEvents.assignedUserId, filters.assignedUserId));
  if (filters.assignedRole) conditions.push(eq(globalScheduleEvents.assignedRole, filters.assignedRole));
  if (filters.executionCaseId != null) conditions.push(eq(globalScheduleEvents.executionCaseId, filters.executionCaseId));
  if (filters.patientScreeningId != null) conditions.push(eq(globalScheduleEvents.patientScreeningId, filters.patientScreeningId));
  if (filters.startDate) conditions.push(gte(globalScheduleEvents.startsAt, filters.startDate));
  if (filters.endDate) conditions.push(lte(globalScheduleEvents.startsAt, filters.endDate));

  const query = db.select().from(globalScheduleEvents).$dynamic();

  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(desc(globalScheduleEvents.startsAt)).limit(safeLimit)
    : query.orderBy(desc(globalScheduleEvents.startsAt)).limit(safeLimit);
}
