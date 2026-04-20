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
  outreachCalls,
  ptoRequests,
  schedulerAssignments,
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
  type OutreachCall,
  type InsertOutreachCall,
  type PtoRequest,
  type InsertPtoRequest,
  type SchedulerAssignment,
  type InsertSchedulerAssignment,
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

// SQL-aggregated row shapes used by the patient-database endpoints.
// These let Postgres do the GROUP BY / JOIN work instead of pulling every
// screening, history row, and generated-note row into the Node process.
export type PatientRosterAggregateRow = {
  representativeId: number;
  batchId: number;
  name: string;
  dob: string | null;
  age: number | null;
  gender: string | null;
  phoneNumber: string | null;
  insurance: string | null;
  clinic: string;
  lastVisit: string | null;
  screeningCount: number;
  testCount: number;
  generatedNoteCount: number;
  cooldownActiveCount: number;
  nextCooldownClearsAt: string | null;
  daysUntilNextClear: number | null;
};

export type PatientRosterAggregateFilters = {
  search?: string;
  clinic?: string;
  /** "1d" | "1w" | "1m" — only include patients with an active cooldown clearing within this window */
  cooldownWindow?: string;
  /** 1-indexed page number. Defaults to 1. */
  page?: number;
  /** Number of patients per page. Defaults to 100, capped at 500. */
  pageSize?: number;
};

export type PatientRosterClinicTotal = {
  clinic: string;
  count: number;
};

export type PatientRosterAggregateResult = {
  rows: PatientRosterAggregateRow[];
  total: number;
  clinicTotals: PatientRosterClinicTotal[];
};

export type PatientCooldownClinicCount = {
  clinic: string;
  oneDay: number;
  oneWeek: number;
  oneMonth: number;
};

export type PatientGroupTotals = { patients: number; clinics: number };

export type UnmatchedHistoryReportRow = {
  id: number;
  patientName: string;
  dob: string | null;
  testName: string;
  dateOfService: string;
  clinic: string | null;
};

function formatDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s;
}

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
  getAllPatientScreenings(): Promise<PatientScreening[]>;
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
  getGeneratedNoteCountsByPatientId(): Promise<Map<number, number>>;
  getGeneratedNotesByPatientIds(patientIds: number[]): Promise<GeneratedNote[]>;
  deleteGeneratedNotesByPatient(patientId: number): Promise<void>;
  getGeneratedNotesByPatient(patientId: number): Promise<GeneratedNote[]>;

  // ── Patient-database aggregation (SQL GROUP BY name+dob, JOINs against
  // test history and generated notes). These let the roster/cooldown
  // endpoints scale without pulling whole tables into Node memory.
  getPatientRosterAggregates(filters?: PatientRosterAggregateFilters): Promise<PatientRosterAggregateResult>;
  getPatientCooldownDashboard(): Promise<{ totals: PatientGroupTotals; counts: { oneDay: number; oneWeek: number; oneMonth: number }; byClinic: PatientCooldownClinicCount[]; allClinics: string[] }>;
  getPatientHistoryImportReport(sampleLimit: number): Promise<{ totalHistoryRows: number; unmatchedCount: number; unmatched: UnmatchedHistoryReportRow[] }>;
  getPatientGroupScreenings(name: string, dob: string | null): Promise<PatientScreening[]>;
  getPatientGroupTestHistory(name: string, dob: string | null): Promise<PatientTestHistory[]>;
  getGeneratedNote(id: number): Promise<GeneratedNote | undefined>;
  updateGeneratedNoteDriveInfo(id: number, driveFileId: string, driveWebViewLink: string): Promise<GeneratedNote | undefined>;

  getAllBillingRecords(): Promise<BillingRecord[]>;
  getBillingRecordByPatientAndService(patientId: number, service: string): Promise<BillingRecord | undefined>;
  createBillingRecord(record: InsertBillingRecord): Promise<BillingRecord>;
  updateBillingRecord(id: number, updates: Partial<InsertBillingRecord>): Promise<BillingRecord | undefined>;
  deleteBillingRecord(id: number): Promise<void>;

  saveUploadedDocument(record: InsertUploadedDocument): Promise<UploadedDocument>;
  getAllUploadedDocuments(): Promise<UploadedDocument[]>;
  getUploadedDocument(id: number): Promise<UploadedDocument | undefined>;

  createAppointment(record: InsertAncillaryAppointment): Promise<AncillaryAppointment>;
  getAppointments(filters?: { facility?: string; date?: string; testType?: string; status?: string }): Promise<AncillaryAppointment[]>;
  getUpcomingAppointments(limit?: number): Promise<AncillaryAppointment[]>;
  cancelAppointment(id: number): Promise<AncillaryAppointment | undefined>;
  getAppointmentsByPatient(patientScreeningId: number): Promise<AncillaryAppointment[]>;

  getOutreachSchedulers(): Promise<OutreachScheduler[]>;
  createOutreachScheduler(record: InsertOutreachScheduler): Promise<OutreachScheduler>;
  updateOutreachScheduler(id: number, updates: Partial<InsertOutreachScheduler>): Promise<OutreachScheduler | undefined>;
  deleteOutreachScheduler(id: number): Promise<OutreachScheduler | undefined>;

  // ── Outreach Calls (persistent call history) ──────────────────────────────
  createOutreachCall(record: InsertOutreachCall): Promise<OutreachCall>;
  // Atomic: insert call + (conditionally) update patient appointmentStatus
  // in a single transaction so concurrent writes can't downgrade a
  // "scheduled" patient between the SELECT and the UPDATE.
  createOutreachCallAtomic(
    record: InsertOutreachCall,
    desiredStatus: string,
  ): Promise<OutreachCall>;
  listOutreachCallsForPatient(patientScreeningId: number): Promise<OutreachCall[]>;
  listOutreachCallsForPatients(patientScreeningIds: number[]): Promise<OutreachCall[]>;
  listOutreachCallsForSchedulerToday(schedulerUserId: string, todayIso: string): Promise<OutreachCall[]>;
  latestOutreachCallForPatient(patientScreeningId: number): Promise<OutreachCall | undefined>;

  // ── Scheduler Assignments ─────────────────────────────────────────────────
  createSchedulerAssignment(record: InsertSchedulerAssignment): Promise<SchedulerAssignment>;
  bulkCreateSchedulerAssignments(records: InsertSchedulerAssignment[]): Promise<SchedulerAssignment[]>;
  applySchedulerAssignmentDiff(
    releaseIds: number[],
    drafts: InsertSchedulerAssignment[],
    reason: string,
  ): Promise<{ released: SchedulerAssignment[]; created: SchedulerAssignment[] }>;
  listActiveSchedulerAssignments(filters?: { schedulerId?: number; asOfDate?: string }): Promise<SchedulerAssignment[]>;
  getActiveAssignmentForPatient(patientScreeningId: number): Promise<SchedulerAssignment | undefined>;
  getActiveAssignmentForPatientOnDate(patientScreeningId: number, asOfDate: string): Promise<SchedulerAssignment | undefined>;
  releaseSchedulerAssignmentsForScheduler(schedulerId: number, asOfDate: string, reason: string): Promise<SchedulerAssignment[]>;
  releaseSchedulerAssignmentsByIds(ids: number[], reason: string): Promise<SchedulerAssignment[]>;
  releaseStaleActiveAssignments(beforeAsOfDate: string, reason: string): Promise<number>;
  reassignSchedulerAssignment(id: number, newSchedulerId: number, reason: string): Promise<SchedulerAssignment | undefined>;
  markSchedulerAssignmentCompleted(patientScreeningId: number): Promise<void>;

  // ── PTO Requests ─────────────────────────────────────────────────────────
  createPtoRequest(record: InsertPtoRequest): Promise<PtoRequest>;
  getPtoRequests(filters?: { userId?: string; status?: string; fromDate?: string; toDate?: string }): Promise<PtoRequest[]>;
  getPtoRequest(id: number): Promise<PtoRequest | undefined>;
  reviewPtoRequest(id: number, status: "approved" | "denied", reviewedBy: string): Promise<PtoRequest | undefined>;
  deletePtoRequest(id: number): Promise<void>;

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
  getTasksByPatientScreeningId(patientScreeningId: number): Promise<PlexusTask[]>;

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
      role: users.role,
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

  async getAllPatientScreenings(): Promise<PatientScreening[]> {
    return db.select().from(patientScreenings);
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

  async getGeneratedNotesByPatientIds(patientIds: number[]): Promise<GeneratedNote[]> {
    if (patientIds.length === 0) return [];
    return db.select().from(generatedNotes)
      .where(inArray(generatedNotes.patientId, patientIds))
      .orderBy(desc(generatedNotes.generatedAt));
  }

  // ── Patient-database SQL aggregation ───────────────────────────────────
  // All grouping happens in Postgres so the Node process never touches more
  // than one row per (name, dob) patient group, regardless of how many
  // screenings, test-history rows, or generated notes back that group.

  async getPatientRosterAggregates(filters: PatientRosterAggregateFilters = {}): Promise<PatientRosterAggregateResult> {
    const search = (filters.search ?? "").trim().toLowerCase();
    const clinic = (filters.clinic ?? "").trim();
    const cooldownWindow = (filters.cooldownWindow ?? "").trim();
    const cooldownLimit =
      cooldownWindow === "1d" ? 1
      : cooldownWindow === "1w" ? 7
      : cooldownWindow === "1m" ? 30
      : null;
    if (cooldownWindow && cooldownLimit === null) {
      // Unknown window — return nothing (matches old route behaviour).
      return { rows: [], total: 0, clinicTotals: [] };
    }

    const requestedPageSize = Number.isFinite(filters.pageSize) ? Number(filters.pageSize) : 100;
    const pageSize = Math.max(1, Math.min(500, Math.trunc(requestedPageSize) || 100));
    const requestedPage = Number.isFinite(filters.page) ? Number(filters.page) : 1;
    const page = Math.max(1, Math.trunc(requestedPage) || 1);
    const offset = (page - 1) * pageSize;

    // Shared CTE chain reused by both the page query and the totals query.
    // Keeping the SQL aligned guarantees pagination metadata matches the
    // rows actually returned for the page.
    const baseCte = sql`
      WITH groups AS (
        SELECT name, dob, COUNT(*)::int AS screening_count
        FROM patient_screenings
        GROUP BY name, dob
      ),
      repr AS (
        SELECT DISTINCT ON (ps.name, ps.dob)
          ps.name, ps.dob, ps.id, ps.batch_id, ps.age, ps.gender,
          ps.phone_number, ps.insurance, ps.facility, ps.created_at,
          sb.facility AS batch_facility, sb.schedule_date AS batch_schedule_date
        FROM patient_screenings ps
        LEFT JOIN screening_batches sb ON sb.id = ps.batch_id
        ORDER BY ps.name, ps.dob, ps.created_at DESC
      ),
      notes AS (
        SELECT ps.name, ps.dob, COUNT(gn.id)::int AS note_count
        FROM patient_screenings ps
        LEFT JOIN generated_notes gn ON gn.patient_id = ps.id
        GROUP BY ps.name, ps.dob
      ),
      history AS (
        SELECT patient_name AS name, dob, COUNT(*)::int AS test_count
        FROM patient_test_history
        GROUP BY patient_name, dob
      ),
      last_visit AS (
        SELECT ps.name, ps.dob,
          MAX(NULLIF(GREATEST(
            COALESCE(sb.schedule_date, ''),
            COALESCE(to_char(ps.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'), '')
          ), '')) AS last_visit
        FROM patient_screenings ps
        LEFT JOIN screening_batches sb ON sb.id = ps.batch_id
        GROUP BY ps.name, ps.dob
      ),
      latest_test AS (
        SELECT DISTINCT ON (patient_name, dob, lower(btrim(test_name)))
          patient_name, dob, test_name, date_of_service, insurance_type
        FROM patient_test_history
        WHERE date_of_service ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        ORDER BY patient_name, dob, lower(btrim(test_name)), date_of_service DESC
      ),
      test_clears AS (
        SELECT patient_name AS name, dob,
          (date_of_service::date + (
            CASE WHEN lower(insurance_type) = 'medicare'
                 THEN INTERVAL '12 months' ELSE INTERVAL '6 months' END
          ))::date AS clears_at
        FROM latest_test
      ),
      patient_cooldown AS (
        SELECT name, dob,
          COUNT(*) FILTER (WHERE clears_at > CURRENT_DATE)::int AS active_count,
          MIN(clears_at) FILTER (WHERE clears_at > CURRENT_DATE) AS next_clear
        FROM test_clears
        GROUP BY name, dob
      ),
      filtered AS (
        SELECT
          r.id AS representative_id,
          r.batch_id,
          r.name,
          r.dob,
          r.age,
          r.gender,
          r.phone_number,
          r.insurance,
          COALESCE(NULLIF(r.facility, ''), NULLIF(r.batch_facility, ''), 'Unassigned') AS clinic,
          lv.last_visit,
          g.screening_count,
          COALESCE(h.test_count, 0)::int AS test_count,
          COALESCE(n.note_count, 0)::int AS note_count,
          COALESCE(pc.active_count, 0)::int AS cooldown_active_count,
          pc.next_clear,
          CASE WHEN pc.next_clear IS NULL THEN NULL
               ELSE (pc.next_clear - CURRENT_DATE)::int END AS days_until_next_clear
        FROM repr r
        JOIN groups g ON g.name = r.name AND g.dob IS NOT DISTINCT FROM r.dob
        LEFT JOIN notes n ON n.name = r.name AND n.dob IS NOT DISTINCT FROM r.dob
        LEFT JOIN history h ON h.name = r.name AND h.dob IS NOT DISTINCT FROM r.dob
        LEFT JOIN last_visit lv ON lv.name = r.name AND lv.dob IS NOT DISTINCT FROM r.dob
        LEFT JOIN patient_cooldown pc ON pc.name = r.name AND pc.dob IS NOT DISTINCT FROM r.dob
        WHERE
          (${search}::text = '' OR lower(r.name || ' ' || COALESCE(r.dob, '')) LIKE '%' || ${search}::text || '%')
          AND (${clinic}::text = '' OR COALESCE(NULLIF(r.facility, ''), NULLIF(r.batch_facility, ''), 'Unassigned') = ${clinic}::text)
          AND (
            ${cooldownLimit}::int IS NULL
            OR (pc.next_clear IS NOT NULL AND (pc.next_clear - CURRENT_DATE) <= ${cooldownLimit}::int)
          )
      )
    `;

    const [pageResult, totalsResult] = await Promise.all([
      db.execute(sql`
        ${baseCte}
        SELECT *
        FROM filtered
        ORDER BY (clinic = 'Unassigned'), clinic ASC, name ASC
        LIMIT ${pageSize}::int OFFSET ${offset}::int
      `),
      db.execute(sql`
        ${baseCte}
        SELECT
          (SELECT COUNT(*)::int FROM filtered) AS total,
          COALESCE((
            SELECT json_agg(row_to_json(t)) FROM (
              SELECT clinic, COUNT(*)::int AS count
              FROM filtered
              GROUP BY clinic
              ORDER BY (clinic = 'Unassigned'), clinic ASC
            ) t
          ), '[]'::json) AS clinic_totals
      `),
    ]);

    const rows = (pageResult.rows as any[]).map((row) => ({
      representativeId: Number(row.representative_id),
      batchId: Number(row.batch_id),
      name: String(row.name),
      dob: row.dob ?? null,
      age: row.age == null ? null : Number(row.age),
      gender: row.gender ?? null,
      phoneNumber: row.phone_number ?? null,
      insurance: row.insurance ?? null,
      clinic: String(row.clinic ?? "Unassigned"),
      lastVisit: row.last_visit ?? null,
      screeningCount: Number(row.screening_count),
      testCount: Number(row.test_count),
      generatedNoteCount: Number(row.note_count),
      cooldownActiveCount: Number(row.cooldown_active_count),
      nextCooldownClearsAt: row.next_clear ? formatDate(row.next_clear) : null,
      daysUntilNextClear: row.days_until_next_clear == null ? null : Number(row.days_until_next_clear),
    }));

    const totalsRow = (totalsResult.rows as any[])[0] ?? { total: 0, clinic_totals: [] };
    const clinicTotalsRaw = Array.isArray(totalsRow.clinic_totals) ? totalsRow.clinic_totals : [];
    const clinicTotals: PatientRosterClinicTotal[] = clinicTotalsRaw.map((t: any) => ({
      clinic: String(t.clinic ?? "Unassigned"),
      count: Number(t.count ?? 0),
    }));

    return { rows, total: Number(totalsRow.total ?? 0), clinicTotals };
  }

  async getPatientCooldownDashboard(): Promise<{
    totals: PatientGroupTotals;
    counts: { oneDay: number; oneWeek: number; oneMonth: number };
    byClinic: PatientCooldownClinicCount[];
    allClinics: string[];
  }> {
    const result = await db.execute(sql`
      WITH patient_clinic AS (
        SELECT DISTINCT ON (ps.name, ps.dob)
          ps.name, ps.dob,
          COALESCE(NULLIF(ps.facility, ''), NULLIF(sb.facility, ''), 'Unassigned') AS clinic
        FROM patient_screenings ps
        LEFT JOIN screening_batches sb ON sb.id = ps.batch_id
        ORDER BY ps.name, ps.dob, ps.created_at DESC
      ),
      latest_test AS (
        SELECT DISTINCT ON (patient_name, dob, lower(btrim(test_name)))
          patient_name, dob, test_name, date_of_service, insurance_type
        FROM patient_test_history
        WHERE date_of_service ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        ORDER BY patient_name, dob, lower(btrim(test_name)), date_of_service DESC
      ),
      test_clears AS (
        SELECT patient_name AS name, dob,
          (date_of_service::date + (
            CASE WHEN lower(insurance_type) = 'medicare'
                 THEN INTERVAL '12 months' ELSE INTERVAL '6 months' END
          ))::date AS clears_at
        FROM latest_test
      ),
      patient_active AS (
        SELECT name, dob, MIN(clears_at) AS next_clear
        FROM test_clears
        WHERE clears_at > CURRENT_DATE
        GROUP BY name, dob
      ),
      joined AS (
        -- INNER JOIN on patient_clinic so the cooldown dashboard counts only
        -- patients that exist in the screening roster (matches the previous
        -- in-memory behaviour, which iterated screeningsByKey).
        SELECT pa.name, pa.dob, pa.next_clear,
          (pa.next_clear - CURRENT_DATE)::int AS days_until,
          pc.clinic
        FROM patient_active pa
        JOIN patient_clinic pc ON pc.name = pa.name AND pc.dob IS NOT DISTINCT FROM pa.dob
      )
      SELECT
        (SELECT COUNT(*)::int FROM patient_clinic) AS total_patients,
        (SELECT COUNT(DISTINCT clinic)::int FROM patient_clinic) AS total_clinics,
        (SELECT COUNT(*)::int FROM joined WHERE days_until <= 1) AS one_day_total,
        (SELECT COUNT(*)::int FROM joined WHERE days_until <= 7) AS one_week_total,
        (SELECT COUNT(*)::int FROM joined WHERE days_until <= 30) AS one_month_total,
        COALESCE((
          SELECT json_agg(row_to_json(t)) FROM (
            SELECT
              clinic,
              COUNT(*) FILTER (WHERE days_until <= 1)::int AS one_day,
              COUNT(*) FILTER (WHERE days_until <= 7)::int AS one_week,
              COUNT(*) FILTER (WHERE days_until <= 30)::int AS one_month
            FROM joined
            GROUP BY clinic
            HAVING COUNT(*) FILTER (WHERE days_until <= 30) > 0
            ORDER BY clinic
          ) t
        ), '[]'::json) AS by_clinic,
        COALESCE((
          SELECT json_agg(clinic ORDER BY (clinic = 'Unassigned'), clinic ASC)
          FROM (SELECT DISTINCT clinic FROM patient_clinic) c
        ), '[]'::json) AS all_clinics
    `);
    const row: any = (result.rows as any[])[0] ?? {};
    const byClinic = Array.isArray(row.by_clinic) ? row.by_clinic : [];
    const allClinics = Array.isArray(row.all_clinics) ? row.all_clinics : [];
    return {
      totals: {
        patients: Number(row.total_patients ?? 0),
        clinics: Number(row.total_clinics ?? 0),
      },
      counts: {
        oneDay: Number(row.one_day_total ?? 0),
        oneWeek: Number(row.one_week_total ?? 0),
        oneMonth: Number(row.one_month_total ?? 0),
      },
      byClinic: byClinic.map((c: any) => ({
        clinic: String(c.clinic ?? "Unassigned"),
        oneDay: Number(c.one_day ?? 0),
        oneWeek: Number(c.one_week ?? 0),
        oneMonth: Number(c.one_month ?? 0),
      })),
      allClinics: allClinics.map((c: any) => String(c ?? "Unassigned")),
    };
  }

  async getPatientHistoryImportReport(sampleLimit: number): Promise<{
    totalHistoryRows: number;
    unmatchedCount: number;
    unmatched: UnmatchedHistoryReportRow[];
  }> {
    const totalsRes = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM patient_test_history) AS total_rows,
        (SELECT COUNT(*)::int FROM patient_test_history h
           WHERE NOT EXISTS (
             SELECT 1 FROM patient_screenings ps
             WHERE ps.name = h.patient_name AND ps.dob IS NOT DISTINCT FROM h.dob
           )) AS unmatched_rows
    `);
    const totals: any = (totalsRes.rows as any[])[0] ?? {};

    const sampleRes = await db.execute(sql`
      SELECT h.id, h.patient_name, h.dob, h.test_name, h.date_of_service, h.clinic
      FROM patient_test_history h
      WHERE NOT EXISTS (
        SELECT 1 FROM patient_screenings ps
        WHERE ps.name = h.patient_name AND ps.dob IS NOT DISTINCT FROM h.dob
      )
      ORDER BY h.id DESC
      LIMIT ${sampleLimit}
    `);
    return {
      totalHistoryRows: Number(totals.total_rows ?? 0),
      unmatchedCount: Number(totals.unmatched_rows ?? 0),
      unmatched: (sampleRes.rows as any[]).map((r) => ({
        id: Number(r.id),
        patientName: String(r.patient_name),
        dob: r.dob ?? null,
        testName: String(r.test_name),
        dateOfService: String(r.date_of_service),
        clinic: r.clinic ?? null,
      })),
    };
  }

  async getPatientGroupScreenings(name: string, dob: string | null): Promise<PatientScreening[]> {
    return db.select().from(patientScreenings).where(and(
      eq(patientScreenings.name, name),
      dob === null
        ? sql`${patientScreenings.dob} IS NULL`
        : eq(patientScreenings.dob, dob),
    ));
  }

  async getPatientGroupTestHistory(name: string, dob: string | null): Promise<PatientTestHistory[]> {
    return db.select().from(patientTestHistory).where(and(
      eq(patientTestHistory.patientName, name),
      dob === null
        ? sql`${patientTestHistory.dob} IS NULL`
        : eq(patientTestHistory.dob, dob),
    )).orderBy(desc(patientTestHistory.dateOfService));
  }

  async getGeneratedNoteCountsByPatientId(): Promise<Map<number, number>> {
    const rows = await db
      .select({ patientId: generatedNotes.patientId, count: sql<number>`count(*)::int` })
      .from(generatedNotes)
      .groupBy(generatedNotes.patientId);
    const out = new Map<number, number>();
    for (const r of rows) out.set(r.patientId, Number(r.count));
    return out;
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

  async getUploadedDocument(id: number): Promise<UploadedDocument | undefined> {
    const [row] = await db.select().from(uploadedDocuments).where(eq(uploadedDocuments.id, id));
    return row;
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

  async createOutreachCall(record: InsertOutreachCall): Promise<OutreachCall> {
    const [result] = await db.insert(outreachCalls).values({
      ...record,
      callbackAt: record.callbackAt ?? null,
      durationSeconds: record.durationSeconds ?? null,
    }).returning();
    return result;
  }

  async createOutreachCallAtomic(
    record: InsertOutreachCall,
    desiredStatus: string,
  ): Promise<OutreachCall> {
    return await db.transaction(async (tx) => {
      const [call] = await tx.insert(outreachCalls).values({
        ...record,
        callbackAt: record.callbackAt ?? null,
        durationSeconds: record.durationSeconds ?? null,
      }).returning();

      // SQL-level guard: never downgrade a "scheduled" patient unless the
      // new status is also "scheduled". This is atomic against concurrent
      // writers because the predicate runs inside the same transaction.
      if (desiredStatus === "scheduled") {
        await tx.update(patientScreenings)
          .set({ appointmentStatus: desiredStatus })
          .where(eq(patientScreenings.id, record.patientScreeningId));
      } else {
        await tx.update(patientScreenings)
          .set({ appointmentStatus: desiredStatus })
          .where(and(
            eq(patientScreenings.id, record.patientScreeningId),
            ne(patientScreenings.appointmentStatus, "scheduled"),
          ));
      }

      return call;
    });
  }

  async listOutreachCallsForPatient(patientScreeningId: number): Promise<OutreachCall[]> {
    return db.select().from(outreachCalls)
      .where(eq(outreachCalls.patientScreeningId, patientScreeningId))
      .orderBy(desc(outreachCalls.startedAt));
  }

  async listOutreachCallsForPatients(patientScreeningIds: number[]): Promise<OutreachCall[]> {
    if (patientScreeningIds.length === 0) return [];
    return db.select().from(outreachCalls)
      .where(inArray(outreachCalls.patientScreeningId, patientScreeningIds))
      .orderBy(desc(outreachCalls.startedAt));
  }

  async listOutreachCallsForSchedulerToday(schedulerUserId: string, todayIso: string): Promise<OutreachCall[]> {
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

  async latestOutreachCallForPatient(patientScreeningId: number): Promise<OutreachCall | undefined> {
    const [row] = await db.select().from(outreachCalls)
      .where(eq(outreachCalls.patientScreeningId, patientScreeningId))
      .orderBy(desc(outreachCalls.startedAt))
      .limit(1);
    return row;
  }

  async deleteOutreachScheduler(id: number): Promise<OutreachScheduler | undefined> {
    const [deleted] = await db.delete(outreachSchedulers).where(eq(outreachSchedulers.id, id)).returning();
    return deleted;
  }

  // ── Scheduler Assignments ─────────────────────────────────────────────────
  async createSchedulerAssignment(record: InsertSchedulerAssignment): Promise<SchedulerAssignment> {
    const [row] = await db.insert(schedulerAssignments).values(record).returning();
    return row;
  }

  async bulkCreateSchedulerAssignments(records: InsertSchedulerAssignment[]): Promise<SchedulerAssignment[]> {
    if (records.length === 0) return [];
    return db.insert(schedulerAssignments).values(records).returning();
  }

  // Atomic apply — used by buildDailyAssignments. Wraps the release of
  // outdated active rows AND the insertion of new drafts in a single DB
  // transaction so a partial write cannot leave the day's call list in an
  // inconsistent state if the process crashes mid-build.
  async applySchedulerAssignmentDiff(
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

  async listActiveSchedulerAssignments(filters: { schedulerId?: number; asOfDate?: string } = {}): Promise<SchedulerAssignment[]> {
    const conds = [eq(schedulerAssignments.status, "active")];
    if (filters.schedulerId != null) conds.push(eq(schedulerAssignments.schedulerId, filters.schedulerId));
    if (filters.asOfDate) conds.push(eq(schedulerAssignments.asOfDate, filters.asOfDate));
    return db.select().from(schedulerAssignments)
      .where(and(...conds))
      .orderBy(asc(schedulerAssignments.assignedAt));
  }

  async getActiveAssignmentForPatient(patientScreeningId: number): Promise<SchedulerAssignment | undefined> {
    const [row] = await db.select().from(schedulerAssignments).where(and(
      eq(schedulerAssignments.patientScreeningId, patientScreeningId),
      eq(schedulerAssignments.status, "active"),
    )).limit(1);
    return row;
  }

  // Date-scoped lookup used by access-control checks (e.g. outreach call
  // logging) so authorization can never be granted/denied based on a stale
  // active row from a prior day's call list.
  async getActiveAssignmentForPatientOnDate(
    patientScreeningId: number,
    asOfDate: string,
  ): Promise<SchedulerAssignment | undefined> {
    const [row] = await db.select().from(schedulerAssignments).where(and(
      eq(schedulerAssignments.patientScreeningId, patientScreeningId),
      eq(schedulerAssignments.status, "active"),
      eq(schedulerAssignments.asOfDate, asOfDate),
    )).limit(1);
    return row;
  }

  async releaseSchedulerAssignmentsForScheduler(
    schedulerId: number,
    asOfDate: string,
    reason: string,
  ): Promise<SchedulerAssignment[]> {
    const released = await db.update(schedulerAssignments)
      .set({ status: "released", reason })
      .where(and(
        eq(schedulerAssignments.schedulerId, schedulerId),
        eq(schedulerAssignments.asOfDate, asOfDate),
        eq(schedulerAssignments.status, "active"),
      ))
      .returning();
    return released;
  }

  // Close any active row older than `beforeAsOfDate`. Used by daily build sweep.
  async releaseStaleActiveAssignments(beforeAsOfDate: string, reason: string): Promise<number> {
    const released = await db.update(schedulerAssignments)
      .set({ status: "released", reason })
      .where(and(
        eq(schedulerAssignments.status, "active"),
        sql`${schedulerAssignments.asOfDate} < ${beforeAsOfDate}`,
      ))
      .returning({ id: schedulerAssignments.id });
    return released.length;
  }

  async releaseSchedulerAssignmentsByIds(ids: number[], reason: string): Promise<SchedulerAssignment[]> {
    if (ids.length === 0) return [];
    const released = await db.update(schedulerAssignments)
      .set({ status: "released", reason })
      .where(and(
        inArray(schedulerAssignments.id, ids),
        eq(schedulerAssignments.status, "active"),
      ))
      .returning();
    return released;
  }

  async reassignSchedulerAssignment(
    id: number,
    newSchedulerId: number,
    reason: string,
  ): Promise<SchedulerAssignment | undefined> {
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

  async markSchedulerAssignmentCompleted(patientScreeningId: number): Promise<void> {
    await db.update(schedulerAssignments)
      .set({ status: "completed", completedAt: new Date() })
      .where(and(
        eq(schedulerAssignments.patientScreeningId, patientScreeningId),
        eq(schedulerAssignments.status, "active"),
      ));
  }

  // ── PTO Requests ─────────────────────────────────────────────────────────
  async createPtoRequest(record: InsertPtoRequest): Promise<PtoRequest> {
    const [created] = await db.insert(ptoRequests).values({
      userId: record.userId,
      startDate: record.startDate,
      endDate: record.endDate,
      note: record.note ?? null,
    }).returning();
    return created;
  }

  async getPtoRequests(filters: { userId?: string; status?: string; fromDate?: string; toDate?: string } = {}): Promise<PtoRequest[]> {
    const conditions = [];
    if (filters.userId) conditions.push(eq(ptoRequests.userId, filters.userId));
    if (filters.status) conditions.push(eq(ptoRequests.status, filters.status));
    if (filters.fromDate) conditions.push(gte(ptoRequests.endDate, filters.fromDate));
    if (filters.toDate) conditions.push(lte(ptoRequests.startDate, filters.toDate));
    return db.select().from(ptoRequests)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(ptoRequests.createdAt));
  }

  async getPtoRequest(id: number): Promise<PtoRequest | undefined> {
    const [r] = await db.select().from(ptoRequests).where(eq(ptoRequests.id, id));
    return r;
  }

  async reviewPtoRequest(id: number, status: "approved" | "denied", reviewedBy: string): Promise<PtoRequest | undefined> {
    const [updated] = await db.update(ptoRequests)
      .set({ status, reviewedBy, reviewedAt: new Date() })
      .where(eq(ptoRequests.id, id))
      .returning();
    return updated;
  }

  async deletePtoRequest(id: number): Promise<void> {
    await db.delete(ptoRequests).where(eq(ptoRequests.id, id));
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

  async getTasksByPatientScreeningId(patientScreeningId: number): Promise<PlexusTask[]> {
    return db.select().from(plexusTasks)
      .where(eq(plexusTasks.patientScreeningId, patientScreeningId))
      .orderBy(desc(plexusTasks.createdAt));
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
