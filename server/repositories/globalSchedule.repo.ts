import { db } from "../db";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import {
  globalScheduleEvents,
  type GlobalScheduleEvent,
  type InsertGlobalScheduleEvent,
} from "@shared/schema/globalSchedule";
import type { PatientScreening } from "@shared/schema/screening";
import { createSchedulingTriageCaseFromScheduleEvent } from "./schedulingTriage.repo";

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

  if (result && updates.status !== undefined) {
    void createSchedulingTriageCaseFromScheduleEvent(result).catch((err) => {
      console.error("[globalSchedule.repo] scheduling triage hook failed:", err);
    });
  }

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

/** Parse a YYYY-MM-DD date string + optional time string ("10:30 AM" / "14:00")
 *  into a Date. Returns null if the date string is missing or unparseable. */
function parseAppointmentDatetime(
  scheduleDate: string | null | undefined,
  timeStr: string | null | undefined,
): Date | null {
  if (!scheduleDate?.match(/^\d{4}-\d{2}-\d{2}$/)) return null;

  let hours = 0;
  let minutes = 0;

  if (timeStr) {
    const t = timeStr.trim().toUpperCase();
    const m12 = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
    const m24 = t.match(/^(\d{1,2}):(\d{2})$/);
    if (m12) {
      hours = parseInt(m12[1], 10);
      minutes = parseInt(m12[2], 10);
      if (m12[3] === "PM" && hours !== 12) hours += 12;
      if (m12[3] === "AM" && hours === 12) hours = 0;
    } else if (m24) {
      hours = parseInt(m24[1], 10);
      minutes = parseInt(m24[2], 10);
    }
  }

  const [y, mo, d] = scheduleDate.split("-").map(Number);
  const dt = new Date(y, mo - 1, d, hours, minutes, 0, 0);
  return isNaN(dt.getTime()) ? null : dt;
}

export type ScheduleCommitMeta = {
  auto: boolean;
  actorUserId: string | null;
};

/** Upsert a doctor_visit global_schedule_event from a screening commit.
 *  Returns the event + whether it was newly created, or null if there is
 *  no usable appointment datetime on the screening. */
export async function createGlobalScheduleEventFromScreeningCommit(
  screening: PatientScreening,
  executionCaseId: number,
  batchScheduleDate: string | null | undefined,
  meta: ScheduleCommitMeta,
): Promise<{ event: GlobalScheduleEvent; created: boolean } | null> {
  const startsAt = parseAppointmentDatetime(batchScheduleDate, screening.time);
  if (!startsAt) return null;

  // Deduplicate: one doctor_visit per patientScreeningId
  const [existing] = await db
    .select()
    .from(globalScheduleEvents)
    .where(
      and(
        eq(globalScheduleEvents.patientScreeningId, screening.id),
        eq(globalScheduleEvents.eventType, "doctor_visit"),
      ),
    )
    .limit(1);

  const payload = {
    executionCaseId,
    patientName: screening.name,
    patientDob: screening.dob ?? undefined,
    facilityId: screening.facility ?? undefined,
    eventType: "doctor_visit" as const,
    source: "screening_commit" as const,
    status: "scheduled" as const,
    startsAt,
    metadata: {
      auto: meta.auto,
      actorUserId: meta.actorUserId,
      rawTime: screening.time ?? null,
      rawScheduleDate: batchScheduleDate ?? null,
    },
  };

  if (existing) {
    const [updated] = await db
      .update(globalScheduleEvents)
      .set({ ...payload, updatedAt: new Date() })
      .where(eq(globalScheduleEvents.id, existing.id))
      .returning();
    return { event: updated, created: false };
  }

  const [created] = await db
    .insert(globalScheduleEvents)
    .values({ ...payload, patientScreeningId: screening.id })
    .returning();
  return { event: created, created: true };
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
