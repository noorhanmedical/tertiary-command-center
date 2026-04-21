import { db } from "../db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  generatedNotes,
  type GeneratedNote,
  type InsertGeneratedNote,
} from "@shared/schema/notes";

export interface INotesRepository {
  saveBulk(records: InsertGeneratedNote[]): Promise<GeneratedNote[]>;
  deleteByPatientAndService(patientId: number, service: string): Promise<void>;
  listByBatch(batchId: number): Promise<GeneratedNote[]>;
  listAll(): Promise<GeneratedNote[]>;
  countsByPatientId(): Promise<Map<number, number>>;
  listByPatientIds(patientIds: number[]): Promise<GeneratedNote[]>;
  deleteByPatient(patientId: number): Promise<void>;
  listByPatient(patientId: number): Promise<GeneratedNote[]>;
  getById(id: number): Promise<GeneratedNote | undefined>;
  updateDriveInfo(id: number, driveFileId: string, driveWebViewLink: string): Promise<GeneratedNote | undefined>;
}

export class DbNotesRepository implements INotesRepository {
  async saveBulk(records: InsertGeneratedNote[]): Promise<GeneratedNote[]> {
    if (records.length === 0) return [];
    return db.insert(generatedNotes).values(records).returning();
  }

  async deleteByPatientAndService(patientId: number, service: string): Promise<void> {
    await db.delete(generatedNotes).where(
      and(eq(generatedNotes.patientId, patientId), eq(generatedNotes.service, service))
    );
  }

  async listByBatch(batchId: number): Promise<GeneratedNote[]> {
    return db.select().from(generatedNotes)
      .where(eq(generatedNotes.batchId, batchId))
      .orderBy(generatedNotes.generatedAt);
  }

  async listAll(): Promise<GeneratedNote[]> {
    return db.select().from(generatedNotes).orderBy(desc(generatedNotes.generatedAt));
  }

  async countsByPatientId(): Promise<Map<number, number>> {
    const rows = await db
      .select({ patientId: generatedNotes.patientId, count: sql<number>`count(*)::int` })
      .from(generatedNotes)
      .groupBy(generatedNotes.patientId);
    const out = new Map<number, number>();
    for (const r of rows) out.set(r.patientId, Number(r.count));
    return out;
  }

  async listByPatientIds(patientIds: number[]): Promise<GeneratedNote[]> {
    if (patientIds.length === 0) return [];
    return db.select().from(generatedNotes)
      .where(inArray(generatedNotes.patientId, patientIds))
      .orderBy(desc(generatedNotes.generatedAt));
  }

  async deleteByPatient(patientId: number): Promise<void> {
    await db.delete(generatedNotes).where(eq(generatedNotes.patientId, patientId));
  }

  async listByPatient(patientId: number): Promise<GeneratedNote[]> {
    return db.select().from(generatedNotes)
      .where(eq(generatedNotes.patientId, patientId))
      .orderBy(generatedNotes.generatedAt);
  }

  async getById(id: number): Promise<GeneratedNote | undefined> {
    const [result] = await db.select().from(generatedNotes).where(eq(generatedNotes.id, id));
    return result;
  }

  async updateDriveInfo(id: number, driveFileId: string, driveWebViewLink: string): Promise<GeneratedNote | undefined> {
    const [result] = await db.update(generatedNotes)
      .set({ driveFileId, driveWebViewLink })
      .where(eq(generatedNotes.id, id))
      .returning();
    return result;
  }
}

export const notesRepository: INotesRepository = new DbNotesRepository();
