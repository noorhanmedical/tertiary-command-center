import { db } from "../db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  schedulerAssignments,
  type SchedulerAssignment,
  type InsertSchedulerAssignment,
} from "@shared/schema/outreach";

export interface ISchedulerAssignmentsRepository {
  create(record: InsertSchedulerAssignment): Promise<SchedulerAssignment>;
  bulkCreate(records: InsertSchedulerAssignment[]): Promise<SchedulerAssignment[]>;
  applyDiff(releaseIds: number[], drafts: InsertSchedulerAssignment[], reason: string): Promise<{ released: SchedulerAssignment[]; created: SchedulerAssignment[] }>;
  listActive(filters?: { schedulerId?: number; asOfDate?: string }): Promise<SchedulerAssignment[]>;
  getActiveForPatient(patientScreeningId: number): Promise<SchedulerAssignment | undefined>;
  getActiveForPatientOnDate(patientScreeningId: number, asOfDate: string): Promise<SchedulerAssignment | undefined>;
  releaseForScheduler(schedulerId: number, asOfDate: string, reason: string): Promise<SchedulerAssignment[]>;
  releaseByIds(ids: number[], reason: string): Promise<SchedulerAssignment[]>;
  releaseStale(beforeAsOfDate: string, reason: string): Promise<number>;
  reassign(id: number, newSchedulerId: number, reason: string): Promise<SchedulerAssignment | undefined>;
  markCompleted(patientScreeningId: number): Promise<void>;
}

export class DbSchedulerAssignmentsRepository implements ISchedulerAssignmentsRepository {
  async create(record: InsertSchedulerAssignment): Promise<SchedulerAssignment> {
    const [row] = await db.insert(schedulerAssignments).values(record).returning();
    return row;
  }

  async bulkCreate(records: InsertSchedulerAssignment[]): Promise<SchedulerAssignment[]> {
    if (records.length === 0) return [];
    return db.insert(schedulerAssignments).values(records).returning();
  }

  async applyDiff(
    releaseIds: number[],
    drafts: InsertSchedulerAssignment[],
    reason: string,
  ): Promise<{ released: SchedulerAssignment[]; created: SchedulerAssignment[] }> {
    if (releaseIds.length === 0 && drafts.length === 0) {
      return { released: [], created: [] };
    }
    return db.transaction(async (tx) => {
      const released = releaseIds.length === 0 ? [] : await tx.update(schedulerAssignments)
        .set({ status: "released", reason })
        .where(and(
          inArray(schedulerAssignments.id, releaseIds),
          eq(schedulerAssignments.status, "active"),
        ))
        .returning();
      const created = drafts.length === 0 ? [] :
        await tx.insert(schedulerAssignments).values(drafts).returning();
      return { released, created };
    });
  }

  async listActive(filters: { schedulerId?: number; asOfDate?: string } = {}): Promise<SchedulerAssignment[]> {
    const conds = [eq(schedulerAssignments.status, "active")];
    if (filters.schedulerId != null) conds.push(eq(schedulerAssignments.schedulerId, filters.schedulerId));
    if (filters.asOfDate) conds.push(eq(schedulerAssignments.asOfDate, filters.asOfDate));
    return db.select().from(schedulerAssignments)
      .where(and(...conds))
      .orderBy(asc(schedulerAssignments.assignedAt));
  }

  async getActiveForPatient(patientScreeningId: number): Promise<SchedulerAssignment | undefined> {
    const [row] = await db.select().from(schedulerAssignments).where(and(
      eq(schedulerAssignments.patientScreeningId, patientScreeningId),
      eq(schedulerAssignments.status, "active"),
    )).limit(1);
    return row;
  }

  async getActiveForPatientOnDate(patientScreeningId: number, asOfDate: string): Promise<SchedulerAssignment | undefined> {
    const [row] = await db.select().from(schedulerAssignments).where(and(
      eq(schedulerAssignments.patientScreeningId, patientScreeningId),
      eq(schedulerAssignments.status, "active"),
      eq(schedulerAssignments.asOfDate, asOfDate),
    )).limit(1);
    return row;
  }

  async releaseForScheduler(schedulerId: number, asOfDate: string, reason: string): Promise<SchedulerAssignment[]> {
    return db.update(schedulerAssignments)
      .set({ status: "released", reason })
      .where(and(
        eq(schedulerAssignments.schedulerId, schedulerId),
        eq(schedulerAssignments.asOfDate, asOfDate),
        eq(schedulerAssignments.status, "active"),
      ))
      .returning();
  }

  async releaseStale(beforeAsOfDate: string, reason: string): Promise<number> {
    const released = await db.update(schedulerAssignments)
      .set({ status: "released", reason })
      .where(and(
        eq(schedulerAssignments.status, "active"),
        sql`${schedulerAssignments.asOfDate} < ${beforeAsOfDate}`,
      ))
      .returning({ id: schedulerAssignments.id });
    return released.length;
  }

  async releaseByIds(ids: number[], reason: string): Promise<SchedulerAssignment[]> {
    if (ids.length === 0) return [];
    return db.update(schedulerAssignments)
      .set({ status: "released", reason })
      .where(and(
        inArray(schedulerAssignments.id, ids),
        eq(schedulerAssignments.status, "active"),
      ))
      .returning();
  }

  async reassign(id: number, newSchedulerId: number, reason: string): Promise<SchedulerAssignment | undefined> {
    return db.transaction(async (tx) => {
      const [old] = await tx.select().from(schedulerAssignments).where(eq(schedulerAssignments.id, id)).limit(1);
      if (!old) return undefined;
      await tx.update(schedulerAssignments)
        .set({ status: "reassigned", reason })
        .where(eq(schedulerAssignments.id, id));
      const [created] = await tx.insert(schedulerAssignments).values({
        patientScreeningId: old.patientScreeningId,
        schedulerId: newSchedulerId,
        asOfDate: old.asOfDate,
        source: "reassigned",
        originalSchedulerId: old.schedulerId,
        reason,
        status: "active",
      }).returning();
      return created;
    });
  }

  async markCompleted(patientScreeningId: number): Promise<void> {
    await db.update(schedulerAssignments)
      .set({ status: "completed", completedAt: new Date() })
      .where(and(
        eq(schedulerAssignments.patientScreeningId, patientScreeningId),
        eq(schedulerAssignments.status, "active"),
      ));
  }
}

export const schedulerAssignmentsRepository: ISchedulerAssignmentsRepository = new DbSchedulerAssignmentsRepository();
