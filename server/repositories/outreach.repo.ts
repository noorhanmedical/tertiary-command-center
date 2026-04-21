import { db } from "../db";
import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import {
  outreachSchedulers,
  outreachCalls,
  type OutreachScheduler,
  type InsertOutreachScheduler,
  type OutreachCall,
  type InsertOutreachCall,
} from "@shared/schema/outreach";
import { patientScreenings } from "@shared/schema/screening";

export interface IOutreachRepository {
  // Schedulers
  listSchedulers(): Promise<OutreachScheduler[]>;
  createScheduler(record: InsertOutreachScheduler): Promise<OutreachScheduler>;
  updateScheduler(id: number, updates: Partial<InsertOutreachScheduler>): Promise<OutreachScheduler | undefined>;
  deleteScheduler(id: number): Promise<OutreachScheduler | undefined>;

  // Calls
  createCall(record: InsertOutreachCall): Promise<OutreachCall>;
  createCallAtomic(record: InsertOutreachCall, desiredStatus: string): Promise<OutreachCall>;
  listCallsForPatient(patientScreeningId: number): Promise<OutreachCall[]>;
  listCallsForPatients(patientScreeningIds: number[]): Promise<OutreachCall[]>;
  listCallsForSchedulerToday(schedulerUserId: string, todayIso: string): Promise<OutreachCall[]>;
  latestCallForPatient(patientScreeningId: number): Promise<OutreachCall | undefined>;
}

export class DbOutreachRepository implements IOutreachRepository {
  async listSchedulers(): Promise<OutreachScheduler[]> {
    return db.select().from(outreachSchedulers).orderBy(asc(outreachSchedulers.name));
  }

  async createScheduler(record: InsertOutreachScheduler): Promise<OutreachScheduler> {
    const [result] = await db.insert(outreachSchedulers).values(record).returning();
    return result;
  }

  async updateScheduler(id: number, updates: Partial<InsertOutreachScheduler>): Promise<OutreachScheduler | undefined> {
    const [result] = await db.update(outreachSchedulers)
      .set(updates)
      .where(eq(outreachSchedulers.id, id))
      .returning();
    return result;
  }

  async deleteScheduler(id: number): Promise<OutreachScheduler | undefined> {
    const [deleted] = await db.delete(outreachSchedulers).where(eq(outreachSchedulers.id, id)).returning();
    return deleted;
  }

  async createCall(record: InsertOutreachCall): Promise<OutreachCall> {
    const [result] = await db.insert(outreachCalls).values({
      ...record,
      callbackAt: record.callbackAt ?? null,
      durationSeconds: record.durationSeconds ?? null,
    }).returning();
    return result;
  }

  async createCallAtomic(record: InsertOutreachCall, desiredStatus: string): Promise<OutreachCall> {
    return db.transaction(async (tx) => {
      const [call] = await tx.insert(outreachCalls).values({
        ...record,
        callbackAt: record.callbackAt ?? null,
        durationSeconds: record.durationSeconds ?? null,
      }).returning();

      if (desiredStatus === "scheduled") {
        await tx.update(patientScreenings)
          .set({
            appointmentStatus: desiredStatus,
            commitStatus: "Scheduled",
          })
          .where(eq(patientScreenings.id, record.patientScreeningId));
      } else {
        await tx.update(patientScreenings)
          .set({ appointmentStatus: desiredStatus })
          .where(and(
            eq(patientScreenings.id, record.patientScreeningId),
            ne(patientScreenings.appointmentStatus, "scheduled"),
          ));
        await tx.update(patientScreenings)
          .set({ commitStatus: "WithScheduler" })
          .where(and(
            eq(patientScreenings.id, record.patientScreeningId),
            inArray(patientScreenings.commitStatus, ["Ready"]),
          ));
      }

      return call;
    });
  }

  async listCallsForPatient(patientScreeningId: number): Promise<OutreachCall[]> {
    return db.select().from(outreachCalls)
      .where(eq(outreachCalls.patientScreeningId, patientScreeningId))
      .orderBy(desc(outreachCalls.startedAt));
  }

  async listCallsForPatients(patientScreeningIds: number[]): Promise<OutreachCall[]> {
    if (patientScreeningIds.length === 0) return [];
    return db.select().from(outreachCalls)
      .where(inArray(outreachCalls.patientScreeningId, patientScreeningIds))
      .orderBy(desc(outreachCalls.startedAt));
  }

  async listCallsForSchedulerToday(schedulerUserId: string, todayIso: string): Promise<OutreachCall[]> {
    const startOfDay = new Date(`${todayIso}T00:00:00.000Z`);
    const endOfDay = new Date(`${todayIso}T23:59:59.999Z`);
    return db.select().from(outreachCalls)
      .where(and(
        eq(outreachCalls.schedulerUserId, schedulerUserId),
        gte(outreachCalls.startedAt, startOfDay),
        lte(outreachCalls.startedAt, endOfDay),
      ))
      .orderBy(desc(outreachCalls.startedAt));
  }

  async latestCallForPatient(patientScreeningId: number): Promise<OutreachCall | undefined> {
    const [row] = await db.select().from(outreachCalls)
      .where(eq(outreachCalls.patientScreeningId, patientScreeningId))
      .orderBy(desc(outreachCalls.startedAt))
      .limit(1);
    return row;
  }
}

export const outreachRepository: IOutreachRepository = new DbOutreachRepository();
