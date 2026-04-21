import { storage } from "../storage";
import { resolveGeneratedNoteFolderId } from "../routes/helpers";
import { withAdvisoryLock } from "../lib/advisoryLock";

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

const PATIENTS_SYNC_LOCK = "plexus.sync.patients";
const BILLING_SYNC_LOCK = "plexus.sync.billing";
const EXPORT_NOTES_LOCK = "plexus.sync.notes_export";

export async function executeSyncPatients(): Promise<PatientsSyncResult> {
  const { getOrCreateSpreadsheet, upsertSheetData } = await import("../integrations/googleSheets");
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
  try {
    const { acquired, result } = await withAdvisoryLock(PATIENTS_SYNC_LOCK, executeSyncPatients);
    if (!acquired) {
      console.log("[sync] patients sync already running on another instance — skipping");
      return null;
    }
    return result;
  } catch (err) {
    if (throwOnError) throw err;
    console.warn("Background patient sync skipped:", (err as Error).message);
    return null;
  }
}

export function backgroundSyncPatients(): void {
  void runPatientsSyncWithLock(false);
}

export async function executeSyncBilling(): Promise<BillingSyncResult> {
  const { getOrCreateSpreadsheet, upsertSheetData } = await import("../integrations/googleSheets");
  const { getSetting, setSetting } = await import("../dbSettings");
  const records = await storage.getAllBillingRecords();
  const allNotes = await storage.getAllGeneratedNotes();

  // Build a lookup: patientId+service → set of docKinds
  const noteKindsByPatientService = new Map<string, Set<string>>();
  for (const n of allNotes) {
    const key = `${n.patientId}|${n.service}`;
    if (!noteKindsByPatientService.has(key)) noteKindsByPatientService.set(key, new Set());
    noteKindsByPatientService.get(key)!.add(n.docKind);
  }

  function docCheck(r: typeof records[0], docKind: string): string {
    if (r.patientId === null) return "";
    const kinds = noteKindsByPatientService.get(`${r.patientId}|${r.service}`);
    return kinds?.has(docKind) ? "✓" : "";
  }

  // Exact 20-column layout matching client's "Plexus Billing Tracker"
  const BILLING_HEADERS = [
    "DOS", "Test", "Patient", "DOB", "MRN", "Clinician", "Insurance Info",
    "Screening", "Order Note", "Report", "Procedure Note", "Billing Doc",
    "Primary Paid Amount", "Insurance Paid Amount", "Secondary Paid Amount",
    "Patient Responsibility Amount", "Claim Status", "Last Biller Update",
    "Next Action", "Billing Notes",
  ];

  function toRow(r: typeof records[0]): (string | number)[] {
    return [
      r.dateOfService ?? "",
      r.service,
      r.patientName,
      r.dob ?? "",
      r.mrn ?? "",
      r.clinician ?? "",
      r.insuranceInfo ?? "",
      docCheck(r, "screening"),
      docCheck(r, "preProcedureOrder"),
      docCheck(r, "report"),
      docCheck(r, "postProcedureNote"),
      docCheck(r, "billing"),
      r.paidAmount ?? "",
      r.insurancePaidAmount ?? "",
      r.secondaryPaidAmount ?? "",
      r.patientResponsibility ?? "",
      r.billingStatus ?? "",
      r.lastBillerUpdate ?? "",
      r.nextAction ?? "",
      r.billingNotes ?? "",
    ];
  }

  // Single consolidated sheet for all facilities
  const masterSid = (await getSetting("GOOGLE_SHEETS_BILLING_ID")) ||
    (await getSetting("BILLING_SPREADSHEET_ID")) ||
    process.env.GOOGLE_SHEETS_BILLING_ID || null;

  let spreadsheetId: string;
  let masterSyncError: string | null = null;

  if (masterSid) {
    spreadsheetId = masterSid;
    try {
      await upsertSheetData(spreadsheetId, "Billing Records", BILLING_HEADERS, records.map(toRow));
      await setSetting("GOOGLE_SHEETS_BILLING_ID", spreadsheetId);
      await setSetting("BILLING_SPREADSHEET_ID", spreadsheetId);
    } catch (e) {
      masterSyncError = (e as Error).message;
      console.error("Billing tracker sync failed:", masterSyncError);
    }
  } else {
    // Create a new single "Plexus Billing Tracker" sheet
    spreadsheetId = await getOrCreateSpreadsheet("BILLING_SPREADSHEET_ID", "Plexus Billing Tracker");
    try {
      await upsertSheetData(spreadsheetId, "Billing Records", BILLING_HEADERS, records.map(toRow));
      await setSetting("GOOGLE_SHEETS_BILLING_ID", spreadsheetId);
      await setSetting("BILLING_SPREADSHEET_ID", spreadsheetId);
    } catch (e) {
      masterSyncError = (e as Error).message;
      console.error("Billing tracker sync failed:", masterSyncError);
    }
  }

  const syncedAt = new Date().toISOString();
  billingSyncState.lastSyncedAt = syncedAt;
  await setSetting("BILLING_LAST_SYNCED_AT", syncedAt);

  return {
    spreadsheetId,
    masterSpreadsheetId: spreadsheetId,
    facilitySpreadsheetIds: {},
    recordCount: records.length,
    syncedAt,
    masterSyncError,
  };
}

export async function runBillingSyncWithLock(throwOnError: boolean): Promise<BillingSyncResult | null> {
  try {
    const { acquired, result } = await withAdvisoryLock(BILLING_SYNC_LOCK, executeSyncBilling);
    if (!acquired) {
      console.log("[sync] billing sync already running on another instance — skipping");
      return null;
    }
    return result;
  } catch (err) {
    if (throwOnError) throw err;
    console.warn("Background billing sync skipped:", (err as Error).message);
    return null;
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
        const { ensureStructuredFacilityFolderTree } = await import("../integrations/googleDrive");
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
        const safePatient = (note.patientName || "unknown").replace(/[^a-zA-Z0-9\s\-_.]/g, "").trim().slice(0, 80);
        folder = `${note.facility || "unknown"}/${note.service || "unknown"}/${safePatient}/${category}`;
      }

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
  try {
    const { acquired, result } = await withAdvisoryLock(EXPORT_NOTES_LOCK, executeExportNotes);
    if (!acquired) {
      console.log("[sync] notes export already running on another instance — skipping");
      return null;
    }
    return result;
  } catch (err) {
    if (throwOnError) throw err;
    console.warn("Background notes export skipped:", (err as Error).message);
    return null;
  }
}

export function backgroundExportNotes(): void {
  void runExportNotesWithLock(false);
}
