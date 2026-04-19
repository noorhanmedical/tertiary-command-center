import { storage } from "../storage";
import { resolveGeneratedNoteFolderId } from "../routes/helpers";

export interface PatientsSyncResult {
  spreadsheetId: string;
  patientCount: number;
  testHistoryCount: number;
  syncedAt: string;
}

export interface BillingSyncResult {
  spreadsheetId: string;
  masterSpreadsheetId: string | null;
  facilitySpreadsheetIds: Record<string, string>;
  recordCount: number;
  syncedAt: string;
  masterSyncError: string | null;
}

export interface ExportNotesResult {
  exported: number;
  failed: number;
  remaining: number;
  results: { noteId: number; driveFileId: string; webViewLink: string }[];
  errors: { noteId: number; error: string }[];
}

export const patientsSyncState = { lastSyncedAt: null as string | null };
export const billingSyncState = { lastSyncedAt: null as string | null };

const patientsSyncLock = { running: false, pending: false };
const billingSyncLock = { running: false, pending: false };
const exportNotesLock = { running: false, pending: false };

export async function executeSyncPatients(): Promise<PatientsSyncResult> {
  const { getOrCreateSpreadsheet, upsertSheetData } = await import("../googleSheets");
  const { setSetting } = await import("../dbSettings");
  const spreadsheetId = await getOrCreateSpreadsheet("GOOGLE_SHEETS_PATIENTS_ID", "Plexus Patient Directory");
  const [references, testHistory] = await Promise.all([
    storage.getAllPatientReferences(),
    storage.getAllTestHistory(),
  ]);
  await upsertSheetData(
    spreadsheetId, "Patient Directory",
    ["ID", "Patient Name", "Age", "Gender", "Insurance", "Diagnoses", "History", "Medications", "Notes", "Created At"],
    references.map((r) => [r.id, r.patientName, r.age ?? "", r.gender ?? "", r.insurance ?? "", r.diagnoses ?? "", r.history ?? "", r.medications ?? "", r.notes ?? "", r.createdAt.toISOString()])
  );
  await upsertSheetData(
    spreadsheetId, "Test History",
    ["ID", "Patient Name", "DOB", "Test Name", "Date of Service", "Insurance Type", "Clinic", "Notes", "Created At"],
    testHistory.map((t) => [t.id, t.patientName, t.dob ?? "", t.testName, t.dateOfService, t.insuranceType, t.clinic, t.notes ?? "", t.createdAt.toISOString()])
  );
  const syncedAt = new Date().toISOString();
  patientsSyncState.lastSyncedAt = syncedAt;
  await setSetting("PATIENTS_LAST_SYNCED_AT", syncedAt);
  await setSetting("PATIENTS_SPREADSHEET_ID", spreadsheetId);
  return { spreadsheetId, patientCount: references.length, testHistoryCount: testHistory.length, syncedAt };
}

export async function runPatientsSyncWithLock(throwOnError: boolean): Promise<PatientsSyncResult | null> {
  if (patientsSyncLock.running) {
    patientsSyncLock.pending = true;
    return null;
  }
  patientsSyncLock.running = true;
  try {
    return await executeSyncPatients();
  } catch (err) {
    if (throwOnError) throw err;
    console.warn("Background patient sync skipped:", (err as Error).message);
    return null;
  } finally {
    patientsSyncLock.running = false;
    if (patientsSyncLock.pending) {
      patientsSyncLock.pending = false;
      void runPatientsSyncWithLock(false);
    }
  }
}

export function backgroundSyncPatients(): void {
  void runPatientsSyncWithLock(false);
}

export async function executeSyncBilling(): Promise<BillingSyncResult> {
  const { getOrCreateSpreadsheetInFolder, upsertSheetData } = await import("../googleSheets");
  const { getFacilityFolderId } = await import("../googleDrive");
  const { getSetting, setSetting } = await import("../dbSettings");
  const records = await storage.getAllBillingRecords();

  const BILLING_HEADERS = ["Date of Service", "Patient Name", "Facility", "Rendering Provider", "Service Type", "Primary Insurance", "Documentation Status", "Claim Status", "Payer Status", "Date Submitted", "Days in A/R", "Follow-Up Date", "Payment Status", "Paid Amount", "Total Charges", "Allowed Amount", "Patient Responsibility", "Adjustment Amount", "Balance Remaining"];

  function toRow(r: typeof records[0]): (string | number)[] {
    const daysInAR = (() => {
      if (!r.dateSubmitted) return "";
      const start = new Date(r.dateSubmitted);
      if (isNaN(start.getTime())) return "";
      return Math.max(0, Math.round((Date.now() - start.getTime()) / 86400000)).toString();
    })();
    return [
      r.dateOfService ?? "", r.patientName, r.facility ?? "", r.clinician ?? "",
      r.service, r.insuranceInfo ?? "", r.documentationStatus ?? "", r.billingStatus ?? "",
      r.response ?? "", r.dateSubmitted ?? "", daysInAR, r.followUpDate ?? "",
      r.paidStatus ?? "", r.paidAmount ?? "", r.totalCharges ?? "", r.allowedAmount ?? "",
      r.patientResponsibility ?? "", r.adjustmentAmount ?? "", r.balanceRemaining ?? ""
    ];
  }

  const facilityGroups = new Map<string, typeof records>();
  for (const r of records) {
    const fac = r.facility || "Unknown Facility";
    if (!facilityGroups.has(fac)) facilityGroups.set(fac, []);
    facilityGroups.get(fac)!.push(r);
  }

  let totalSynced = 0;
  let lastSpreadsheetId = "";
  const facilitySpreadsheetIds: Record<string, string> = {};

  for (const [facility, facRecords] of Array.from(facilityGroups.entries())) {
    let folderId: string | null = null;
    try {
      folderId = await getFacilityFolderId(facility);
    } catch (e) {
      console.warn(`Could not get Drive folder for facility ${facility}, skipping folder placement:`, (e as Error).message);
    }

    const billingSettingKey = `GOOGLE_SHEETS_BILLING_ID_${facility.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "")}`;
    let spreadsheetId: string;
    if (folderId) {
      spreadsheetId = await getOrCreateSpreadsheetInFolder(
        billingSettingKey,
        `Plexus Billing Tracker — ${facility}`,
        folderId
      );
    } else {
      const { getOrCreateSpreadsheet } = await import("../googleSheets");
      spreadsheetId = await getOrCreateSpreadsheet(billingSettingKey, `Plexus Billing Tracker — ${facility}`);
    }

    await upsertSheetData(spreadsheetId, "Billing Records", BILLING_HEADERS, facRecords.map(toRow));

    totalSynced += facRecords.length;
    lastSpreadsheetId = spreadsheetId;
    facilitySpreadsheetIds[facility] = spreadsheetId;
    await setSetting(`BILLING_SPREADSHEET_ID_${facility.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "")}`, spreadsheetId);
  }

  const masterSid = (await getSetting("GOOGLE_SHEETS_BILLING_ID")) || process.env.GOOGLE_SHEETS_BILLING_ID || null;
  let masterSyncError: string | null = null;
  if (masterSid) {
    try {
      await upsertSheetData(masterSid, "Billing Records", BILLING_HEADERS, records.map(toRow));
      await setSetting("GOOGLE_SHEETS_BILLING_ID", masterSid);
    } catch (e) {
      masterSyncError = (e as Error).message;
      console.error("Master billing tracker sync failed:", masterSyncError);
    }
  }

  const syncedAt = new Date().toISOString();
  billingSyncState.lastSyncedAt = syncedAt;
  await setSetting("BILLING_LAST_SYNCED_AT", syncedAt);
  const primaryId = masterSid || lastSpreadsheetId || "";
  if (primaryId) {
    await setSetting("BILLING_SPREADSHEET_ID", primaryId);
  }
  return { spreadsheetId: primaryId, masterSpreadsheetId: masterSid, facilitySpreadsheetIds, recordCount: totalSynced, syncedAt, masterSyncError };
}

export async function runBillingSyncWithLock(throwOnError: boolean): Promise<BillingSyncResult | null> {
  if (billingSyncLock.running) {
    billingSyncLock.pending = true;
    return null;
  }
  billingSyncLock.running = true;
  try {
    return await executeSyncBilling();
  } catch (err) {
    if (throwOnError) throw err;
    console.warn("Background billing sync skipped:", (err as Error).message);
    return null;
  } finally {
    billingSyncLock.running = false;
    if (billingSyncLock.pending) {
      billingSyncLock.pending = false;
      void runBillingSyncWithLock(false);
    }
  }
}

export function backgroundSyncBilling(): void {
  void runBillingSyncWithLock(false);
}

export async function executeExportNotes(): Promise<ExportNotesResult> {
  const { getFileStorage, getStorageProvider } = await import("../integrations/fileStorage");
  const provider = getStorageProvider();
  const fileStorage = getFileStorage();
  const BATCH_LIMIT = 50;
  const allNotes = await storage.getAllGeneratedNotes();
  const unsynced = allNotes.filter((n) => !n.driveFileId).slice(0, BATCH_LIMIT);
  const DRIVE_ANCILLARY_TYPES_ALL: readonly string[] = ["BrainWave", "VitalWave", "Ultrasound"];
  const results: { noteId: number; driveFileId: string; webViewLink: string }[] = [];
  const errors: { noteId: number; error: string }[] = [];

  for (const note of unsynced) {
    try {
      const sections = (note.sections as { heading: string; body: string }[]) || [];
      const content = sections
        .filter((s) => !s.heading.startsWith("__"))
        .map((s) => `${s.heading}\n${s.body}`)
        .join("\n\n");
      const filename = `${note.patientName} - ${note.title} (${note.scheduleDate || note.generatedAt.toISOString().split("T")[0]})`;

      let folder: string | undefined;
      if (provider === "google_drive") {
        const { ensureStructuredFacilityFolderTree } = await import("../googleDrive");
        if (note.facility && note.patientName && note.service && DRIVE_ANCILLARY_TYPES_ALL.includes(note.service)) {
          const tree = await ensureStructuredFacilityFolderTree(note.facility, note.patientName, note.service);
          folder = resolveGeneratedNoteFolderId(tree, note);
        }
      } else {
        const docKind = (note.docKind || "").trim();
        const category =
          docKind === "screening" ? "screening-forms" :
          docKind === "billing" ? "billing-docs" :
          docKind === "postProcedureNote" ? "procedure-notes" :
          docKind === "preProcedureOrder" ? "order-notes" :
          "clinical-docs";
        folder = `${note.facility || "unknown"}/${note.service || "unknown"}/${category}`;
      }

      console.log("[fileStorage export-note debug]", {
        noteId: note.id,
        title: note.title,
        docKind: note.docKind,
        facility: note.facility,
        service: note.service,
        folder,
        provider,
      });

      const { id: driveFileId, viewUrl: webViewLink } = await fileStorage.uploadFile({
        filename,
        content,
        contentType: "text/plain",
        folder,
      });
      await storage.updateGeneratedNoteDriveInfo(note.id, driveFileId, webViewLink);
      results.push({ noteId: note.id, driveFileId, webViewLink });
    } catch (e: any) {
      errors.push({ noteId: note.id, error: e.message });
    }
  }

  const totalUnsynced = allNotes.filter((n) => !n.driveFileId).length;
  const remaining = Math.max(0, totalUnsynced - results.length - errors.length);
  return { exported: results.length, failed: errors.length, remaining, results, errors };
}

export async function runExportNotesWithLock(throwOnError: boolean): Promise<ExportNotesResult | null> {
  if (exportNotesLock.running) {
    exportNotesLock.pending = true;
    return null;
  }
  exportNotesLock.running = true;
  try {
    return await executeExportNotes();
  } catch (err) {
    if (throwOnError) throw err;
    console.warn("Background notes export skipped:", (err as Error).message);
    return null;
  } finally {
    exportNotesLock.running = false;
    if (exportNotesLock.pending) {
      exportNotesLock.pending = false;
      void runExportNotesWithLock(false);
    }
  }
}

export function backgroundExportNotes(): void {
  void runExportNotesWithLock(false);
}
