import { db } from "../db";
import { eq, and, or, asc, desc, gte, lte, inArray, ilike, sql } from "drizzle-orm";
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

export type UpsertAncillaryScheduleInput = {
  executionCaseId?: number | null;
  patientScreeningId?: number | null;
  patientName?: string | null;
  patientDob?: string | null;
  facilityId?: string | null;
  serviceType: string;
  startsAt: Date;
  endsAt?: Date | null;
  assignedUserId?: string | null;
  source?: string;
  note?: string | null;
  metadata?: Record<string, unknown>;
};

/** Upsert an ancillary_appointment global_schedule_event. Dedup contract:
 *  one row per (patient_screening_id, service_type, starts_at). Falls back
 *  to (execution_case_id, service_type, starts_at) when patient_screening_id
 *  is unavailable. status defaults to "scheduled"; metadata is merged with
 *  existing JSON when updating an existing row. */
export async function upsertAncillaryScheduleEvent(
  input: UpsertAncillaryScheduleInput,
): Promise<{ event: GlobalScheduleEvent; created: boolean }> {
  if (!input.serviceType) throw new Error("serviceType is required");
  if (!(input.startsAt instanceof Date) || isNaN(input.startsAt.getTime())) {
    throw new Error("startsAt must be a valid Date");
  }

  const dedupeConditions = [eq(globalScheduleEvents.eventType, "ancillary_appointment")];
  if (input.patientScreeningId != null) {
    dedupeConditions.push(eq(globalScheduleEvents.patientScreeningId, input.patientScreeningId));
  } else if (input.executionCaseId != null) {
    dedupeConditions.push(eq(globalScheduleEvents.executionCaseId, input.executionCaseId));
  } else {
    throw new Error("executionCaseId or patientScreeningId is required");
  }
  dedupeConditions.push(eq(globalScheduleEvents.serviceType, input.serviceType));
  dedupeConditions.push(eq(globalScheduleEvents.startsAt, input.startsAt));

  const [existing] = await db
    .select()
    .from(globalScheduleEvents)
    .where(and(...dedupeConditions))
    .limit(1);

  const baseMetadata: Record<string, unknown> = {
    ...(input.metadata ?? {}),
    note: input.note ?? null,
    upsertSource: "schedule_ancillary_action",
  };

  if (existing) {
    const mergedMetadata = {
      ...((existing.metadata as Record<string, unknown> | null) ?? {}),
      ...baseMetadata,
    };
    const [updated] = await db
      .update(globalScheduleEvents)
      .set({
        executionCaseId: input.executionCaseId ?? existing.executionCaseId ?? undefined,
        patientScreeningId: input.patientScreeningId ?? existing.patientScreeningId ?? undefined,
        patientName: input.patientName ?? existing.patientName ?? undefined,
        patientDob: input.patientDob ?? existing.patientDob ?? undefined,
        facilityId: input.facilityId ?? existing.facilityId ?? undefined,
        serviceType: input.serviceType,
        source: input.source ?? existing.source,
        status: "scheduled",
        startsAt: input.startsAt,
        endsAt: input.endsAt ?? existing.endsAt ?? undefined,
        assignedUserId: input.assignedUserId ?? existing.assignedUserId ?? undefined,
        metadata: mergedMetadata,
        updatedAt: new Date(),
      })
      .where(eq(globalScheduleEvents.id, existing.id))
      .returning();
    return { event: updated, created: false };
  }

  const [created] = await db
    .insert(globalScheduleEvents)
    .values({
      executionCaseId: input.executionCaseId ?? undefined,
      patientScreeningId: input.patientScreeningId ?? undefined,
      patientName: input.patientName ?? undefined,
      patientDob: input.patientDob ?? undefined,
      facilityId: input.facilityId ?? undefined,
      eventType: "ancillary_appointment",
      serviceType: input.serviceType,
      source: input.source ?? "scheduler_portal",
      status: "scheduled",
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? undefined,
      assignedUserId: input.assignedUserId ?? undefined,
      metadata: baseMetadata,
    })
    .returning();
  return { event: created, created: true };
}

export type ListTechnicianLiaisonFilters = {
  facilityId?: string;
  assignedUserId?: string;
  serviceType?: string;
  startDate?: Date;
  endDate?: Date;
};

const CLINIC_VISIT_EVENT_TYPES = ["doctor_visit", "same_day_add"] as const;
const ANCILLARY_SCHEDULE_EVENT_TYPES = ["ancillary_appointment", "same_day_add"] as const;

/** Technician Liaison clinic visits: doctor_visit + same_day_add events
 *  ordered by startsAt ASC. */
export async function listTechnicianLiaisonClinicVisits(
  filters: ListTechnicianLiaisonFilters = {},
  limit = 100,
): Promise<GlobalScheduleEvent[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [
    inArray(globalScheduleEvents.eventType, [...CLINIC_VISIT_EVENT_TYPES]),
  ];
  if (filters.facilityId) conditions.push(eq(globalScheduleEvents.facilityId, filters.facilityId));
  if (filters.assignedUserId) conditions.push(eq(globalScheduleEvents.assignedUserId, filters.assignedUserId));
  if (filters.startDate) conditions.push(gte(globalScheduleEvents.startsAt, filters.startDate));
  if (filters.endDate) conditions.push(lte(globalScheduleEvents.startsAt, filters.endDate));

  return db
    .select()
    .from(globalScheduleEvents)
    .where(and(...conditions))
    .orderBy(asc(globalScheduleEvents.startsAt))
    .limit(safeLimit);
}

/** Technician Liaison ancillary schedule: ancillary_appointment + same_day_add
 *  events ordered by startsAt ASC. */
export async function listTechnicianLiaisonAncillarySchedule(
  filters: ListTechnicianLiaisonFilters = {},
  limit = 100,
): Promise<GlobalScheduleEvent[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [
    inArray(globalScheduleEvents.eventType, [...ANCILLARY_SCHEDULE_EVENT_TYPES]),
  ];
  if (filters.facilityId) conditions.push(eq(globalScheduleEvents.facilityId, filters.facilityId));
  if (filters.assignedUserId) conditions.push(eq(globalScheduleEvents.assignedUserId, filters.assignedUserId));
  if (filters.serviceType) conditions.push(eq(globalScheduleEvents.serviceType, filters.serviceType));
  if (filters.startDate) conditions.push(gte(globalScheduleEvents.startsAt, filters.startDate));
  if (filters.endDate) conditions.push(lte(globalScheduleEvents.startsAt, filters.endDate));

  return db
    .select()
    .from(globalScheduleEvents)
    .where(and(...conditions))
    .orderBy(asc(globalScheduleEvents.startsAt))
    .limit(safeLimit);
}

// ─── Ultrasound Tech reads ────────────────────────────────────────────────────

const ULTRASOUND_EVENT_TYPES = ["ancillary_appointment", "same_day_add"] as const;
const ULTRASOUND_SPECIFIC_SERVICE_NAMES = ["Ultrasound", "VitalWave", "BrainWave"] as const;

export type ListUltrasoundTechScheduleFilters = {
  assignedUserId?: string;
  facilityId?: string;
  serviceType?: string;
  status?: string;
  startDate?: Date;
  endDate?: Date;
};

/** Ultrasound Tech schedule: ancillary_appointment + same_day_add events
 *  filtered to ultrasound-relevant service types when no explicit serviceType
 *  is provided. Ordered by startsAt ASC. */
export async function listUltrasoundTechSchedule(
  filters: ListUltrasoundTechScheduleFilters = {},
  limit = 100,
): Promise<GlobalScheduleEvent[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [
    inArray(globalScheduleEvents.eventType, [...ULTRASOUND_EVENT_TYPES]),
  ];

  if (filters.serviceType) {
    conditions.push(eq(globalScheduleEvents.serviceType, filters.serviceType));
  } else {
    const ultrasoundFilter = or(
      ilike(globalScheduleEvents.serviceType, "%ultrasound%"),
      inArray(globalScheduleEvents.serviceType, [...ULTRASOUND_SPECIFIC_SERVICE_NAMES]),
    );
    if (ultrasoundFilter) conditions.push(ultrasoundFilter);
  }

  if (filters.assignedUserId) conditions.push(eq(globalScheduleEvents.assignedUserId, filters.assignedUserId));
  if (filters.facilityId) conditions.push(eq(globalScheduleEvents.facilityId, filters.facilityId));
  if (filters.status) conditions.push(eq(globalScheduleEvents.status, filters.status));
  if (filters.startDate) conditions.push(gte(globalScheduleEvents.startsAt, filters.startDate));
  if (filters.endDate) conditions.push(lte(globalScheduleEvents.startsAt, filters.endDate));

  return db
    .select()
    .from(globalScheduleEvents)
    .where(and(...conditions))
    .orderBy(asc(globalScheduleEvents.startsAt))
    .limit(safeLimit);
}

// ─── Team availability blocks (PTO / sick / unavailable) ─────────────────────

const TEAM_BLOCK_EVENT_TYPES = ["pto_block", "sick_day", "unavailable_block"] as const;
export type TeamBlockEventType = typeof TEAM_BLOCK_EVENT_TYPES[number];

export type CreateScheduleBlockFromPtoInput = {
  ptoId: number;
  userId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  eventType?: TeamBlockEventType;
  note?: string | null;
  facilityId?: string | null;
};

function parseDateBoundary(dateStr: string, boundary: "start" | "end"): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = boundary === "start"
    ? new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0)
    : new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
  return isNaN(dt.getTime()) ? null : dt;
}

/** Create or update a team-availability block in global_schedule_events for a
 *  PTO/sick/unavailable record. Deduplicates by metadata.ptoId so re-approving
 *  or re-running the hook keeps a single block per PTO request. Returns null
 *  when the dates can't be parsed. */
export async function createGlobalScheduleBlockFromPto(
  input: CreateScheduleBlockFromPtoInput,
): Promise<{ event: GlobalScheduleEvent; created: boolean } | null> {
  const startsAt = parseDateBoundary(input.startDate, "start");
  const endsAt = parseDateBoundary(input.endDate, "end");
  if (!startsAt || !endsAt) return null;

  const eventType: TeamBlockEventType = input.eventType ?? "pto_block";

  // Dedupe by jsonb metadata.ptoId
  const [existing] = await db
    .select()
    .from(globalScheduleEvents)
    .where(sql`(${globalScheduleEvents.metadata}->>'ptoId')::int = ${input.ptoId}`)
    .limit(1);

  const payload = {
    eventType,
    source: "team_ops" as const,
    status: "blocked" as const,
    assignedUserId: input.userId,
    facilityId: input.facilityId ?? undefined,
    startsAt,
    endsAt,
    metadata: {
      ptoId: input.ptoId,
      type: eventType,
      reason: input.note ?? null,
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
    .values(payload)
    .returning();
  return { event: created, created: true };
}

export type ListTeamAvailabilityBlocksFilters = {
  assignedUserId?: string;
  facilityId?: string;
  eventType?: TeamBlockEventType;
  startDate?: Date;
  endDate?: Date;
};

/** List team availability blocks (pto_block / sick_day / unavailable_block)
 *  ordered by startsAt ASC. */
export async function listTeamAvailabilityBlocks(
  filters: ListTeamAvailabilityBlocksFilters = {},
  limit = 100,
): Promise<GlobalScheduleEvent[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const conditions = [];

  if (filters.eventType) {
    conditions.push(eq(globalScheduleEvents.eventType, filters.eventType));
  } else {
    conditions.push(inArray(globalScheduleEvents.eventType, [...TEAM_BLOCK_EVENT_TYPES]));
  }
  if (filters.assignedUserId) conditions.push(eq(globalScheduleEvents.assignedUserId, filters.assignedUserId));
  if (filters.facilityId) conditions.push(eq(globalScheduleEvents.facilityId, filters.facilityId));
  if (filters.startDate) conditions.push(gte(globalScheduleEvents.startsAt, filters.startDate));
  if (filters.endDate) conditions.push(lte(globalScheduleEvents.startsAt, filters.endDate));

  return db
    .select()
    .from(globalScheduleEvents)
    .where(and(...conditions))
    .orderBy(asc(globalScheduleEvents.startsAt))
    .limit(safeLimit);
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
