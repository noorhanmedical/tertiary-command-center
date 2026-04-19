import { db } from "./db";
import bcrypt from "bcryptjs";
import {
  screeningBatches,
  patientScreenings,
  patientTestHistory,
  patientReferenceData,
  generatedNotes,
  billingRecords,
  uploadedDocuments,
  ancillaryAppointments,
  outreachSchedulers,
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
  type AncillaryAppointment,
  type InsertAncillaryAppointment,
  type OutreachScheduler,
  type InsertOutreachScheduler,
  users,
  type User,
  type InsertUser,
} from "@shared/schema";
import { eq, desc, ilike, sql, and, gte, asc } from "drizzle-orm";

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
  getUserCount(): Promise<number>;
  updateUserPassword(id: string, hashedPassword: string): Promise<void>;
  validateUserPassword(username: string, plaintext: string): Promise<User | null>;

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

  createAppointment(record: InsertAncillaryAppointment): Promise<AncillaryAppointment>;
  getAppointments(filters?: { facility?: string; date?: string; testType?: string; status?: string }): Promise<AncillaryAppointment[]>;
  getUpcomingAppointments(limit?: number): Promise<AncillaryAppointment[]>;
  cancelAppointment(id: number): Promise<AncillaryAppointment | undefined>;
  getAppointmentsByPatient(patientScreeningId: number): Promise<AncillaryAppointment[]>;

  getOutreachSchedulers(): Promise<OutreachScheduler[]>;
  createOutreachScheduler(record: InsertOutreachScheduler): Promise<OutreachScheduler>;
  updateOutreachScheduler(id: number, updates: Partial<InsertOutreachScheduler>): Promise<OutreachScheduler | undefined>;
  deleteOutreachScheduler(id: number): Promise<OutreachScheduler | undefined>;
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
    const hashed = await bcrypt.hash(insertUser.password, 12);
    const [user] = await db.insert(users).values({ ...insertUser, password: hashed }).returning();
    return user;
  }

  async getUserCount(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    return result[0]?.count ?? 0;
  }

  async updateUserPassword(id: string, hashedPassword: string): Promise<void> {
    await db.update(users).set({ password: hashedPassword }).where(eq(users.id, id));
  }

  async validateUserPassword(username: string, plaintext: string): Promise<User | null> {
    const user = await this.getUserByUsername(username);
    if (!user) return null;
    const match = await bcrypt.compare(plaintext, user.password);
    return match ? user : null;
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

  async createAppointment(record: InsertAncillaryAppointment): Promise<AncillaryAppointment> {
    const [result] = await db.insert(ancillaryAppointments).values(record).returning();
    return result;
  }

  async getAppointments(filters?: { facility?: string; date?: string; testType?: string; status?: string }): Promise<AncillaryAppointment[]> {
    const conditions = [];
    if (filters?.facility) conditions.push(eq(ancillaryAppointments.facility, filters.facility));
    if (filters?.date) conditions.push(eq(ancillaryAppointments.scheduledDate, filters.date));
    if (filters?.testType) conditions.push(eq(ancillaryAppointments.testType, filters.testType));
    if (filters?.status) conditions.push(eq(ancillaryAppointments.status, filters.status));

    if (conditions.length > 0) {
      return db.select().from(ancillaryAppointments)
        .where(and(...conditions))
        .orderBy(asc(ancillaryAppointments.scheduledDate), asc(ancillaryAppointments.scheduledTime));
    }
    return db.select().from(ancillaryAppointments)
      .orderBy(asc(ancillaryAppointments.scheduledDate), asc(ancillaryAppointments.scheduledTime));
  }

  async getUpcomingAppointments(limit?: number): Promise<AncillaryAppointment[]> {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const query = db.select().from(ancillaryAppointments)
      .where(and(
        gte(ancillaryAppointments.scheduledDate, todayStr),
        eq(ancillaryAppointments.status, "scheduled")
      ))
      .orderBy(asc(ancillaryAppointments.scheduledDate), asc(ancillaryAppointments.scheduledTime));
    if (limit !== undefined) return query.limit(limit);
    return query;
  }

  async cancelAppointment(id: number): Promise<AncillaryAppointment | undefined> {
    const [result] = await db.update(ancillaryAppointments)
      .set({ status: "cancelled" })
      .where(eq(ancillaryAppointments.id, id))
      .returning();
    return result;
  }

  async getAppointmentsByPatient(patientScreeningId: number): Promise<AncillaryAppointment[]> {
    return db.select().from(ancillaryAppointments)
      .where(eq(ancillaryAppointments.patientScreeningId, patientScreeningId))
      .orderBy(asc(ancillaryAppointments.scheduledDate), asc(ancillaryAppointments.scheduledTime));
  }

  async getOutreachSchedulers(): Promise<OutreachScheduler[]> {
    return db.select().from(outreachSchedulers).orderBy(asc(outreachSchedulers.name));
  }

  async createOutreachScheduler(record: InsertOutreachScheduler): Promise<OutreachScheduler> {
    const [result] = await db.insert(outreachSchedulers).values(record).returning();
    return result;
  }

  async updateOutreachScheduler(id: number, updates: Partial<InsertOutreachScheduler>): Promise<OutreachScheduler | undefined> {
    const [result] = await db.update(outreachSchedulers)
      .set(updates)
      .where(eq(outreachSchedulers.id, id))
      .returning();
    return result;
  }

  async deleteOutreachScheduler(id: number): Promise<OutreachScheduler | undefined> {
    const [deleted] = await db.delete(outreachSchedulers).where(eq(outreachSchedulers.id, id)).returning();
    return deleted;
  }
}

export const storage = new DatabaseStorage();
