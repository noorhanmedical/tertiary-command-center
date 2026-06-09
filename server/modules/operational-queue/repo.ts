// Operational queue — read-only repository layer (Batch 11a).
//
// Four source queries, each mapped to OperationalQueueItem:
//
//   1. listCallListItemsForUser / ForFacility
//      ← scheduler_assignments JOIN outreach_schedulers JOIN patient_screenings
//
//   2. listSchedulerTasksFromPlexusForUser / ForFacility
//      ← plexus_tasks JOIN users JOIN plexus_projects (for facility)
//
//   3. listSchedulerTasksFromEngagementBoardForUser / ForFacility
//      ← patient_execution_cases JOIN outreach_schedulers (for assignee name)
//        JOIN patient_screenings (for patient context)
//      assignedTeamMemberId on patient_execution_cases is an int with no FK,
//      so the user-scoped variant matches `assignedTeamMemberId = scheduler.id`
//      (i.e. an outreach_schedulers.id mapped from a userId via outreach_schedulers.userId)
//
//   4. listVisitAppointmentsForFacility (NOT user-scoped — visit schedule is
//      facility-and-date scoped, not user-scoped today)
//      ← ancillary_appointments JOIN patient_screenings
//
//   5. listGlobalCalendarEventsForUser / ForFacility
//      ← global_schedule_events JOIN users (for assignee name)
//        JOIN patient_screenings (when patient-scoped)
//
// All five helpers return OperationalQueueItem rows in `createdAt DESC`
// order. Pagination is the service layer's responsibility today.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  ancillaryAppointments,
  globalScheduleEvents,
  outreachSchedulers,
  patientExecutionCases,
  patientScreenings,
  plexusProjects,
  plexusTasks,
  schedulerAssignments,
  users,
} from "@shared/schema";
import type {
  OperationalQueueForFacilityFilters,
  OperationalQueueForUserFilters,
  OperationalQueueItem,
} from "./contracts";

const DEFAULT_PER_SOURCE_LIMIT = 200;
const MAX_PER_SOURCE_LIMIT = 1000;

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_PER_SOURCE_LIMIT;
  return Math.min(Math.max(1, Math.trunc(limit)), MAX_PER_SOURCE_LIMIT);
}

// ────────────────────────────────────────────────────────────────────────
// Status → isOpen derivation (per-source)
// ────────────────────────────────────────────────────────────────────────

const CALL_LIST_CLOSED = new Set(["completed", "released"]);
const PLEXUS_TASK_CLOSED = new Set(["done", "closed"]);
const ENGAGEMENT_CASE_CLOSED = new Set([
  "completed",
  "closed",
  "cancelled",
  "archived",
]);
const APPOINTMENT_CLOSED = new Set(["completed", "cancelled", "no_show"]);
const GLOBAL_EVENT_CLOSED = new Set(["completed", "cancelled", "no_show"]);

function callListIsOpen(status: string): boolean {
  return !CALL_LIST_CLOSED.has(status);
}
function plexusTaskIsOpen(status: string): boolean {
  return !PLEXUS_TASK_CLOSED.has(status);
}
function engagementCaseIsOpen(status: string): boolean {
  return !ENGAGEMENT_CASE_CLOSED.has(status);
}
function appointmentIsOpen(status: string): boolean {
  return !APPOINTMENT_CLOSED.has(status);
}
function globalEventIsOpen(status: string): boolean {
  return !GLOBAL_EVENT_CLOSED.has(status);
}

// ────────────────────────────────────────────────────────────────────────
// Source 1 — scheduler_assignments
// ────────────────────────────────────────────────────────────────────────

export async function listCallListItemsForUser(
  userId: string,
  filters: OperationalQueueForUserFilters,
  limit?: number,
): Promise<OperationalQueueItem[]> {
  const safeLimit = clampLimit(limit);
  const conditions = [eq(outreachSchedulers.userId, userId)];
  if (filters.facility) {
    conditions.push(eq(outreachSchedulers.facility, filters.facility));
  }
  if (filters.dateFrom) {
    conditions.push(sql`${schedulerAssignments.asOfDate} >= ${filters.dateFrom}`);
  }
  if (filters.dateTo) {
    conditions.push(sql`${schedulerAssignments.asOfDate} <= ${filters.dateTo}`);
  }
  if (!filters.includeClosed) {
    conditions.push(sql`${schedulerAssignments.status} NOT IN ('completed','released')`);
  }

  const rows = await db
    .select({
      id: schedulerAssignments.id,
      asOfDate: schedulerAssignments.asOfDate,
      source: schedulerAssignments.source,
      status: schedulerAssignments.status,
      assignedAt: schedulerAssignments.assignedAt,
      patientScreeningId: schedulerAssignments.patientScreeningId,
      schedulerUserId: outreachSchedulers.userId,
      schedulerName: outreachSchedulers.name,
      schedulerFacility: outreachSchedulers.facility,
      patientName: patientScreenings.name,
      patientDob: patientScreenings.dob,
      patientFacility: patientScreenings.facility,
    })
    .from(schedulerAssignments)
    .leftJoin(
      outreachSchedulers,
      eq(schedulerAssignments.schedulerId, outreachSchedulers.id),
    )
    .leftJoin(
      patientScreenings,
      eq(schedulerAssignments.patientScreeningId, patientScreenings.id),
    )
    .where(and(...conditions))
    .orderBy(desc(schedulerAssignments.assignedAt))
    .limit(safeLimit);

  return rows.map((r) => ({
    id: `cl:${r.id}`,
    kind: "call_list_item" as const,
    ownerType: "scheduler_assignment" as const,
    ownerId: r.id,
    assigneeUserId: r.schedulerUserId,
    assigneeName: r.schedulerName,
    patientScreeningId: r.patientScreeningId,
    patientName: r.patientName,
    patientDob: r.patientDob,
    facility: r.schedulerFacility ?? r.patientFacility,
    scheduledDate: r.asOfDate,
    scheduledTime: null,
    status: r.status,
    isOpen: callListIsOpen(r.status),
    metadata: { source: r.source },
    createdAt: r.assignedAt,
    updatedAt: null,
  }));
}

// ────────────────────────────────────────────────────────────────────────
// Source 2a — plexus_tasks
// ────────────────────────────────────────────────────────────────────────

export async function listSchedulerTasksFromPlexusForUser(
  userId: string,
  filters: OperationalQueueForUserFilters,
  limit?: number,
): Promise<OperationalQueueItem[]> {
  const safeLimit = clampLimit(limit);
  const conditions = [eq(plexusTasks.assignedToUserId, userId)];
  if (filters.facility) {
    conditions.push(eq(plexusProjects.facility, filters.facility));
  }
  if (filters.dateFrom) {
    conditions.push(sql`${plexusTasks.dueDate} >= ${filters.dateFrom}`);
  }
  if (filters.dateTo) {
    conditions.push(sql`${plexusTasks.dueDate} <= ${filters.dateTo}`);
  }
  if (!filters.includeClosed) {
    conditions.push(sql`${plexusTasks.status} NOT IN ('done','closed')`);
  }

  const rows = await db
    .select({
      id: plexusTasks.id,
      title: plexusTasks.title,
      description: plexusTasks.description,
      taskType: plexusTasks.taskType,
      urgency: plexusTasks.urgency,
      priority: plexusTasks.priority,
      status: plexusTasks.status,
      assignedToUserId: plexusTasks.assignedToUserId,
      patientScreeningId: plexusTasks.patientScreeningId,
      dueDate: plexusTasks.dueDate,
      createdAt: plexusTasks.createdAt,
      updatedAt: plexusTasks.updatedAt,
      facility: plexusProjects.facility,
      assigneeName: users.username,
    })
    .from(plexusTasks)
    .leftJoin(plexusProjects, eq(plexusTasks.projectId, plexusProjects.id))
    .leftJoin(users, eq(plexusTasks.assignedToUserId, users.id))
    .where(and(...conditions))
    .orderBy(desc(plexusTasks.updatedAt))
    .limit(safeLimit);

  return rows.map((r) => ({
    id: `st-pt:${r.id}`,
    kind: "scheduler_task" as const,
    ownerType: "plexus_task" as const,
    ownerId: r.id,
    assigneeUserId: r.assignedToUserId,
    assigneeName: r.assigneeName,
    patientScreeningId: r.patientScreeningId,
    patientName: null,
    patientDob: null,
    facility: r.facility,
    scheduledDate: r.dueDate,
    scheduledTime: null,
    status: r.status,
    isOpen: plexusTaskIsOpen(r.status),
    metadata: {
      title: r.title,
      description: r.description,
      taskType: r.taskType,
      urgency: r.urgency,
      priority: r.priority,
    },
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

// ────────────────────────────────────────────────────────────────────────
// Source 2b — patient_execution_cases (engagement-board bridge)
// ────────────────────────────────────────────────────────────────────────

export async function listSchedulerTasksFromEngagementBoardForUser(
  userId: string,
  filters: OperationalQueueForUserFilters,
  limit?: number,
): Promise<OperationalQueueItem[]> {
  const safeLimit = clampLimit(limit);

  // Resolve userId → outreach_schedulers.id, then filter execution cases
  // by assignedTeamMemberId (which today is an outreach_schedulers.id).
  const schedulers = await db
    .select({ id: outreachSchedulers.id, name: outreachSchedulers.name })
    .from(outreachSchedulers)
    .where(eq(outreachSchedulers.userId, userId));

  if (schedulers.length === 0) return [];
  const schedulerIds = schedulers.map((s) => s.id);
  const schedulerNameById = new Map(schedulers.map((s) => [s.id, s.name]));

  const conditions = [
    inArray(patientExecutionCases.assignedTeamMemberId, schedulerIds),
    eq(patientExecutionCases.lifecycleStatus, "active"),
  ];
  if (filters.facility) {
    conditions.push(eq(patientExecutionCases.facilityId, filters.facility));
  }
  if (!filters.includeClosed) {
    conditions.push(
      sql`${patientExecutionCases.engagementStatus} NOT IN ('completed','closed','cancelled','archived')`,
    );
  }

  const rows = await db
    .select({
      id: patientExecutionCases.id,
      patientScreeningId: patientExecutionCases.patientScreeningId,
      patientName: patientExecutionCases.patientName,
      patientDob: patientExecutionCases.patientDob,
      facilityId: patientExecutionCases.facilityId,
      assignedTeamMemberId: patientExecutionCases.assignedTeamMemberId,
      assignedRole: patientExecutionCases.assignedRole,
      engagementBucket: patientExecutionCases.engagementBucket,
      engagementStatus: patientExecutionCases.engagementStatus,
      nextActionAt: patientExecutionCases.nextActionAt,
      createdAt: patientExecutionCases.createdAt,
      updatedAt: patientExecutionCases.updatedAt,
    })
    .from(patientExecutionCases)
    .where(and(...conditions))
    .orderBy(desc(patientExecutionCases.updatedAt))
    .limit(safeLimit);

  return rows.map((r) => ({
    id: `st-ec:${r.id}`,
    kind: "scheduler_task" as const,
    ownerType: "engagement_case" as const,
    ownerId: r.id,
    assigneeUserId: userId,
    assigneeName: schedulerNameById.get(r.assignedTeamMemberId ?? -1) ?? null,
    patientScreeningId: r.patientScreeningId,
    patientName: r.patientName,
    patientDob: r.patientDob,
    facility: r.facilityId,
    scheduledDate: null,
    scheduledTime: null,
    status: r.engagementStatus,
    isOpen: engagementCaseIsOpen(r.engagementStatus),
    metadata: {
      engagementBucket: r.engagementBucket,
      assignedRole: r.assignedRole,
      nextActionAt: r.nextActionAt,
    },
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

// ────────────────────────────────────────────────────────────────────────
// Source 3 — ancillary_appointments (facility-scoped only today)
// ────────────────────────────────────────────────────────────────────────

export async function listVisitAppointmentsForFacility(
  facility: string,
  filters: OperationalQueueForFacilityFilters,
  limit?: number,
): Promise<OperationalQueueItem[]> {
  const safeLimit = clampLimit(limit);
  const conditions = [eq(ancillaryAppointments.facility, facility)];
  if (filters.dateFrom) {
    conditions.push(sql`${ancillaryAppointments.scheduledDate} >= ${filters.dateFrom}`);
  }
  if (filters.dateTo) {
    conditions.push(sql`${ancillaryAppointments.scheduledDate} <= ${filters.dateTo}`);
  }
  if (!filters.includeClosed) {
    conditions.push(sql`${ancillaryAppointments.status} NOT IN ('completed','cancelled','no_show')`);
  }

  const rows = await db
    .select({
      id: ancillaryAppointments.id,
      patientScreeningId: ancillaryAppointments.patientScreeningId,
      patientName: ancillaryAppointments.patientName,
      facility: ancillaryAppointments.facility,
      scheduledDate: ancillaryAppointments.scheduledDate,
      scheduledTime: ancillaryAppointments.scheduledTime,
      testType: ancillaryAppointments.testType,
      status: ancillaryAppointments.status,
      createdAt: ancillaryAppointments.createdAt,
      patientDob: patientScreenings.dob,
    })
    .from(ancillaryAppointments)
    .leftJoin(
      patientScreenings,
      eq(ancillaryAppointments.patientScreeningId, patientScreenings.id),
    )
    .where(and(...conditions))
    .orderBy(
      ancillaryAppointments.scheduledDate,
      ancillaryAppointments.scheduledTime,
    )
    .limit(safeLimit);

  return rows.map((r) => ({
    id: `va:${r.id}`,
    kind: "visit_appointment" as const,
    ownerType: "ancillary_appointment" as const,
    ownerId: r.id,
    assigneeUserId: null,
    assigneeName: null,
    patientScreeningId: r.patientScreeningId,
    patientName: r.patientName,
    patientDob: r.patientDob,
    facility: r.facility,
    scheduledDate: r.scheduledDate,
    scheduledTime: r.scheduledTime,
    status: r.status,
    isOpen: appointmentIsOpen(r.status),
    metadata: { testType: r.testType },
    createdAt: r.createdAt,
    updatedAt: null,
  }));
}

// ────────────────────────────────────────────────────────────────────────
// Source 4 — global_schedule_events
// ────────────────────────────────────────────────────────────────────────

export async function listGlobalCalendarEventsForUser(
  userId: string,
  filters: OperationalQueueForUserFilters,
  limit?: number,
): Promise<OperationalQueueItem[]> {
  const safeLimit = clampLimit(limit);
  const conditions = [eq(globalScheduleEvents.assignedUserId, userId)];
  if (filters.facility) {
    conditions.push(eq(globalScheduleEvents.facilityId, filters.facility));
  }
  if (filters.dateFrom) {
    conditions.push(
      sql`${globalScheduleEvents.startsAt} >= ${filters.dateFrom}::timestamp`,
    );
  }
  if (filters.dateTo) {
    // Inclusive: events that start on or before dateTo at 23:59:59.
    conditions.push(
      sql`${globalScheduleEvents.startsAt} <= (${filters.dateTo}::date + interval '1 day')`,
    );
  }
  if (!filters.includeClosed) {
    conditions.push(sql`${globalScheduleEvents.status} NOT IN ('completed','cancelled','no_show')`);
  }

  const rows = await db
    .select({
      id: globalScheduleEvents.id,
      patientScreeningId: globalScheduleEvents.patientScreeningId,
      patientName: globalScheduleEvents.patientName,
      patientDob: globalScheduleEvents.patientDob,
      facilityId: globalScheduleEvents.facilityId,
      eventType: globalScheduleEvents.eventType,
      serviceType: globalScheduleEvents.serviceType,
      status: globalScheduleEvents.status,
      startsAt: globalScheduleEvents.startsAt,
      endsAt: globalScheduleEvents.endsAt,
      assignedUserId: globalScheduleEvents.assignedUserId,
      assignedRole: globalScheduleEvents.assignedRole,
      metadata: globalScheduleEvents.metadata,
      createdAt: globalScheduleEvents.createdAt,
      updatedAt: globalScheduleEvents.updatedAt,
      assigneeName: users.username,
    })
    .from(globalScheduleEvents)
    .leftJoin(users, eq(globalScheduleEvents.assignedUserId, users.id))
    .where(and(...conditions))
    .orderBy(globalScheduleEvents.startsAt)
    .limit(safeLimit);

  return rows.map((r) => ({
    id: `gc:${r.id}`,
    kind: "global_calendar_event" as const,
    ownerType: "global_schedule_event" as const,
    ownerId: r.id,
    assigneeUserId: r.assignedUserId,
    assigneeName: r.assigneeName,
    patientScreeningId: r.patientScreeningId,
    patientName: r.patientName,
    patientDob: r.patientDob,
    facility: r.facilityId,
    scheduledDate: r.startsAt ? r.startsAt.toISOString().slice(0, 10) : null,
    scheduledTime: r.startsAt ? r.startsAt.toISOString().slice(11, 16) : null,
    status: r.status,
    isOpen: globalEventIsOpen(r.status),
    metadata: {
      eventType: r.eventType,
      serviceType: r.serviceType,
      assignedRole: r.assignedRole,
      endsAt: r.endsAt,
      extra: r.metadata,
    },
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function listGlobalCalendarEventsForFacility(
  facility: string,
  filters: OperationalQueueForFacilityFilters,
  limit?: number,
): Promise<OperationalQueueItem[]> {
  const safeLimit = clampLimit(limit);
  const conditions = [eq(globalScheduleEvents.facilityId, facility)];
  if (filters.dateFrom) {
    conditions.push(
      sql`${globalScheduleEvents.startsAt} >= ${filters.dateFrom}::timestamp`,
    );
  }
  if (filters.dateTo) {
    conditions.push(
      sql`${globalScheduleEvents.startsAt} <= (${filters.dateTo}::date + interval '1 day')`,
    );
  }
  if (!filters.includeClosed) {
    conditions.push(sql`${globalScheduleEvents.status} NOT IN ('completed','cancelled','no_show')`);
  }

  const rows = await db
    .select({
      id: globalScheduleEvents.id,
      patientScreeningId: globalScheduleEvents.patientScreeningId,
      patientName: globalScheduleEvents.patientName,
      patientDob: globalScheduleEvents.patientDob,
      facilityId: globalScheduleEvents.facilityId,
      eventType: globalScheduleEvents.eventType,
      serviceType: globalScheduleEvents.serviceType,
      status: globalScheduleEvents.status,
      startsAt: globalScheduleEvents.startsAt,
      endsAt: globalScheduleEvents.endsAt,
      assignedUserId: globalScheduleEvents.assignedUserId,
      assignedRole: globalScheduleEvents.assignedRole,
      metadata: globalScheduleEvents.metadata,
      createdAt: globalScheduleEvents.createdAt,
      updatedAt: globalScheduleEvents.updatedAt,
      assigneeName: users.username,
    })
    .from(globalScheduleEvents)
    .leftJoin(users, eq(globalScheduleEvents.assignedUserId, users.id))
    .where(and(...conditions))
    .orderBy(globalScheduleEvents.startsAt)
    .limit(safeLimit);

  return rows.map((r) => ({
    id: `gc:${r.id}`,
    kind: "global_calendar_event" as const,
    ownerType: "global_schedule_event" as const,
    ownerId: r.id,
    assigneeUserId: r.assignedUserId,
    assigneeName: r.assigneeName,
    patientScreeningId: r.patientScreeningId,
    patientName: r.patientName,
    patientDob: r.patientDob,
    facility: r.facilityId,
    scheduledDate: r.startsAt ? r.startsAt.toISOString().slice(0, 10) : null,
    scheduledTime: r.startsAt ? r.startsAt.toISOString().slice(11, 16) : null,
    status: r.status,
    isOpen: globalEventIsOpen(r.status),
    metadata: {
      eventType: r.eventType,
      serviceType: r.serviceType,
      assignedRole: r.assignedRole,
      endsAt: r.endsAt,
      extra: r.metadata,
    },
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}
