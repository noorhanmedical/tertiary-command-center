import { db } from "../db";
import { and, desc, eq, ilike } from "drizzle-orm";
import {
  patientTestHistory,
  patientReferenceData,
  type PatientTestHistory,
  type InsertTestHistory,
  type PatientReference,
  type InsertPatientReference,
} from "@shared/schema/patientHistory";
import { sql } from "drizzle-orm";

export interface IPatientHistoryRepository {
  createTestHistory(record: InsertTestHistory): Promise<PatientTestHistory>;
  createTestHistoryBulk(records: InsertTestHistory[]): Promise<PatientTestHistory[]>;
  bulkInsertTestHistoryIfNotExists(records: InsertTestHistory[]): Promise<void>;
  listAllTestHistory(): Promise<PatientTestHistory[]>;
  searchTestHistory(nameQuery: string): Promise<PatientTestHistory[]>;
  deleteTestHistory(id: number): Promise<void>;
  deleteAllTestHistory(): Promise<void>;
  getGroupTestHistory(name: string, dob: string | null): Promise<PatientTestHistory[]>;

  createReference(record: InsertPatientReference): Promise<PatientReference>;
  createReferenceBulk(records: InsertPatientReference[]): Promise<PatientReference[]>;
  listAllReferences(): Promise<PatientReference[]>;
  searchReferences(nameQuery: string): Promise<PatientReference[]>;
  deleteReference(id: number): Promise<void>;
  deleteAllReferences(): Promise<void>;
}

export class DbPatientHistoryRepository implements IPatientHistoryRepository {
  async createTestHistory(record: InsertTestHistory): Promise<PatientTestHistory> {
    const [result] = await db.insert(patientTestHistory).values(record).returning();
    return result;
  }

  async createTestHistoryBulk(records: InsertTestHistory[]): Promise<PatientTestHistory[]> {
    if (records.length === 0) return [];
    return db.insert(patientTestHistory).values(records).returning();
  }

  async bulkInsertTestHistoryIfNotExists(records: InsertTestHistory[]): Promise<void> {
    for (const r of records) {
      const existing = await db.select({ id: patientTestHistory.id })
        .from(patientTestHistory)
        .where(and(
          ilike(patientTestHistory.patientName, r.patientName),
          eq(patientTestHistory.testName, r.testName),
          eq(patientTestHistory.dateOfService, r.dateOfService),
        ))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(patientTestHistory).values(r);
      }
    }
  }

  async listAllTestHistory(): Promise<PatientTestHistory[]> {
    return db.select().from(patientTestHistory).orderBy(desc(patientTestHistory.createdAt));
  }

  async searchTestHistory(nameQuery: string): Promise<PatientTestHistory[]> {
    return db.select().from(patientTestHistory)
      .where(ilike(patientTestHistory.patientName, `%${nameQuery}%`))
      .orderBy(desc(patientTestHistory.dateOfService));
  }

  async deleteTestHistory(id: number): Promise<void> {
    await db.delete(patientTestHistory).where(eq(patientTestHistory.id, id));
  }

  async deleteAllTestHistory(): Promise<void> {
    await db.delete(patientTestHistory);
  }

  async getGroupTestHistory(name: string, dob: string | null): Promise<PatientTestHistory[]> {
    return db.select().from(patientTestHistory).where(and(
      eq(patientTestHistory.patientName, name),
      dob === null
        ? sql`${patientTestHistory.dob} IS NULL`
        : eq(patientTestHistory.dob, dob),
    )).orderBy(desc(patientTestHistory.dateOfService));
  }

  async createReference(record: InsertPatientReference): Promise<PatientReference> {
    const [result] = await db.insert(patientReferenceData).values(record).returning();
    return result;
  }

  async createReferenceBulk(records: InsertPatientReference[]): Promise<PatientReference[]> {
    if (records.length === 0) return [];
    return db.insert(patientReferenceData).values(records).returning();
  }

  async listAllReferences(): Promise<PatientReference[]> {
    return db.select().from(patientReferenceData).orderBy(desc(patientReferenceData.createdAt));
  }

  async searchReferences(nameQuery: string): Promise<PatientReference[]> {
    return db.select().from(patientReferenceData)
      .where(ilike(patientReferenceData.patientName, `%${nameQuery}%`))
      .orderBy(desc(patientReferenceData.createdAt));
  }

  async deleteReference(id: number): Promise<void> {
    await db.delete(patientReferenceData).where(eq(patientReferenceData.id, id));
  }

  async deleteAllReferences(): Promise<void> {
    await db.delete(patientReferenceData);
  }
}

export const patientHistoryRepository: IPatientHistoryRepository = new DbPatientHistoryRepository();
