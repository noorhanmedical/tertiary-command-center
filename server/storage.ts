/**
 * Thin storage facade.
 *
 * Historically `storage.ts` was a 2,000-line god-object that held every DB
 * call in the app. It has been split into per-domain repositories under
 * `server/repositories/*.repo.ts`. This file now exists purely as a backwards-
 * compatible delegating facade so existing route call-sites that do
 * `storage.foo(...)` keep working.
 *
 * New code should import the relevant repository directly, e.g.:
 *   import { invoicesRepository } from "./repositories/invoices.repo";
 */
import {
  usersRepository,
  auditRepository,
  ptoRepository,
  screeningRepository,
  patientHistoryRepository,
  notesRepository,
  billingRepository,
  invoicesRepository,
  uploadedDocumentsRepository,
  appointmentsRepository,
  outreachRepository,
  schedulerAssignmentsRepository,
  analysisJobsRepository,
  plexusRepository,
  marketingMaterialsRepository,
  documentLibraryRepository,
} from "./repositories";

import type {
  ScreeningBatch,
  InsertScreeningBatch,
  PatientScreening,
  InsertPatientScreening,
  PatientTestHistory,
  InsertTestHistory,
  PatientReference,
  InsertPatientReference,
  GeneratedNote,
  InsertGeneratedNote,
  BillingRecord,
  InsertBillingRecord,
  Invoice,
  InsertInvoice,
  InvoiceLineItem,
  InsertInvoiceLineItem,
  InvoicePayment,
  InsertInvoicePayment,
  UploadedDocument,
  InsertUploadedDocument,
  AncillaryAppointment,
  InsertAncillaryAppointment,
  OutreachScheduler,
  InsertOutreachScheduler,
  OutreachCall,
  InsertOutreachCall,
  PtoRequest,
  InsertPtoRequest,
  SchedulerAssignment,
  InsertSchedulerAssignment,
  AnalysisJob,
  InsertAnalysisJob,
  PlexusProject,
  InsertPlexusProject,
  PlexusTask,
  InsertPlexusTask,
  PlexusTaskCollaborator,
  InsertPlexusTaskCollaborator,
  PlexusTaskMessage,
  InsertPlexusTaskMessage,
  PlexusTaskEvent,
  InsertPlexusTaskEvent,
  AuditLog,
  InsertAuditLog,
  MarketingMaterial,
  InsertMarketingMaterial,
  Document,
  InsertDocument,
  DocumentSurfaceAssignment,
  DocumentSurface,
  DocumentKind,
  User,
  InsertUser,
} from "@shared/schema";

// Re-export the patient-aggregate types from the screening repo so existing
// imports `import { PatientRosterAggregateRow } from "@/storage"` keep working.
export type {
  PatientRosterAggregateRow,
  PatientRosterAggregateFilters,
  PatientRosterClinicTotal,
  PatientRosterAggregateResult,
  PatientCooldownClinicCount,
  PatientGroupTotals,
  UnmatchedHistoryReportRow,
} from "./repositories/screening.repo";

import type {
  PatientRosterAggregateFilters,
  PatientRosterAggregateResult,
  PatientCooldownClinicCount,
  PatientGroupTotals,
  UnmatchedHistoryReportRow,
} from "./repositories/screening.repo";

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

  getPatientRosterAggregates(filters?: PatientRosterAggregateFilters): Promise<PatientRosterAggregateResult>;
  getPatientCooldownDashboard(): Promise<{ totals: PatientGroupTotals; counts: { oneDay: number; oneWeek: number; oneMonth: number }; byClinic: PatientCooldownClinicCount[]; allClinics: string[] }>;
  getPatientHistoryImportReport(sampleLimit: number): Promise<{ totalHistoryRows: number; unmatchedCount: number; unmatched: UnmatchedHistoryReportRow[] }>;
  getPatientGroupScreenings(name: string, dob: string | null): Promise<PatientScreening[]>;
  getPatientGroupTestHistory(name: string, dob: string | null): Promise<PatientTestHistory[]>;
  getGeneratedNote(id: number): Promise<GeneratedNote | undefined>;
  updateGeneratedNoteDriveInfo(id: number, driveFileId: string, driveWebViewLink: string): Promise<GeneratedNote | undefined>;

  getAllBillingRecords(): Promise<BillingRecord[]>;
  getBillingRecordInvoiceLinks(): Promise<Array<{
    billingRecordId: number;
    invoiceId: number;
    invoiceNumber: string;
    status: string;
    totalBalance: string;
  }>>;
  getBillingRecordByPatientAndService(patientId: number, service: string): Promise<BillingRecord | undefined>;
  createBillingRecord(record: InsertBillingRecord): Promise<BillingRecord>;
  updateBillingRecord(id: number, updates: Partial<InsertBillingRecord>): Promise<BillingRecord | undefined>;
  deleteBillingRecord(id: number): Promise<void>;

  getAllInvoices(): Promise<Invoice[]>;
  getInvoice(id: number): Promise<Invoice | undefined>;
  getInvoiceLineItems(invoiceId: number): Promise<InvoiceLineItem[]>;
  createInvoiceWithLineItems(invoice: InsertInvoice, lineItems: Omit<InsertInvoiceLineItem, "invoiceId">[]): Promise<Invoice>;
  updateInvoiceStatus(id: number, status: string): Promise<Invoice | undefined>;
  markInvoiceSent(id: number, sentTo: string): Promise<Invoice | undefined>;
  markInvoiceReminded(id: number, when: Date): Promise<Invoice | undefined>;
  deleteInvoice(id: number): Promise<void>;
  getNextInvoiceNumber(): Promise<string>;
  getInvoicePayments(invoiceId: number): Promise<InvoicePayment[]>;
  createInvoicePayment(payment: InsertInvoicePayment): Promise<{ payment: InvoicePayment; invoice: Invoice }>;
  deleteInvoicePayment(invoiceId: number, paymentId: number): Promise<{ invoice: Invoice } | undefined>;

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

  createOutreachCall(record: InsertOutreachCall): Promise<OutreachCall>;
  createOutreachCallAtomic(record: InsertOutreachCall, desiredStatus: string): Promise<OutreachCall>;
  listOutreachCallsForPatient(patientScreeningId: number): Promise<OutreachCall[]>;
  listOutreachCallsForPatients(patientScreeningIds: number[]): Promise<OutreachCall[]>;
  listOutreachCallsForSchedulerToday(schedulerUserId: string, todayIso: string): Promise<OutreachCall[]>;
  latestOutreachCallForPatient(patientScreeningId: number): Promise<OutreachCall | undefined>;

  createSchedulerAssignment(record: InsertSchedulerAssignment): Promise<SchedulerAssignment>;
  bulkCreateSchedulerAssignments(records: InsertSchedulerAssignment[]): Promise<SchedulerAssignment[]>;
  applySchedulerAssignmentDiff(releaseIds: number[], drafts: InsertSchedulerAssignment[], reason: string): Promise<{ released: SchedulerAssignment[]; created: SchedulerAssignment[] }>;
  listActiveSchedulerAssignments(filters?: { schedulerId?: number; asOfDate?: string }): Promise<SchedulerAssignment[]>;
  getActiveAssignmentForPatient(patientScreeningId: number): Promise<SchedulerAssignment | undefined>;
  getActiveAssignmentForPatientOnDate(patientScreeningId: number, asOfDate: string): Promise<SchedulerAssignment | undefined>;
  releaseSchedulerAssignmentsForScheduler(schedulerId: number, asOfDate: string, reason: string): Promise<SchedulerAssignment[]>;
  releaseSchedulerAssignmentsByIds(ids: number[], reason: string): Promise<SchedulerAssignment[]>;
  releaseStaleActiveAssignments(beforeAsOfDate: string, reason: string): Promise<number>;
  reassignSchedulerAssignment(id: number, newSchedulerId: number, reason: string): Promise<SchedulerAssignment | undefined>;
  markSchedulerAssignmentCompleted(patientScreeningId: number): Promise<void>;

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

  createProject(record: InsertPlexusProject): Promise<PlexusProject>;
  getProjects(): Promise<PlexusProject[]>;
  getProjectsForUser(userId: string): Promise<PlexusProject[]>;
  getProjectById(id: number): Promise<PlexusProject | undefined>;
  updateProject(id: number, updates: Partial<InsertPlexusProject>): Promise<PlexusProject | undefined>;

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

  addCollaborator(record: InsertPlexusTaskCollaborator): Promise<PlexusTaskCollaborator>;
  getCollaborators(taskId: number): Promise<PlexusTaskCollaborator[]>;

  addMessage(record: InsertPlexusTaskMessage): Promise<PlexusTaskMessage>;
  getMessages(taskId: number): Promise<PlexusTaskMessage[]>;

  writeEvent(record: InsertPlexusTaskEvent): Promise<PlexusTaskEvent>;
  getEvents(taskId: number): Promise<PlexusTaskEvent[]>;

  markRead(taskId: number, userId: string): Promise<void>;
  getUnreadCount(userId: string): Promise<number>;

  deleteTask(id: number): Promise<void>;
  deleteProject(id: number): Promise<void>;

  getUnreadPerTask(userId: string): Promise<{ taskId: number; unreadCount: number }[]>;

  searchPatientsByName(query: string): Promise<PatientScreening[]>;
  getPatientById(id: number): Promise<PatientScreening | undefined>;
  getTasksByPatientScreeningId(patientScreeningId: number): Promise<PlexusTask[]>;

  createAuditLog(record: InsertAuditLog): Promise<AuditLog>;
  getAuditLogs(filters?: { userId?: string; entityType?: string; fromDate?: Date; toDate?: Date; limit?: number }): Promise<AuditLog[]>;

  getAllMarketingMaterials(): Promise<MarketingMaterial[]>;
  getMarketingMaterial(id: number): Promise<MarketingMaterial | undefined>;
  createMarketingMaterial(record: InsertMarketingMaterial): Promise<MarketingMaterial>;
  updateMarketingMaterialStorage(
    id: number,
    patch: { storagePath: string; sha256: string; filename: string; sizeBytes: number },
  ): Promise<MarketingMaterial>;
  deleteMarketingMaterial(id: number): Promise<void>;

  // Document library
  createDocument(record: InsertDocument): Promise<Document>;
  getDocument(id: number): Promise<Document | undefined>;
  listCurrentDocuments(filters?: { kind?: DocumentKind; surface?: DocumentSurface; patientScreeningId?: number }): Promise<Document[]>;
  getDocumentsForSurface(surface: DocumentSurface, opts?: { patientScreeningId?: number; kind?: DocumentKind }): Promise<Document[]>;
  getDocumentVersionChain(currentDocId: number): Promise<Document[]>;
  supersedeDocument(oldId: number, newId: number): Promise<void>;
  getDocumentAssignments(documentId: number): Promise<DocumentSurfaceAssignment[]>;
  addDocumentAssignment(documentId: number, surface: DocumentSurface): Promise<DocumentSurfaceAssignment>;
  removeDocumentAssignment(documentId: number, surface: DocumentSurface): Promise<void>;
  replaceDocumentAssignments(documentId: number, surfaces: DocumentSurface[]): Promise<DocumentSurfaceAssignment[]>;
  softDeleteDocument(id: number): Promise<void>;
  deleteDocument(id: number): Promise<void>;
}

/**
 * Backwards-compatible god-object facade. Each method just delegates to the
 * relevant per-domain repository so legacy `storage.foo(...)` call-sites in
 * routes keep working unchanged.
 */
export class DatabaseStorage implements IStorage {
  // Users
  getUser(id: string) { return usersRepository.getById(id); }
  getUserByUsername(username: string) { return usersRepository.getByUsername(username); }
  createUser(insertUser: InsertUser) { return usersRepository.create(insertUser); }
  getUserCount() { return usersRepository.count(); }
  updateUserPassword(id: string, plaintext: string) { return usersRepository.updatePassword(id, plaintext); }
  updateUserRole(id: string, role: string) { return usersRepository.updateRole(id, role); }
  validateUserPassword(username: string, plaintext: string) { return usersRepository.validatePassword(username, plaintext); }
  getAllUsers() { return usersRepository.listAll(); }
  deactivateUser(id: string) { return usersRepository.deactivate(id); }
  deleteUser(id: string) { return usersRepository.remove(id); }

  // Screening batches + patient screenings
  createScreeningBatch(batch: InsertScreeningBatch) { return screeningRepository.createBatch(batch); }
  getScreeningBatch(id: number) { return screeningRepository.getBatch(id); }
  getAllScreeningBatches() { return screeningRepository.listBatches(); }
  updateScreeningBatch(id: number, updates: Partial<InsertScreeningBatch>) { return screeningRepository.updateBatch(id, updates); }
  deleteScreeningBatch(id: number) { return screeningRepository.deleteBatch(id); }

  createPatientScreening(screening: InsertPatientScreening) { return screeningRepository.createScreening(screening); }
  getAllPatientScreenings() { return screeningRepository.listAllScreenings(); }
  getPatientScreeningsByBatch(batchId: number) { return screeningRepository.listScreeningsByBatch(batchId); }
  getPatientScreening(id: number) { return screeningRepository.getScreening(id); }
  updatePatientScreening(id: number, updates: Partial<InsertPatientScreening>) { return screeningRepository.updateScreening(id, updates); }
  deletePatientScreening(id: number) { return screeningRepository.deleteScreening(id); }

  searchPatientsByName(query: string) { return screeningRepository.searchPatientsByName(query); }
  getPatientById(id: number) { return screeningRepository.getScreening(id); }

  getPatientRosterAggregates(filters?: PatientRosterAggregateFilters) { return screeningRepository.getRosterAggregates(filters); }
  getPatientCooldownDashboard() { return screeningRepository.getCooldownDashboard(); }
  getPatientHistoryImportReport(sampleLimit: number) { return screeningRepository.getHistoryImportReport(sampleLimit); }
  getPatientGroupScreenings(name: string, dob: string | null) { return screeningRepository.getGroupScreenings(name, dob); }

  // Patient history + reference data
  createTestHistory(record: InsertTestHistory) { return patientHistoryRepository.createTestHistory(record); }
  createTestHistoryBulk(records: InsertTestHistory[]) { return patientHistoryRepository.createTestHistoryBulk(records); }
  bulkInsertTestHistoryIfNotExists(records: InsertTestHistory[]) { return patientHistoryRepository.bulkInsertTestHistoryIfNotExists(records); }
  getAllTestHistory() { return patientHistoryRepository.listAllTestHistory(); }
  searchTestHistory(nameQuery: string) { return patientHistoryRepository.searchTestHistory(nameQuery); }
  deleteTestHistory(id: number) { return patientHistoryRepository.deleteTestHistory(id); }
  deleteAllTestHistory() { return patientHistoryRepository.deleteAllTestHistory(); }
  getPatientGroupTestHistory(name: string, dob: string | null) { return patientHistoryRepository.getGroupTestHistory(name, dob); }

  createPatientReference(record: InsertPatientReference) { return patientHistoryRepository.createReference(record); }
  createPatientReferenceBulk(records: InsertPatientReference[]) { return patientHistoryRepository.createReferenceBulk(records); }
  getAllPatientReferences() { return patientHistoryRepository.listAllReferences(); }
  searchPatientReferences(nameQuery: string) { return patientHistoryRepository.searchReferences(nameQuery); }
  deletePatientReference(id: number) { return patientHistoryRepository.deleteReference(id); }
  deleteAllPatientReferences() { return patientHistoryRepository.deleteAllReferences(); }

  // Generated notes
  saveGeneratedNotes(records: InsertGeneratedNote[]) { return notesRepository.saveBulk(records); }
  deleteGeneratedNotesByPatientAndService(patientId: number, service: string) { return notesRepository.deleteByPatientAndService(patientId, service); }
  getGeneratedNotesByBatch(batchId: number) { return notesRepository.listByBatch(batchId); }
  getAllGeneratedNotes() { return notesRepository.listAll(); }
  getGeneratedNoteCountsByPatientId() { return notesRepository.countsByPatientId(); }
  getGeneratedNotesByPatientIds(patientIds: number[]) { return notesRepository.listByPatientIds(patientIds); }
  deleteGeneratedNotesByPatient(patientId: number) { return notesRepository.deleteByPatient(patientId); }
  getGeneratedNotesByPatient(patientId: number) { return notesRepository.listByPatient(patientId); }
  getGeneratedNote(id: number) { return notesRepository.getById(id); }
  updateGeneratedNoteDriveInfo(id: number, driveFileId: string, driveWebViewLink: string) { return notesRepository.updateDriveInfo(id, driveFileId, driveWebViewLink); }

  // Billing
  getAllBillingRecords() { return billingRepository.listAll(); }
  getBillingRecordByPatientAndService(patientId: number, service: string) { return billingRepository.getByPatientAndService(patientId, service); }
  createBillingRecord(record: InsertBillingRecord) { return billingRepository.create(record); }
  updateBillingRecord(id: number, updates: Partial<InsertBillingRecord>) { return billingRepository.update(id, updates); }
  deleteBillingRecord(id: number) { return billingRepository.remove(id); }

  // Invoices
  getAllInvoices() { return invoicesRepository.listAll(); }
  getInvoice(id: number) { return invoicesRepository.getById(id); }
  getInvoiceLineItems(invoiceId: number) { return invoicesRepository.listLineItems(invoiceId); }
  createInvoiceWithLineItems(invoice: InsertInvoice, lineItems: Omit<InsertInvoiceLineItem, "invoiceId">[]) {
    return invoicesRepository.createWithLineItems(invoice, lineItems);
  }
  updateInvoiceStatus(id: number, status: string) { return invoicesRepository.updateStatus(id, status); }
  markInvoiceSent(id: number, sentTo: string) { return invoicesRepository.markSent(id, sentTo); }
  deleteInvoice(id: number) { return invoicesRepository.remove(id); }
  getNextInvoiceNumber() { return invoicesRepository.nextInvoiceNumber(); }
  getInvoicePayments(invoiceId: number) { return invoicesRepository.listPayments(invoiceId); }
  createInvoicePayment(payment: InsertInvoicePayment) { return invoicesRepository.createPayment(payment); }
  deleteInvoicePayment(invoiceId: number, paymentId: number) { return invoicesRepository.deletePayment(invoiceId, paymentId); }

  // Uploaded documents
  saveUploadedDocument(record: InsertUploadedDocument) { return uploadedDocumentsRepository.save(record); }
  getAllUploadedDocuments() { return uploadedDocumentsRepository.listAll(); }
  getUploadedDocument(id: number) { return uploadedDocumentsRepository.getById(id); }

  // Appointments
  createAppointment(record: InsertAncillaryAppointment) { return appointmentsRepository.create(record); }
  getAppointments(filters?: { facility?: string; date?: string; testType?: string; status?: string }) { return appointmentsRepository.list(filters); }
  getUpcomingAppointments(limit?: number) { return appointmentsRepository.upcoming(limit); }
  cancelAppointment(id: number) { return appointmentsRepository.cancel(id); }
  getAppointmentsByPatient(patientScreeningId: number) { return appointmentsRepository.listByPatient(patientScreeningId); }

  // Outreach (schedulers + calls)
  getOutreachSchedulers() { return outreachRepository.listSchedulers(); }
  createOutreachScheduler(record: InsertOutreachScheduler) { return outreachRepository.createScheduler(record); }
  updateOutreachScheduler(id: number, updates: Partial<InsertOutreachScheduler>) { return outreachRepository.updateScheduler(id, updates); }
  deleteOutreachScheduler(id: number) { return outreachRepository.deleteScheduler(id); }

  createOutreachCall(record: InsertOutreachCall) { return outreachRepository.createCall(record); }
  createOutreachCallAtomic(record: InsertOutreachCall, desiredStatus: string) { return outreachRepository.createCallAtomic(record, desiredStatus); }
  listOutreachCallsForPatient(patientScreeningId: number) { return outreachRepository.listCallsForPatient(patientScreeningId); }
  listOutreachCallsForPatients(patientScreeningIds: number[]) { return outreachRepository.listCallsForPatients(patientScreeningIds); }
  listOutreachCallsForSchedulerToday(schedulerUserId: string, todayIso: string) { return outreachRepository.listCallsForSchedulerToday(schedulerUserId, todayIso); }
  latestOutreachCallForPatient(patientScreeningId: number) { return outreachRepository.latestCallForPatient(patientScreeningId); }

  // Scheduler assignments
  createSchedulerAssignment(record: InsertSchedulerAssignment) { return schedulerAssignmentsRepository.create(record); }
  bulkCreateSchedulerAssignments(records: InsertSchedulerAssignment[]) { return schedulerAssignmentsRepository.bulkCreate(records); }
  applySchedulerAssignmentDiff(releaseIds: number[], drafts: InsertSchedulerAssignment[], reason: string) {
    return schedulerAssignmentsRepository.applyDiff(releaseIds, drafts, reason);
  }
  listActiveSchedulerAssignments(filters: { schedulerId?: number; asOfDate?: string } = {}) { return schedulerAssignmentsRepository.listActive(filters); }
  getActiveAssignmentForPatient(patientScreeningId: number) { return schedulerAssignmentsRepository.getActiveForPatient(patientScreeningId); }
  getActiveAssignmentForPatientOnDate(patientScreeningId: number, asOfDate: string) { return schedulerAssignmentsRepository.getActiveForPatientOnDate(patientScreeningId, asOfDate); }
  releaseSchedulerAssignmentsForScheduler(schedulerId: number, asOfDate: string, reason: string) { return schedulerAssignmentsRepository.releaseForScheduler(schedulerId, asOfDate, reason); }
  releaseSchedulerAssignmentsByIds(ids: number[], reason: string) { return schedulerAssignmentsRepository.releaseByIds(ids, reason); }
  releaseStaleActiveAssignments(beforeAsOfDate: string, reason: string) { return schedulerAssignmentsRepository.releaseStale(beforeAsOfDate, reason); }
  reassignSchedulerAssignment(id: number, newSchedulerId: number, reason: string) { return schedulerAssignmentsRepository.reassign(id, newSchedulerId, reason); }
  markSchedulerAssignmentCompleted(patientScreeningId: number) { return schedulerAssignmentsRepository.markCompleted(patientScreeningId); }

  // PTO
  createPtoRequest(record: InsertPtoRequest) { return ptoRepository.create(record); }
  getPtoRequests(filters: { userId?: string; status?: string; fromDate?: string; toDate?: string } = {}) { return ptoRepository.list(filters); }
  getPtoRequest(id: number) { return ptoRepository.getById(id); }
  reviewPtoRequest(id: number, status: "approved" | "denied", reviewedBy: string) { return ptoRepository.review(id, status, reviewedBy); }
  deletePtoRequest(id: number) { return ptoRepository.remove(id); }

  // Analysis jobs
  createAnalysisJob(record: InsertAnalysisJob) { return analysisJobsRepository.create(record); }
  updateAnalysisJob(id: number, updates: Partial<InsertAnalysisJob>) { return analysisJobsRepository.update(id, updates); }
  incrementAnalysisJobProgress(jobId: number) { return analysisJobsRepository.incrementProgress(jobId); }
  getLatestAnalysisJobByBatch(batchId: number) { return analysisJobsRepository.latestByBatch(batchId); }
  getRecentAnalysisJobs(limit: number) { return analysisJobsRepository.recent(limit); }
  failRunningAnalysisJobs(errorMessage: string) { return analysisJobsRepository.failRunning(errorMessage); }
  purgeOldAnalysisJobs(olderThanDays: number) { return analysisJobsRepository.purgeOld(olderThanDays); }

  // Plexus
  createProject(record: InsertPlexusProject) { return plexusRepository.createProject(record); }
  getProjects() { return plexusRepository.listProjects(); }
  getProjectsForUser(userId: string) { return plexusRepository.listProjectsForUser(userId); }
  getProjectById(id: number) { return plexusRepository.getProject(id); }
  updateProject(id: number, updates: Partial<InsertPlexusProject>) { return plexusRepository.updateProject(id, updates); }
  deleteProject(id: number) { return plexusRepository.deleteProject(id); }

  createTask(record: InsertPlexusTask) { return plexusRepository.createTask(record); }
  getTaskById(id: number) { return plexusRepository.getTask(id); }
  getTasksByProject(projectId: number) { return plexusRepository.listTasksByProject(projectId); }
  getTasksByAssignee(userId: string) { return plexusRepository.listTasksByAssignee(userId); }
  getTasksByCreator(userId: string) { return plexusRepository.listTasksByCreator(userId); }
  getTasksByCreatorWithActivity(userId: string) { return plexusRepository.listTasksByCreatorWithActivity(userId); }
  getTasksByPatient(patientScreeningId: number) { return plexusRepository.listTasksByPatient(patientScreeningId); }
  getTasksByPatientScreeningId(patientScreeningId: number) { return plexusRepository.listTasksByPatient(patientScreeningId); }
  getUrgentTasks() { return plexusRepository.listUrgentTasks(); }
  getOverdueTasksForUser(userId: string) { return plexusRepository.listOverdueTasksForUser(userId); }
  updateTask(id: number, updates: Partial<InsertPlexusTask>) { return plexusRepository.updateTask(id, updates); }
  deleteTask(id: number) { return plexusRepository.deleteTask(id); }

  addCollaborator(record: InsertPlexusTaskCollaborator) { return plexusRepository.addCollaborator(record); }
  getCollaborators(taskId: number) { return plexusRepository.listCollaborators(taskId); }

  addMessage(record: InsertPlexusTaskMessage) { return plexusRepository.addMessage(record); }
  getMessages(taskId: number) { return plexusRepository.listMessages(taskId); }

  writeEvent(record: InsertPlexusTaskEvent) { return plexusRepository.writeEvent(record); }
  getEvents(taskId: number) { return plexusRepository.listEvents(taskId); }

  markRead(taskId: number, userId: string) { return plexusRepository.markRead(taskId, userId); }
  getUnreadCount(userId: string) { return plexusRepository.unreadCount(userId); }
  getUnreadPerTask(userId: string) { return plexusRepository.unreadPerTask(userId); }

  // Audit log
  createAuditLog(record: InsertAuditLog) { return auditRepository.create(record); }
  getAuditLogs(filters?: { userId?: string; entityType?: string; fromDate?: Date; toDate?: Date; limit?: number }) {
    return auditRepository.list(filters);
  }

  // Marketing materials
  getAllMarketingMaterials() { return marketingMaterialsRepository.listAll(); }
  getMarketingMaterial(id: number) { return marketingMaterialsRepository.getById(id); }
  createMarketingMaterial(record: InsertMarketingMaterial) { return marketingMaterialsRepository.create(record); }
  updateMarketingMaterialStorage(
    id: number,
    patch: { storagePath: string; sha256: string; filename: string; sizeBytes: number },
  ) {
    return marketingMaterialsRepository.updateStorage(id, patch);
  }
  deleteMarketingMaterial(id: number) { return marketingMaterialsRepository.remove(id); }

  // Document library
  createDocument(record: InsertDocument) { return documentLibraryRepository.create(record); }
  getDocument(id: number) { return documentLibraryRepository.getById(id); }
  listCurrentDocuments(filters?: { kind?: DocumentKind; surface?: DocumentSurface; patientScreeningId?: number }) {
    return documentLibraryRepository.listCurrent(filters);
  }
  getDocumentsForSurface(surface: DocumentSurface, opts?: { patientScreeningId?: number; kind?: DocumentKind }) {
    return documentLibraryRepository.listForSurface(surface, opts);
  }
  getDocumentVersionChain(currentDocId: number) { return documentLibraryRepository.versionChain(currentDocId); }
  supersedeDocument(oldId: number, newId: number) { return documentLibraryRepository.supersede(oldId, newId); }
  getDocumentAssignments(documentId: number) { return documentLibraryRepository.listAssignments(documentId); }
  addDocumentAssignment(documentId: number, surface: DocumentSurface) { return documentLibraryRepository.addAssignment(documentId, surface); }
  removeDocumentAssignment(documentId: number, surface: DocumentSurface) { return documentLibraryRepository.removeAssignment(documentId, surface); }
  replaceDocumentAssignments(documentId: number, surfaces: DocumentSurface[]) { return documentLibraryRepository.replaceAssignments(documentId, surfaces); }
  softDeleteDocument(id: number) { return documentLibraryRepository.softDelete(id); }
  deleteDocument(id: number) { return documentLibraryRepository.hardDelete(id); }
}

export const storage = new DatabaseStorage();
