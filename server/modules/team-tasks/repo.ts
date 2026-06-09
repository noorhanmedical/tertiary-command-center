// Team-task spine — read-only repository layer.
//
// Two source queries, mapped to the unified TeamTask shape:
//   1. plexus_tasks LEFT JOIN plexus_projects (for facility) LEFT JOIN users
//      (for assignee name).
//   2. scheduler_assignments LEFT JOIN outreach_schedulers (for facility +
//      assignee name + scheduler.userId) LEFT JOIN patient_screenings (for
//      patient context — minimal, just so callers can attach a fallback
//      facility if the scheduler has none).
//
// Both queries are kept lightweight (no aggregations, no procedure_events
// fan-out). Pagination is the caller's responsibility today; an explicit
// `limit` defaults to 200 to prevent accidental full-table scans.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { plexusProjects, plexusTasks, users } from "@shared/schema";
import {
  outreachSchedulers,
  schedulerAssignments,
} from "@shared/schema";
import { patientScreenings } from "@shared/schema";
import type {
  ListTeamTasksByPatientFilters,
  ListTeamTasksForUserFilters,
  TeamTask,
} from "./contracts";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

// ────────────────────────────────────────────────────────────────────────
// Mappers
// ────────────────────────────────────────────────────────────────────────

type PlexusTaskRow = {
  id: number;
  projectId: number | null;
  parentTaskId: number | null;
  title: string;
  description: string | null;
  taskType: string;
  urgency: string;
  priority: string;
  status: string;
  assignedToUserId: string | null;
  patientScreeningId: number | null;
  batchId: number | null;
  dueDate: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Joined columns
  projectFacility: string | null;
  assigneeName: string | null;
};

function mapPlexusTaskToTeamTask(row: PlexusTaskRow): TeamTask {
  return {
    id: `pt:${row.id}`,
    ownerType: "plexus_task",
    ownerId: row.id,
    assigneeUserId: row.assignedToUserId,
    assigneeName: row.assigneeName,
    schedulerId: null,
    patientScreeningId: row.patientScreeningId,
    facility: row.projectFacility,
    status: row.status,
    title: row.title,
    description: row.description,
    taskType: row.taskType,
    urgency: row.urgency,
    priority: row.priority,
    parentTaskId: row.parentTaskId,
    projectId: row.projectId,
    batchId: row.batchId,
    dueAt: row.dueDate,
    // scheduler_assignment-only fields are null for this source.
    source: null,
    asOfDate: null,
    originalSchedulerId: null,
    reason: null,
    completedAt: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type SchedulerAssignmentRow = {
  id: number;
  patientScreeningId: number;
  schedulerId: number;
  asOfDate: string;
  assignedAt: Date;
  source: string;
  originalSchedulerId: number | null;
  reason: string | null;
  status: string;
  completedAt: Date | null;
  // Joined columns
  schedulerUserId: string | null;
  schedulerName: string | null;
  schedulerFacility: string | null;
  patientFacility: string | null;
};

function mapSchedulerAssignmentToTeamTask(row: SchedulerAssignmentRow): TeamTask {
  return {
    id: `sa:${row.id}`,
    ownerType: "scheduler_assignment",
    ownerId: row.id,
    assigneeUserId: row.schedulerUserId,
    assigneeName: row.schedulerName,
    schedulerId: row.schedulerId,
    patientScreeningId: row.patientScreeningId,
    // Prefer the scheduler's facility (canonical for this source) and fall
    // back to the patient's facility string. Both are nullable.
    facility: row.schedulerFacility ?? row.patientFacility,
    status: row.status,
    // plexus_task-only fields are null for this source.
    title: null,
    description: null,
    taskType: null,
    urgency: null,
    priority: null,
    parentTaskId: null,
    projectId: null,
    batchId: null,
    dueAt: null,
    source: row.source,
    asOfDate: row.asOfDate,
    originalSchedulerId: row.originalSchedulerId,
    reason: row.reason,
    completedAt: row.completedAt,
    createdAt: row.assignedAt,
    updatedAt: null,
  };
}

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.trunc(limit)), MAX_LIMIT);
}

// ────────────────────────────────────────────────────────────────────────
// Public read queries
// ────────────────────────────────────────────────────────────────────────

/**
 * Read plexus_tasks rows for a user, with a facility filter applied via the
 * project join. Returns rows mapped to the TeamTask shape.
 *
 * Status filtering: when `includeCompleted` is false (default), excludes
 * rows with status `"done"` or `"closed"`. These are the two terminal states
 * observed in the current code today (see server/routes/plexusTasks.ts
 * usages).
 */
export async function listPlexusTasksForUser(
  userId: string,
  filters: ListTeamTasksForUserFilters,
  limit?: number,
): Promise<TeamTask[]> {
  const safeLimit = clampLimit(limit);
  const conditions = [eq(plexusTasks.assignedToUserId, userId)];
  if (filters.facility) {
    conditions.push(eq(plexusProjects.facility, filters.facility));
  }
  if (!filters.includeCompleted) {
    conditions.push(sql`${plexusTasks.status} NOT IN ('done','closed')`);
  }

  const rows = await db
    .select({
      id: plexusTasks.id,
      projectId: plexusTasks.projectId,
      parentTaskId: plexusTasks.parentTaskId,
      title: plexusTasks.title,
      description: plexusTasks.description,
      taskType: plexusTasks.taskType,
      urgency: plexusTasks.urgency,
      priority: plexusTasks.priority,
      status: plexusTasks.status,
      assignedToUserId: plexusTasks.assignedToUserId,
      patientScreeningId: plexusTasks.patientScreeningId,
      batchId: plexusTasks.batchId,
      dueDate: plexusTasks.dueDate,
      createdAt: plexusTasks.createdAt,
      updatedAt: plexusTasks.updatedAt,
      projectFacility: plexusProjects.facility,
      assigneeName: users.username,
    })
    .from(plexusTasks)
    .leftJoin(plexusProjects, eq(plexusTasks.projectId, plexusProjects.id))
    .leftJoin(users, eq(plexusTasks.assignedToUserId, users.id))
    .where(and(...conditions))
    .orderBy(desc(plexusTasks.updatedAt))
    .limit(safeLimit);

  return rows.map((r) =>
    mapPlexusTaskToTeamTask(r as unknown as PlexusTaskRow),
  );
}

/**
 * Read scheduler_assignments rows for the given user (resolved via
 * outreach_schedulers.userId), with a facility filter applied via the
 * scheduler join. Returns rows mapped to the TeamTask shape.
 *
 * Status filtering: when `includeCompleted` is false (default), excludes
 * rows with status `"completed"` or `"released"`. See
 * shared/schema/outreach.ts SCHEDULER_ASSIGNMENT_STATUSES for the full
 * enum.
 */
export async function listSchedulerAssignmentsForUser(
  userId: string,
  filters: ListTeamTasksForUserFilters,
  limit?: number,
): Promise<TeamTask[]> {
  const safeLimit = clampLimit(limit);
  const conditions = [eq(outreachSchedulers.userId, userId)];
  if (filters.facility) {
    conditions.push(eq(outreachSchedulers.facility, filters.facility));
  }
  if (!filters.includeCompleted) {
    conditions.push(sql`${schedulerAssignments.status} NOT IN ('completed','released')`);
  }

  const rows = await db
    .select({
      id: schedulerAssignments.id,
      patientScreeningId: schedulerAssignments.patientScreeningId,
      schedulerId: schedulerAssignments.schedulerId,
      asOfDate: schedulerAssignments.asOfDate,
      assignedAt: schedulerAssignments.assignedAt,
      source: schedulerAssignments.source,
      originalSchedulerId: schedulerAssignments.originalSchedulerId,
      reason: schedulerAssignments.reason,
      status: schedulerAssignments.status,
      completedAt: schedulerAssignments.completedAt,
      schedulerUserId: outreachSchedulers.userId,
      schedulerName: outreachSchedulers.name,
      schedulerFacility: outreachSchedulers.facility,
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

  return rows.map((r) =>
    mapSchedulerAssignmentToTeamTask(r as unknown as SchedulerAssignmentRow),
  );
}

/**
 * Read both plexus_tasks and scheduler_assignments rows tied to a specific
 * patient_screenings row. Returns the union mapped to TeamTask.
 *
 * For scheduler_assignments, only currently-active (not completed/released)
 * rows are returned by default. Use `includeCompleted: true` to see history.
 */
export async function listTeamTasksByPatient(
  patientScreeningId: number,
  filters: ListTeamTasksByPatientFilters = {},
  limit?: number,
): Promise<TeamTask[]> {
  const safeLimit = clampLimit(limit);
  const includeCompleted = filters.includeCompleted ?? false;

  const wantPlexus =
    filters.ownerType === undefined || filters.ownerType === "plexus_task";
  const wantScheduler =
    filters.ownerType === undefined ||
    filters.ownerType === "scheduler_assignment";

  const out: TeamTask[] = [];

  if (wantPlexus) {
    const conditions = [eq(plexusTasks.patientScreeningId, patientScreeningId)];
    if (!includeCompleted) {
      conditions.push(sql`${plexusTasks.status} NOT IN ('done','closed')`);
    }
    const ptRows = await db
      .select({
        id: plexusTasks.id,
        projectId: plexusTasks.projectId,
        parentTaskId: plexusTasks.parentTaskId,
        title: plexusTasks.title,
        description: plexusTasks.description,
        taskType: plexusTasks.taskType,
        urgency: plexusTasks.urgency,
        priority: plexusTasks.priority,
        status: plexusTasks.status,
        assignedToUserId: plexusTasks.assignedToUserId,
        patientScreeningId: plexusTasks.patientScreeningId,
        batchId: plexusTasks.batchId,
        dueDate: plexusTasks.dueDate,
        createdAt: plexusTasks.createdAt,
        updatedAt: plexusTasks.updatedAt,
        projectFacility: plexusProjects.facility,
        assigneeName: users.username,
      })
      .from(plexusTasks)
      .leftJoin(plexusProjects, eq(plexusTasks.projectId, plexusProjects.id))
      .leftJoin(users, eq(plexusTasks.assignedToUserId, users.id))
      .where(and(...conditions))
      .orderBy(desc(plexusTasks.updatedAt))
      .limit(safeLimit);
    for (const row of ptRows) {
      out.push(mapPlexusTaskToTeamTask(row as unknown as PlexusTaskRow));
    }
  }

  if (wantScheduler) {
    const conditions = [
      eq(schedulerAssignments.patientScreeningId, patientScreeningId),
    ];
    if (!includeCompleted) {
      conditions.push(
        sql`${schedulerAssignments.status} NOT IN ('completed','released')`,
      );
    }
    const saRows = await db
      .select({
        id: schedulerAssignments.id,
        patientScreeningId: schedulerAssignments.patientScreeningId,
        schedulerId: schedulerAssignments.schedulerId,
        asOfDate: schedulerAssignments.asOfDate,
        assignedAt: schedulerAssignments.assignedAt,
        source: schedulerAssignments.source,
        originalSchedulerId: schedulerAssignments.originalSchedulerId,
        reason: schedulerAssignments.reason,
        status: schedulerAssignments.status,
        completedAt: schedulerAssignments.completedAt,
        schedulerUserId: outreachSchedulers.userId,
        schedulerName: outreachSchedulers.name,
        schedulerFacility: outreachSchedulers.facility,
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
    for (const row of saRows) {
      out.push(
        mapSchedulerAssignmentToTeamTask(row as unknown as SchedulerAssignmentRow),
      );
    }
  }

  return out;
}

// suppress unused-import warning when these helpers are not consumed yet
void inArray;
