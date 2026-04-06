import { db } from "./db";
import {
  screeningBatches,
  patientScreenings,
  patientTestHistory,
  patientReferenceData,
  generatedNotes,
  billingRecords,
  uploadedDocuments,
  type ScreeningBatch,
  type InsertScreeningBatch,
  type PatientScreening,
  type InsertPatientScreening,
  type PatientTestHistory,
  type InsertTestHistory,
  type PatientReference,
  type InsertPatientReference,
  type GeneratedNote,
  type InsertGeneratedNote,
  type BillingRecord,
  type InsertBillingRecord,
  type UploadedDocument,
  type InsertUploadedDocument,
  users,
  type User,
  type InsertUser,
} from "@shared/schema";
import { eq, desc, ilike, sql, and } from "drizzle-orm";

function parseTimeToMinutes(time: string | null | undefined): number {
  if (!time) return Infinity;
  const t = time.trim().toUpperCase();
  const match12 = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (match12) {
    let h = parseInt(match12[1], 10);
    const m = parseInt(match12[2], 10);
    const period = match12[3];
    if (period === "AM") { if (h === 12) h = 0; }
    else { if (h !== 12) h += 12; }
    return h * 60 + m;
  }
  const match24 = t.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    return parseInt(match24[1], 10) * 60 + parseInt(match24[2], 10);
  }
  return Infinity;
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  createScreeningBatch(batch: InsertScreeningBatch): Promise<ScreeningBatch>;
  getScreeningBatch(id: number): Promise<ScreeningBatch | undefined>;
  getAllScreeningBatches(): Promise<ScreeningBatch[]>;
  updateScreeningBatch(id: number, updates: Partial<InsertScreeningBatch>): Promise<ScreeningBatch | undefined>;
  deleteScreeningBatch(id: number): Promise<void>;

  createPatientScreening(screening: InsertPatientScreening): Promise<PatientScreening>;
  getPatientScreeningsByBatch(batchId: number): Promise<PatientScreening[]>;
  getPatientScreening(id: number): Promise<PatientScreening | undefined>;
  updatePatientScreening(id: number, updates: Partial<InsertPatientScreening>): Promise<PatientScreening | undefined>;
  deletePatientScreening(id: number): Promise<void>;

  createTestHistory(record: InsertTestHistory): Promise<PatientTestHistory>;
  createTestHistoryBulk(records: InsertTestHistory[]): Promise<PatientTestHistory[]>;
  bulkInsertTestHistoryIfNotExists(records: InsertTestHistory[]): Promise<void>;
  getAllTestHistory(): Promise<PatientTestHistory[]>;
  searchTestHistory(nameQuery: string): Promise<PatientTestHistory[]>;
  deleteTestHistory(id: number): Promise<void>;
  deleteAllTestHistory(): Promise<void>;

  createPatientReference(record: InsertPatientReference): Promise<PatientReference>;
  createPatientReferenceBulk(records: InsertPatientReference[]): Promise<PatientReference[]>;
  getAllPatientReferences(): Promise<PatientReference[]>;
  searchPatientReferences(nameQuery: string): Promise<PatientReference[]>;
  deletePatientReference(id: number): Promise<void>;
  deleteAllPatientReferences(): Promise<void>;

  saveGeneratedNotes(records: InsertGeneratedNote[]): Promise<GeneratedNote[]>;
  deleteGeneratedNotesByPatientAndService(patientId: number, service: string): Promise<void>;
  getGeneratedNotesByBatch(batchId: number): Promise<GeneratedNote[]>;
  getAllGeneratedNotes(): Promise<GeneratedNote[]>;
  deleteGeneratedNotesByPatient(patientId: number): Promise<void>;
  getGeneratedNotesByPatient(patientId: number): Promise<GeneratedNote[]>;
  getGeneratedNote(id: number): Promise<GeneratedNote | undefined>;
  updateGeneratedNoteDriveInfo(id: number, driveFileId: string, driveWebViewLink: string): Promise<GeneratedNote | undefined>;

  getAllBillingRecords(): Promise<BillingRecord[]>;
  getBillingRecordByPatientAndService(patientId: number, service: string): Promise<BillingRecord | undefined>;
  createBillingRecord(record: InsertBillingRecord): Promise<BillingRecord>;
  updateBillingRecord(id: number, updates: Partial<InsertBillingRecord>): Promise<BillingRecord | undefined>;
  deleteBillingRecord(id: number): Promise<void>;

  saveUploadedDocument(record: InsertUploadedDocument): Promise<UploadedDocument>;
  getAllUploadedDocuments(): Promise<UploadedDocument[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async createScreeningBatch(batch: InsertScreeningBatch): Promise<ScreeningBatch> {
    const [result] = await db.insert(screeningBatches).values(batch).returning();
    return result;
  }

  async getScreeningBatch(id: number): Promise<ScreeningBatch | undefined> {
    const [result] = await db.select().from(screeningBatches).where(eq(screeningBatches.id, id));
    return result;
  }

  async getAllScreeningBatches(): Promise<ScreeningBatch[]> {
    return db.select().from(screeningBatches).orderBy(desc(screeningBatches.createdAt));
  }

  async updateScreeningBatch(id: number, updates: Partial<InsertScreeningBatch>): Promise<ScreeningBatch | undefined> {
    const [result] = await db.update(screeningBatches).set(updates).where(eq(screeningBatches.id, id)).returning();
    return result;
  }

  async deleteScreeningBatch(id: number): Promise<void> {
    await db.delete(patientScreenings).where(eq(patientScreenings.batchId, id));
    await db.delete(screeningBatches).where(eq(screeningBatches.id, id));
  }

  async createPatientScreening(screening: InsertPatientScreening): Promise<PatientScreening> {
    const [result] = await db.insert(patientScreenings).values(screening).returning();
    return result;
  }

  async getPatientScreeningsByBatch(batchId: number): Promise<PatientScreening[]> {
    const rows = await db.select().from(patientScreenings).where(eq(patientScreenings.batchId, batchId));
    return rows.sort((a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time));
  }

  async getPatientScreening(id: number): Promise<PatientScreening | undefined> {
    const [result] = await db.select().from(patientScreenings).where(eq(patientScreenings.id, id));
    return result;
  }

  async updatePatientScreening(id: number, updates: Partial<InsertPatientScreening>): Promise<PatientScreening | undefined> {
    const [result] = await db.update(patientScreenings).set(updates).where(eq(patientScreenings.id, id)).returning();
    return result;
  }

  async deletePatientScreening(id: number): Promise<void> {
    await db.delete(patientScreenings).where(eq(patientScreenings.id, id));
  }

  async createTestHistory(record: InsertTestHistory): Promise<PatientTestHistory> {
    const [result] = await db.insert(patientTestHistory).values(record).returning();
    return result;
  }

  async createTestHistoryBulk(records: InsertTestHistory[]): Promise<PatientTestHistory[]> {
    if (records.length === 0) return [];
    const results = await db.insert(patientTestHistory).values(records).returning();
    return results;
  }

  async bulkInsertTestHistoryIfNotExists(records: InsertTestHistory[]): Promise<void> {
    for (const r of records) {
      const existing = await db.select({ id: patientTestHistory.id })
        .from(patientTestHistory)
        .where(and(
          ilike(patientTestHistory.patientName, r.patientName),
          eq(patientTestHistory.testName, r.testName),
          eq(patientTestHistory.dateOfService, r.dateOfService)
        ))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(patientTestHistory).values(r);
      }
    }
  }

  async getAllTestHistory(): Promise<PatientTestHistory[]> {
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

  async createPatientReference(record: InsertPatientReference): Promise<PatientReference> {
    const [result] = await db.insert(patientReferenceData).values(record).returning();
    return result;
  }

  async createPatientReferenceBulk(records: InsertPatientReference[]): Promise<PatientReference[]> {
    if (records.length === 0) return [];
    const results = await db.insert(patientReferenceData).values(records).returning();
    return results;
  }

  async getAllPatientReferences(): Promise<PatientReference[]> {
    return db.select().from(patientReferenceData).orderBy(desc(patientReferenceData.createdAt));
  }

  async searchPatientReferences(nameQuery: string): Promise<PatientReference[]> {
    return db.select().from(patientReferenceData)
      .where(ilike(patientReferenceData.patientName, `%${nameQuery}%`))
      .orderBy(desc(patientReferenceData.createdAt));
  }

  async deletePatientReference(id: number): Promise<void> {
    await db.delete(patientReferenceData).where(eq(patientReferenceData.id, id));
  }

  async deleteAllPatientReferences(): Promise<void> {
    await db.delete(patientReferenceData);
  }

  async saveGeneratedNotes(records: InsertGeneratedNote[]): Promise<GeneratedNote[]> {
    if (records.length === 0) return [];
    const results = await db.insert(generatedNotes).values(records).returning();
    return results;
  }

  async getGeneratedNotesByBatch(batchId: number): Promise<GeneratedNote[]> {
    return db.select().from(generatedNotes)
      .where(eq(generatedNotes.batchId, batchId))
      .orderBy(generatedNotes.generatedAt);
  }

  async getAllGeneratedNotes(): Promise<GeneratedNote[]> {
    return db.select().from(generatedNotes)
      .orderBy(desc(generatedNotes.generatedAt));
  }

  async deleteGeneratedNotesByPatient(patientId: number): Promise<void> {
    await db.delete(generatedNotes).where(eq(generatedNotes.patientId, patientId));
  }

  async deleteGeneratedNotesByPatientAndService(patientId: number, service: string): Promise<void> {
    await db.delete(generatedNotes).where(
      and(eq(generatedNotes.patientId, patientId), eq(generatedNotes.service, service))
    );
  }

  async getGeneratedNotesByPatient(patientId: number): Promise<GeneratedNote[]> {
    return db.select().from(generatedNotes)
      .where(eq(generatedNotes.patientId, patientId))
      .orderBy(generatedNotes.generatedAt);
  }

  async getGeneratedNote(id: number): Promise<GeneratedNote | undefined> {
    const [result] = await db.select().from(generatedNotes).where(eq(generatedNotes.id, id));
    return result;
  }

  async updateGeneratedNoteDriveInfo(id: number, driveFileId: string, driveWebViewLink: string): Promise<GeneratedNote | undefined> {
    const [result] = await db.update(generatedNotes)
      .set({ driveFileId, driveWebViewLink })
      .where(eq(generatedNotes.id, id))
      .returning();
    return result;
  }

  async getAllBillingRecords(): Promise<BillingRecord[]> {
    return db.select().from(billingRecords).orderBy(desc(billingRecords.createdAt));
  }

  async getBillingRecordByPatientAndService(patientId: number, service: string): Promise<BillingRecord | undefined> {
    const [result] = await db.select().from(billingRecords)
      .where(and(eq(billingRecords.patientId, patientId), eq(billingRecords.service, service)));
    return result;
  }

  async createBillingRecord(record: InsertBillingRecord): Promise<BillingRecord> {
    const [result] = await db.insert(billingRecords).values(record).returning();
    return result;
  }

  async updateBillingRecord(id: number, updates: Partial<InsertBillingRecord>): Promise<BillingRecord | undefined> {
    const [result] = await db.update(billingRecords).set(updates).where(eq(billingRecords.id, id)).returning();
    return result;
  }

  async deleteBillingRecord(id: number): Promise<void> {
    await db.delete(billingRecords).where(eq(billingRecords.id, id));
  }

  async saveUploadedDocument(record: InsertUploadedDocument): Promise<UploadedDocument> {
    const [result] = await db.insert(uploadedDocuments).values(record).returning();
    return result;
  }

  async getAllUploadedDocuments(): Promise<UploadedDocument[]> {
    return db.select().from(uploadedDocuments).orderBy(desc(uploadedDocuments.uploadedAt));
  }
}

export const storage = new DatabaseStorage();
