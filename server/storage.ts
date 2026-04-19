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
  analysisJobs,
  plexusProjects,
  plexusTasks,
  plexusTaskCollaborators,
  plexusTaskMessages,
  plexusTaskEvents,
  plexusTaskReads,
  auditLog,
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
  type AnalysisJob,
  type InsertAnalysisJob,
  type PlexusProject,
  type InsertPlexusProject,
  type PlexusTask,
  type InsertPlexusTask,
  type PlexusTaskCollaborator,
  type InsertPlexusTaskCollaborator,
  type PlexusTaskMessage,
  type InsertPlexusTaskMessage,
  type PlexusTaskEvent,
  type InsertPlexusTaskEvent,
  type PlexusTaskRead,
  type AuditLog,
  type InsertAuditLog,
  users,
  type User,
  type InsertUser,
} from "@shared/schema";
import { eq, desc, ilike, sql, and, gte, lte, asc, ne, inArray, or } from "drizzle-orm";

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
  getAllUsers(): Promise<Omit<User, "password">[]>;
  getUserCount(): Promise<number>;
  updateUserPassword(id: string, plaintext: string): Promise<void>;
  updateUserRole(id: string, role: string): Promise<void>;
  validateUserPassword(username: string, plaintext: string): Promise<User | null>;
  deactivateUser(id: string): Promise<void>;
  deleteUser(id: string): Promise<void>;

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

  createAnalysisJob(record: InsertAnalysisJob): Promise<AnalysisJob>;
  updateAnalysisJob(id: number, updates: Partial<InsertAnalysisJob>): Promise<AnalysisJob | undefined>;
  incrementAnalysisJobProgress(jobId: number): Promise<void>;
  getLatestAnalysisJobByBatch(batchId: number): Promise<AnalysisJob | undefined>;
  getRecentAnalysisJobs(limit: number): Promise<Array<AnalysisJob & { batchName: string }>>;
  failRunningAnalysisJobs(errorMessage: string): Promise<void>;
  purgeOldAnalysisJobs(olderThanDays: number): Promise<void>;

  // ── Plexus Projects ────────────────────────────────────────────────────
  createProject(record: InsertPlexusProject): Promise<PlexusProject>;
  getProjects(): Promise<PlexusProject[]>;
  getProjectsForUser(userId: string): Promise<PlexusProject[]>;
  getProjectById(id: number): Promise<PlexusProject | undefined>;
  updateProject(id: number, updates: Partial<InsertPlexusProject>): Promise<PlexusProject | undefined>;

  // ── Plexus Tasks ───────────────────────────────────────────────────────
  createTask(record: InsertPlexusTask): Promise<PlexusTask>;
  getTaskById(id: number): Promise<PlexusTask | undefined>;
  getTasksByProject(projectId: number): Promise<PlexusTask[]>;
  getTasksByAssignee(userId: string): Promise<PlexusTask[]>;
  getTasksByCreator(userId: string): Promise<PlexusTask[]>;
  getTasksByCreatorWithActivity(userId: string): Promise<(PlexusTask & { lastActivityAt: Date | null })[]>;
  getTasksByPatient(patientScreeningId: number): Promise<PlexusTask[]>;
  getUrgentTasks(): Promise<PlexusTask[]>;
  getOverdueTasksForUser(userId: string): Promise<PlexusTask[]>;
  updateTask(id: number, updates: Partial<InsertPlexusTask>): Promise<PlexusTask | undefined>;

  // ── Plexus Collaborators ───────────────────────────────────────────────
  addCollaborator(record: InsertPlexusTaskCollaborator): Promise<PlexusTaskCollaborator>;
  getCollaborators(taskId: number): Promise<PlexusTaskCollaborator[]>;

  // ── Plexus Messages ────────────────────────────────────────────────────
  addMessage(record: InsertPlexusTaskMessage): Promise<PlexusTaskMessage>;
  getMessages(taskId: number): Promise<PlexusTaskMessage[]>;

  // ── Plexus Events ──────────────────────────────────────────────────────
  writeEvent(record: InsertPlexusTaskEvent): Promise<PlexusTaskEvent>;
  getEvents(taskId: number): Promise<PlexusTaskEvent[]>;

  // ── Plexus Reads ───────────────────────────────────────────────────────
  markRead(taskId: number, userId: string): Promise<void>;
  getUnreadCount(userId: string): Promise<number>;

  // ── Plexus Deletes ─────────────────────────────────────────────────────
  deleteTask(id: number): Promise<void>;
  deleteProject(id: number): Promise<void>;

  // ── Plexus Unread Per Task ──────────────────────────────────────────────
  getUnreadPerTask(userId: string): Promise<{ taskId: number; unreadCount: number }[]>;

  // ── Patient search (for task patient-link) ─────────────────────────────
  searchPatientsByName(query: string): Promise<PatientScreening[]>;
  getPatientById(id: number): Promise<PatientScreening | undefined>;

  // ── Audit Log ────────────────────────────────────────────────────────────
  createAuditLog(record: InsertAuditLog): Promise<AuditLog>;
  getAuditLogs(filters?: {
    userId?: string;
    entityType?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
  }): Promise<AuditLog[]>;
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

  async updateUserPassword(id: string, plaintext: string): Promise<void> {
    const hashed = await bcrypt.hash(plaintext, 12);
    await db.update(users).set({ password: hashed }).where(eq(users.id, id));
  }

  async updateUserRole(id: string, role: string): Promise<void> {
    await db.update(users).set({ role }).where(eq(users.id, id));
  }

  async validateUserPassword(username: string, plaintext: string): Promise<User | null> {
    const user = await this.getUserByUsername(username);
    if (!user) return null;
    const match = await bcrypt.compare(plaintext, user.password);
    return match ? user : null;
  }

  async getAllUsers(): Promise<Omit<User, "password">[]> {
    const rows = await db.select({
      id: users.id,
      username: users.username,
      active: users.active,
    }).from(users).orderBy(asc(users.username));
    return rows;
  }

  async deactivateUser(id: string): Promise<void> {
    await db.update(users).set({ active: false }).where(eq(users.id, id));
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
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

  async createAnalysisJob(record: InsertAnalysisJob): Promise<AnalysisJob> {
    const [result] = await db.insert(analysisJobs).values(record).returning();
    return result;
  }

  async updateAnalysisJob(id: number, updates: Partial<InsertAnalysisJob>): Promise<AnalysisJob | undefined> {
    const [result] = await db.update(analysisJobs).set(updates).where(eq(analysisJobs.id, id)).returning();
    return result;
  }

  async incrementAnalysisJobProgress(jobId: number): Promise<void> {
    await db.update(analysisJobs)
      .set({ completedPatients: sql`${analysisJobs.completedPatients} + 1` })
      .where(eq(analysisJobs.id, jobId));
  }

  async getLatestAnalysisJobByBatch(batchId: number): Promise<AnalysisJob | undefined> {
    const [result] = await db.select().from(analysisJobs)
      .where(eq(analysisJobs.batchId, batchId))
      .orderBy(desc(analysisJobs.startedAt))
      .limit(1);
    return result;
  }

  async getRecentAnalysisJobs(limit: number): Promise<Array<AnalysisJob & { batchName: string }>> {
    const rows = await db
      .select({
        id: analysisJobs.id,
        batchId: analysisJobs.batchId,
        status: analysisJobs.status,
        totalPatients: analysisJobs.totalPatients,
        completedPatients: analysisJobs.completedPatients,
        errorMessage: analysisJobs.errorMessage,
        startedAt: analysisJobs.startedAt,
        completedAt: analysisJobs.completedAt,
        batchName: screeningBatches.name,
      })
      .from(analysisJobs)
      .leftJoin(screeningBatches, eq(analysisJobs.batchId, screeningBatches.id))
      .orderBy(desc(analysisJobs.startedAt))
      .limit(limit);
    return rows.map((r) => ({ ...r, batchName: r.batchName ?? `Batch #${r.batchId}` }));
  }

  async failRunningAnalysisJobs(errorMessage: string): Promise<void> {
    await db.update(analysisJobs)
      .set({ status: "failed", errorMessage, completedAt: new Date() })
      .where(eq(analysisJobs.status, "running"));
  }

  async purgeOldAnalysisJobs(olderThanDays: number): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    await db.delete(analysisJobs).where(
      and(
        sql`${analysisJobs.completedAt} IS NOT NULL`,
        sql`${analysisJobs.completedAt} < ${cutoff}`
      )
    );
  }

  // ── Plexus Projects ──────────────────────────────────────────────────────────
  async createProject(record: InsertPlexusProject): Promise<PlexusProject> {
    const [result] = await db.insert(plexusProjects).values(record).returning();
    return result;
  }

  async getProjects(): Promise<PlexusProject[]> {
    return db.select().from(plexusProjects).orderBy(asc(plexusProjects.title));
  }

  async getProjectsForUser(userId: string): Promise<PlexusProject[]> {
    const ownedProjects = await db.select({ id: plexusProjects.id })
      .from(plexusProjects)
      .where(eq(plexusProjects.createdByUserId, userId));
    const taskRows = await db.select({ projectId: plexusTasks.projectId })
      .from(plexusTasks)
      .where(and(
        sql`${plexusTasks.projectId} IS NOT NULL`,
        sql`(${plexusTasks.createdByUserId} = ${userId} OR ${plexusTasks.assignedToUserId} = ${userId})`
      ));
    const collabRows = await db.select({ taskId: plexusTaskCollaborators.taskId })
      .from(plexusTaskCollaborators)
      .where(eq(plexusTaskCollaborators.userId, userId));
    const taskIds = collabRows.map((c) => c.taskId);
    let collabProjectIds: number[] = [];
    if (taskIds.length > 0) {
      const collabTasks = await db.select({ projectId: plexusTasks.projectId })
        .from(plexusTasks)
        .where(and(inArray(plexusTasks.id, taskIds), sql`${plexusTasks.projectId} IS NOT NULL`));
      collabProjectIds = collabTasks.map((t) => t.projectId).filter((id): id is number => id != null);
    }
    const allIds = Array.from(new Set([
      ...ownedProjects.map((p) => p.id),
      ...taskRows.map((t) => t.projectId).filter((id): id is number => id != null),
      ...collabProjectIds,
    ]));
    if (allIds.length === 0) return [];
    return db.select().from(plexusProjects)
      .where(inArray(plexusProjects.id, allIds))
      .orderBy(asc(plexusProjects.title));
  }

  async getProjectById(id: number): Promise<PlexusProject | undefined> {
    const [result] = await db.select().from(plexusProjects).where(eq(plexusProjects.id, id));
    return result;
  }

  async updateProject(id: number, updates: Partial<InsertPlexusProject>): Promise<PlexusProject | undefined> {
    const [result] = await db.update(plexusProjects).set(updates).where(eq(plexusProjects.id, id)).returning();
    return result;
  }

  // ── Plexus Tasks ─────────────────────────────────────────────────────────────
  async createTask(record: InsertPlexusTask): Promise<PlexusTask> {
    const [result] = await db.insert(plexusTasks).values(record).returning();
    return result;
  }

  async getTaskById(id: number): Promise<PlexusTask | undefined> {
    const [result] = await db.select().from(plexusTasks).where(eq(plexusTasks.id, id));
    return result;
  }

  async getTasksByProject(projectId: number): Promise<PlexusTask[]> {
    return db.select().from(plexusTasks)
      .where(eq(plexusTasks.projectId, projectId))
      .orderBy(asc(plexusTasks.createdAt));
  }

  async getTasksByAssignee(userId: string): Promise<PlexusTask[]> {
    return db.select().from(plexusTasks)
      .where(and(eq(plexusTasks.assignedToUserId, userId), ne(plexusTasks.status, "closed")))
      .orderBy(desc(plexusTasks.createdAt));
  }

  async getTasksByCreator(userId: string): Promise<PlexusTask[]> {
    return db.select().from(plexusTasks)
      .where(eq(plexusTasks.createdByUserId, userId))
      .orderBy(desc(plexusTasks.createdAt));
  }

  async getTasksByPatient(patientScreeningId: number): Promise<PlexusTask[]> {
    return db.select().from(plexusTasks)
      .where(eq(plexusTasks.patientScreeningId, patientScreeningId))
      .orderBy(desc(plexusTasks.createdAt));
  }

  async getTasksByCreatorWithActivity(userId: string): Promise<(PlexusTask & { lastActivityAt: Date | null })[]> {
    const tasks = await db.select().from(plexusTasks)
      .where(eq(plexusTasks.createdByUserId, userId))
      .orderBy(desc(plexusTasks.updatedAt));
    if (tasks.length === 0) return [];
    const taskIds = tasks.map((t) => t.id);
    const latestMsgs = await db.select({
      taskId: plexusTaskMessages.taskId,
      latestAt: sql<Date>`MAX(${plexusTaskMessages.createdAt})`,
    })
      .from(plexusTaskMessages)
      .where(inArray(plexusTaskMessages.taskId, taskIds))
      .groupBy(plexusTaskMessages.taskId);
    const msgMap = new Map(latestMsgs.map((m) => [m.taskId, m.latestAt]));
    return tasks.map((t) => ({
      ...t,
      lastActivityAt: msgMap.get(t.id) ?? t.updatedAt,
    }));
  }

  async getUrgentTasks(): Promise<PlexusTask[]> {
    return db.select().from(plexusTasks)
      .where(and(
        ne(plexusTasks.urgency, "none"),
        ne(plexusTasks.status, "closed"),
        ne(plexusTasks.status, "done")
      ))
      .orderBy(desc(plexusTasks.createdAt));
  }

  async getOverdueTasksForUser(userId: string): Promise<PlexusTask[]> {
    const today = new Date().toISOString().slice(0, 10);
    return db.select().from(plexusTasks)
      .where(and(
        or(
          eq(plexusTasks.assignedToUserId, userId),
          eq(plexusTasks.createdByUserId, userId),
        ),
        ne(plexusTasks.status, "closed"),
        ne(plexusTasks.status, "done"),
        sql`${plexusTasks.dueDate} IS NOT NULL`,
        lte(plexusTasks.dueDate, today),
      ))
      .orderBy(asc(plexusTasks.dueDate));
  }

  async updateTask(id: number, updates: Partial<InsertPlexusTask>): Promise<PlexusTask | undefined> {
    const [result] = await db.update(plexusTasks)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(plexusTasks.id, id))
      .returning();
    return result;
  }

  // ── Plexus Collaborators ──────────────────────────────────────────────────────
  async addCollaborator(record: InsertPlexusTaskCollaborator): Promise<PlexusTaskCollaborator> {
    const existing = await db.select().from(plexusTaskCollaborators)
      .where(and(eq(plexusTaskCollaborators.taskId, record.taskId), eq(plexusTaskCollaborators.userId, record.userId)))
      .limit(1);
    if (existing.length > 0) {
      const [updated] = await db.update(plexusTaskCollaborators)
        .set({ role: record.role })
        .where(eq(plexusTaskCollaborators.id, existing[0].id))
        .returning();
      return updated;
    }
    const [result] = await db.insert(plexusTaskCollaborators).values(record).returning();
    return result;
  }

  async getCollaborators(taskId: number): Promise<PlexusTaskCollaborator[]> {
    return db.select().from(plexusTaskCollaborators).where(eq(plexusTaskCollaborators.taskId, taskId));
  }

  // ── Plexus Messages ───────────────────────────────────────────────────────────
  async addMessage(record: InsertPlexusTaskMessage): Promise<PlexusTaskMessage> {
    const [result] = await db.insert(plexusTaskMessages).values(record).returning();
    await db.update(plexusTasks).set({ updatedAt: new Date() }).where(eq(plexusTasks.id, record.taskId));
    return result;
  }

  async getMessages(taskId: number): Promise<PlexusTaskMessage[]> {
    return db.select().from(plexusTaskMessages)
      .where(eq(plexusTaskMessages.taskId, taskId))
      .orderBy(asc(plexusTaskMessages.createdAt));
  }

  // ── Plexus Events ─────────────────────────────────────────────────────────────
  async writeEvent(record: InsertPlexusTaskEvent): Promise<PlexusTaskEvent> {
    const [result] = await db.insert(plexusTaskEvents).values(record).returning();
    return result;
  }

  async getEvents(taskId: number): Promise<PlexusTaskEvent[]> {
    return db.select().from(plexusTaskEvents)
      .where(eq(plexusTaskEvents.taskId, taskId))
      .orderBy(asc(plexusTaskEvents.createdAt));
  }

  // ── Plexus Reads ──────────────────────────────────────────────────────────────
  async markRead(taskId: number, userId: string): Promise<void> {
    const now = new Date();
    const existing = await db.select().from(plexusTaskReads)
      .where(and(eq(plexusTaskReads.taskId, taskId), eq(plexusTaskReads.userId, userId)))
      .limit(1);
    if (existing.length > 0) {
      await db.update(plexusTaskReads)
        .set({ lastReadAt: now })
        .where(eq(plexusTaskReads.id, existing[0].id));
    } else {
      await db.insert(plexusTaskReads).values({ taskId, userId });
    }
    await db.insert(plexusTaskEvents).values({
      taskId,
      userId,
      eventType: "read",
      payload: { readAt: now.toISOString() },
    });
  }

  // Returns task IDs where the user has membership for unread counting.
  // Closed tasks are excluded from direct membership — unread badges
  // for closed tasks would be noise since closed tasks are considered archived.
  // Collaborator tasks are always included (to catch team-help scenarios).
  private async _getMemberTaskIds(userId: string): Promise<number[]> {
    const [directRows, collabRows] = await Promise.all([
      db.select({ id: plexusTasks.id }).from(plexusTasks)
        .where(and(
          ne(plexusTasks.status, "closed"),
          sql`(${plexusTasks.assignedToUserId} = ${userId} OR ${plexusTasks.createdByUserId} = ${userId})`
        )),
      db.select({ taskId: plexusTaskCollaborators.taskId })
        .from(plexusTaskCollaborators)
        .where(eq(plexusTaskCollaborators.userId, userId)),
    ]);
    return Array.from(new Set([
      ...directRows.map((t) => t.id),
      ...collabRows.map((c) => c.taskId),
    ]));
  }

  // Canonical unread semantics: counts unread MESSAGES (not tasks).
  // A message is unread if: user has no read record for the task, OR
  // the message was sent after the user's last_read_at for that task.
  // This powers the GlobalNav badge and per-task indicators.
  async getUnreadCount(userId: string): Promise<number> {
    const taskIds = await this._getMemberTaskIds(userId);
    if (taskIds.length === 0) return 0;
    const [msgRows, readRows] = await Promise.all([
      db.select({ taskId: plexusTaskMessages.taskId, createdAt: plexusTaskMessages.createdAt })
        .from(plexusTaskMessages)
        .where(and(
          inArray(plexusTaskMessages.taskId, taskIds),
          sql`${plexusTaskMessages.senderUserId} != ${userId}`
        )),
      db.select({ taskId: plexusTaskReads.taskId, lastReadAt: plexusTaskReads.lastReadAt })
        .from(plexusTaskReads)
        .where(and(eq(plexusTaskReads.userId, userId), inArray(plexusTaskReads.taskId, taskIds))),
    ]);
    const readMap = new Map(readRows.map((r) => [r.taskId, r.lastReadAt]));
    return msgRows.filter((m) => {
      const lastRead = readMap.get(m.taskId);
      return !lastRead || m.createdAt > lastRead;
    }).length;
  }

  async deleteTask(id: number): Promise<void> {
    await db.delete(plexusTasks).where(eq(plexusTasks.id, id));
  }

  async deleteProject(id: number): Promise<void> {
    await db.delete(plexusProjects).where(eq(plexusProjects.id, id));
  }

  async getUnreadPerTask(userId: string): Promise<{ taskId: number; unreadCount: number }[]> {
    const taskIds = await this._getMemberTaskIds(userId);
    if (taskIds.length === 0) return [];
    const [msgRows, readRows] = await Promise.all([
      db.select({ taskId: plexusTaskMessages.taskId, createdAt: plexusTaskMessages.createdAt })
        .from(plexusTaskMessages)
        .where(and(
          inArray(plexusTaskMessages.taskId, taskIds),
          sql`${plexusTaskMessages.senderUserId} != ${userId}`
        )),
      db.select({ taskId: plexusTaskReads.taskId, lastReadAt: plexusTaskReads.lastReadAt })
        .from(plexusTaskReads)
        .where(and(eq(plexusTaskReads.userId, userId), inArray(plexusTaskReads.taskId, taskIds))),
    ]);
    const readMap = new Map(readRows.map((r) => [r.taskId, r.lastReadAt]));
    const perTask = new Map<number, number>();
    for (const m of msgRows) {
      const lastRead = readMap.get(m.taskId);
      if (!lastRead || m.createdAt > lastRead) {
        perTask.set(m.taskId, (perTask.get(m.taskId) ?? 0) + 1);
      }
    }
    return Array.from(perTask.entries()).map(([taskId, unreadCount]) => ({ taskId, unreadCount }));
  }

  async searchPatientsByName(query: string): Promise<PatientScreening[]> {
    return db.select().from(patientScreenings)
      .where(sql`LOWER(${patientScreenings.name}) LIKE LOWER(${'%' + query + '%'})`)
      .limit(20);
  }

  async getPatientById(id: number): Promise<PatientScreening | undefined> {
    const [result] = await db.select().from(patientScreenings).where(eq(patientScreenings.id, id));
    return result;
  }

  async createAuditLog(record: InsertAuditLog): Promise<AuditLog> {
    const [entry] = await db.insert(auditLog).values(record).returning();
    return entry;
  }

  async getAuditLogs(filters?: {
    userId?: string;
    entityType?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
  }): Promise<AuditLog[]> {
    const conditions = [];
    if (filters?.userId) conditions.push(eq(auditLog.userId, filters.userId));
    if (filters?.entityType) conditions.push(eq(auditLog.entityType, filters.entityType));
    if (filters?.fromDate) conditions.push(gte(auditLog.createdAt, filters.fromDate));
    if (filters?.toDate) conditions.push(lte(auditLog.createdAt, filters.toDate));

    const query = db.select().from(auditLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.createdAt))
      .limit(filters?.limit ?? 200);

    return query;
  }
}

export const storage = new DatabaseStorage();
