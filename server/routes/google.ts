import type { Express } from "express";
import multer from "multer";
import { storage } from "../storage";
import { VALID_FACILITIES, resolveGeneratedNoteFolderId } from "./helpers";
import {
  patientsSyncState,
  billingSyncState,
  runPatientsSyncWithLock,
  runBillingSyncWithLock,
  runExportNotesWithLock,
} from "../services/syncService";
import { getFileStorage, getStorageProvider } from "../integrations/fileStorage";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

type ValidAncillaryType = "BrainWave" | "VitalWave" | "Ultrasound";
const VALID_ANCILLARY_TYPES: readonly ValidAncillaryType[] = ["BrainWave", "VitalWave", "Ultrasound"];

function isValidFacility(f: string): f is typeof VALID_FACILITIES[number] {
  return (VALID_FACILITIES as readonly string[]).includes(f);
}

function isValidAncillaryType(a: string): a is ValidAncillaryType {
  return (VALID_ANCILLARY_TYPES as readonly string[]).includes(a);
}

async function getPlexusRootId(): Promise<string> {
  const { getUncachableGoogleDriveClient, getOrCreateFolder } = await import("../integrations/googleDrive");
  const { getSetting, setSetting } = await import("../dbSettings");
  const rootKey = "DRIVE_FOLDER_plexus_ancillary_platform";
  let rootId = await getSetting(rootKey);
  if (!rootId) {
    const drive = await getUncachableGoogleDriveClient();
    rootId = await getOrCreateFolder(drive, "Plexus Ancillary Platform");
    await setSetting(rootKey, rootId);
  }
  return rootId;
}

async function isDescendantOfRoot(
  drive: any,
  folderId: string,
  rootId: string
): Promise<boolean> {
  if (folderId === rootId) return true;
  let currentId = folderId;
  let depth = 0;
  while (currentId && depth < 15) {
    try {
      const resp = await drive.files.get({ fileId: currentId, fields: "parents" });
      const parents = resp.data.parents || [];
      if (parents.includes(rootId)) return true;
      currentId = parents[0] || "";
    } catch {
      return false;
    }
    depth++;
  }
  return false;
}

async function requireDriveConnected(res: any): Promise<boolean> {
  const { isGoogleDriveConnected } = await import("../integrations/googleDrive");
  const connected = await isGoogleDriveConnected();
  if (!connected) {
    res.status(503).json({ error: "Google Drive is not connected", connected: false });
    return false;
  }
  return true;
}

const S3_PROVIDER_UNAVAILABLE = { available: false, reason: "S3 provider active" } as const;

function requireDriveProvider(res: any): boolean {
  if (getStorageProvider() === "s3") {
    res.status(503).json(S3_PROVIDER_UNAVAILABLE);
    return false;
  }
  return true;
}

export function registerGoogleRoutes(app: Express) {
  // ─── Google Workspace Status & Sync ────────────────────────────────────────

  app.get("/api/google/status", async (_req, res) => {
    try {
      const { isGoogleSheetsConnected } = await import("../integrations/googleSheets");
      const { getDriveStatus } = await import("../integrations/googleDrive");
      const { getSetting } = await import("../dbSettings");
      const KNOWN_FACILITIES = [...VALID_FACILITIES];
      const facilitySettingKeys = KNOWN_FACILITIES.map(f => `BILLING_SPREADSHEET_ID_${f.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "")}`);
      const [sheets, driveStatus, dbPatientsAt, dbBillingAt, dbPatientsSid, dbBillingSid, driveRootFolderId, ...facilityIds] = await Promise.all([
        isGoogleSheetsConnected(),
        getDriveStatus(),
        getSetting("PATIENTS_LAST_SYNCED_AT"),
        getSetting("BILLING_LAST_SYNCED_AT"),
        getSetting("PATIENTS_SPREADSHEET_ID"),
        getSetting("BILLING_SPREADSHEET_ID"),
        getSetting("DRIVE_FOLDER_plexus_ancillary_platform"),
        ...facilitySettingKeys.map(k => getSetting(k)),
      ]);
      const patientsAt = patientsSyncState.lastSyncedAt ?? dbPatientsAt;
      const billingAt = billingSyncState.lastSyncedAt ?? dbBillingAt;
      const patientsSid = dbPatientsSid ?? process.env.GOOGLE_SHEETS_PATIENTS_ID ?? null;
      const masterSid = (await getSetting("GOOGLE_SHEETS_BILLING_ID")) || process.env.GOOGLE_SHEETS_BILLING_ID || null;
      const billingSid = masterSid || dbBillingSid || null;
      const facilitySpreadsheetUrls: Record<string, string> = {};
      KNOWN_FACILITIES.forEach((fac, i) => {
        if (facilityIds[i]) facilitySpreadsheetUrls[fac] = `https://docs.google.com/spreadsheets/d/${facilityIds[i]}`;
      });
      res.json({
        sheets: {
          connected: sheets,
          lastSyncedPatients: patientsAt,
          lastSyncedBilling: billingAt,
          patientsSpreadsheetUrl: patientsSid ? `https://docs.google.com/spreadsheets/d/${patientsSid}` : null,
          billingSpreadsheetUrl: billingSid ? `https://docs.google.com/spreadsheets/d/${billingSid}` : null,
          masterBillingSpreadsheetUrl: masterSid ? `https://docs.google.com/spreadsheets/d/${masterSid}` : null,
          billingDriveFolderUrl: driveRootFolderId ? `https://drive.google.com/drive/folders/${driveRootFolderId}` : null,
          facilityBillingSpreadsheetUrls: facilitySpreadsheetUrls,
        },
        drive: { connected: driveStatus.connected, email: driveStatus.email },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/google/sync/patients", async (_req, res) => {
    try {
      const result = await runPatientsSyncWithLock(true);
      if (!result) {
        res.json({ success: true, message: "Sync already in progress, queued" });
        return;
      }
      res.json({
        success: true,
        spreadsheetId: result.spreadsheetId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${result.spreadsheetId}`,
        syncedAt: result.syncedAt,
        patientCount: result.patientCount,
        testHistoryCount: result.testHistoryCount,
      });
    } catch (error: any) {
      console.error("Patient sync error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/google/sync/billing", async (_req, res) => {
    try {
      const result = await runBillingSyncWithLock(true);
      if (!result) {
        res.json({ success: true, message: "Sync already in progress, queued" });
        return;
      }
      const toUrl = (sid: string | null) => sid ? `https://docs.google.com/spreadsheets/d/${sid}` : null;
      const facilityUrls: Record<string, string> = {};
      for (const [fac, sid] of Object.entries(result.facilitySpreadsheetIds)) {
        facilityUrls[fac] = `https://docs.google.com/spreadsheets/d/${sid}`;
      }
      res.json({
        success: true,
        spreadsheetId: result.spreadsheetId,
        spreadsheetUrl: toUrl(result.spreadsheetId),
        masterSpreadsheetUrl: toUrl(result.masterSpreadsheetId),
        facilitySpreadsheetUrls: facilityUrls,
        syncedAt: result.syncedAt,
        recordCount: result.recordCount,
        masterSyncError: result.masterSyncError ?? null,
      });
    } catch (error: any) {
      console.error("Billing sync error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/google/drive/export-note", async (req, res) => {
    try {
      const { noteId } = req.body;
      if (!noteId || typeof noteId !== "number") {
        return res.status(400).json({ error: "noteId is required" });
      }

      const note = await storage.getGeneratedNote(noteId);
      if (!note) return res.status(404).json({ error: "Note not found" });

      const sections = (note.sections as { heading: string; body: string }[]) || [];
      const content = sections
        .filter((s) => !s.heading.startsWith("__"))
        .map((s) => `${s.heading}\n${s.body}`)
        .join("\n\n");
      const filename = `${note.patientName} - ${note.title} (${note.scheduleDate || note.generatedAt.toISOString().split("T")[0]})`;

      // Blob-first: persist locally before any external call.
      const { saveBlob } = await import("../services/blobStore");
      const { enqueueDriveFile, drainOutbox } = await import("../services/outbox");
      const blob = await saveBlob({
        ownerType: "generated_note",
        ownerId: note.id,
        filename: `${filename}.txt`,
        contentType: "text/plain",
        buffer: Buffer.from(content, "utf-8"),
        isTest: !!(note as any).isTest,
      });

      const ancillary = ["BrainWave", "VitalWave"].includes(note.service)
        ? note.service
        : "Ultrasound";
      const item = await enqueueDriveFile({
        blobId: blob.id,
        facility: note.facility ?? null,
        patientName: note.patientName,
        ancillaryType: ancillary,
        docKind: note.docKind ?? "generated_note",
        filename,
        isTest: !!(note as any).isTest,
      });

      // Synchronously drain just this item so the existing UX (returning Drive URL) is preserved.
      const drain = await drainOutbox({ ids: [item.id] });
      const updated = await storage.getGeneratedNote(noteId);
      res.json({
        success: drain.failed === 0,
        outboxId: item.id,
        driveFileId: updated?.driveFileId ?? null,
        webViewLink: updated?.driveWebViewLink ?? null,
        note: updated,
        drain,
      });
    } catch (error: any) {
      console.error("Drive export error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/google/drive/export-all", async (_req, res) => {
    try {
      if (!requireDriveProvider(res)) return;
      if (!await requireDriveConnected(res)) return;

      const result = await runExportNotesWithLock(true);
      if (!result) {
        res.json({ success: true, message: "Export already in progress, queued" });
        return;
      }
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("Drive export-all error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Facility Patient Query ─────────────────────────────────────────────────

  app.get("/api/patients-by-facility", async (req, res) => {
    try {
      const facilityParam = req.query.facility;
      const facility = typeof facilityParam === "string" ? facilityParam : "";
      if (!isValidFacility(facility)) {
        return res.status(400).json({ error: "Valid facility is required" });
      }
      const batches = await storage.getAllScreeningBatches();
      const facilityBatches = batches.filter((b) => b.facility === facility);
      const nameSet = new Set<string>();
      for (const batch of facilityBatches) {
        const patients = await storage.getPatientScreeningsByBatch(batch.id);
        for (const p of patients) {
          if (p.name && p.name.trim()) nameSet.add(p.name.trim());
        }
      }
      const sorted = Array.from(nameSet).sort();
      res.json(sorted);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Drive Report Upload ────────────────────────────────────────────────────

  app.post("/api/google/drive/upload-report", upload.single("file"), async (req, res) => {
    try {
      if (!requireDriveProvider(res)) return;
      if (!await requireDriveConnected(res)) return;

      const body = req.body as { facility?: string; patientName?: string; ancillaryType?: string };
      const { facility, patientName, ancillaryType } = body;
      if (!facility || !isValidFacility(facility)) {
        return res.status(400).json({ error: "Valid facility is required" });
      }
      if (!patientName || typeof patientName !== "string" || !patientName.trim()) {
        return res.status(400).json({ error: "patientName is required" });
      }
      if (!ancillaryType || !isValidAncillaryType(ancillaryType)) {
        return res.status(400).json({ error: "ancillaryType must be BrainWave, VitalWave, or Ultrasound" });
      }
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "PDF file is required" });
      }
      const isPdf =
        file.mimetype === "application/pdf" ||
        (file.originalname?.toLowerCase().endsWith(".pdf") ?? false);
      if (!isPdf) {
        return res.status(400).json({ error: "Only PDF files are accepted" });
      }

      const filename = file.originalname || `${patientName.trim()} - ${ancillaryType} Report.pdf`;

      // Blob-first: store local, then enqueue + drain.
      const { saveBlob } = await import("../services/blobStore");
      const { enqueueDriveFile, drainOutbox } = await import("../services/outbox");
      const blob = await saveBlob({
        ownerType: "uploaded_document",
        ownerId: 0,
        filename,
        contentType: "application/pdf",
        buffer: file.buffer,
      });
      const item = await enqueueDriveFile({
        blobId: blob.id,
        facility,
        patientName: patientName.trim(),
        ancillaryType,
        docKind: "report",
        filename,
      });
      const drain = await drainOutbox({ ids: [item.id] });

      // Re-read outbox row to get resolved Drive metadata.
      const { db } = await import("../db");
      const { outboxItems } = await import("@shared/schema");
      const { eq: _eq } = await import("drizzle-orm");
      const [updatedItem] = await db.select().from(outboxItems).where(_eq(outboxItems.id, item.id));
      res.json({
        success: drain.failed === 0,
        outboxId: item.id,
        driveFileId: updatedItem?.resultId ?? null,
        webViewLink: updatedItem?.resultUrl ?? null,
        drain,
      });
    } catch (error: any) {
      console.error("Report upload error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Document Upload ────────────────────────────────────────────────────────

  app.post("/api/documents/ocr-name", upload.single("file"), async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: "PDF file is required" });

      let extractedText = "";
      try {
        const pdfParseModule = await import("pdf-parse");
        const pdfParseFn = (pdfParseModule as any).default || pdfParseModule;
        const pdfData = await pdfParseFn(file.buffer);
        extractedText = (pdfData.text || "").slice(0, 3000);
      } catch {
        extractedText = "";
      }

      const { openai, withRetry } = await import("../services/aiClient");
      const prompt = extractedText.trim().length > 20
        ? `Extract the patient's full name from the following medical document text. Return ONLY the patient name, nothing else. If no patient name is found, return "Unknown".\n\nDocument text:\n${extractedText}`
        : `This appears to be a scanned or image-based PDF with no readable text. Return "Unknown" as the patient name.`;

      const response = await withRetry(() =>
        openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          max_tokens: 50,
        }),
        3,
        "ocr-name"
      );

      const patientName = (response.choices[0]?.message?.content || "").trim().replace(/^["']|["']$/g, "") || "Unknown";
      res.json({ patientName });
    } catch (error: any) {
      console.error("OCR name extraction error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/documents/upload", upload.single("file"), async (req, res) => {
    try {
      const body = req.body as { facility?: string; patientName?: string; ancillaryType?: string; docType?: string };
      const { facility, patientName, ancillaryType, docType } = body;
      if (!facility || !isValidFacility(facility)) {
        return res.status(400).json({ error: "Valid facility is required" });
      }
      if (!patientName || typeof patientName !== "string" || !patientName.trim()) {
        return res.status(400).json({ error: "patientName is required" });
      }
      if (!ancillaryType || !isValidAncillaryType(ancillaryType)) {
        return res.status(400).json({ error: "ancillaryType must be BrainWave, VitalWave, or Ultrasound" });
      }
      if (!docType || !["report", "informed_consent", "screening_form"].includes(docType)) {
        return res.status(400).json({ error: "docType must be 'report', 'informed_consent', or 'screening_form'" });
      }
      const file = req.file;
      if (!file) return res.status(400).json({ error: "PDF file is required" });
      const isPdf = file.mimetype === "application/pdf" || (file.originalname?.toLowerCase().endsWith(".pdf") ?? false);
      if (!isPdf) return res.status(400).json({ error: "Only PDF files are accepted" });

      const typeLabel =
        docType === "informed_consent" ? "Informed Consent" :
        docType === "screening_form" ? "Screening Form" :
        "Report";
      const filename = file.originalname || `${patientName.trim()} - ${ancillaryType} ${typeLabel}.pdf`;

      // 1) Persist DB record (no Drive yet)
      const record = await storage.saveUploadedDocument({
        facility,
        patientName: patientName.trim(),
        ancillaryType,
        docType,
        driveFileId: null,
        driveWebViewLink: null,
      });

      // 2) Save blob locally (source of truth)
      const { saveBlob } = await import("../services/blobStore");
      const { enqueueDriveFile, enqueueSheetSync, drainOutbox } = await import("../services/outbox");
      const blob = await saveBlob({
        ownerType: "uploaded_document",
        ownerId: record.id,
        filename,
        contentType: "application/pdf",
        buffer: file.buffer,
      });

      // 3) Enqueue Drive upload + drain that one item synchronously to preserve UX
      const item = await enqueueDriveFile({
        blobId: blob.id,
        facility,
        patientName: patientName.trim(),
        ancillaryType,
        docKind: docType,
        filename,
      });
      const drain = await drainOutbox({ ids: [item.id] });

      // 4) Coalesced sheet syncs go to the outbox (admin drains via "Upload All")
      await enqueueSheetSync("sheet_billing");
      await enqueueSheetSync("sheet_patients");

      const updated = await storage.getUploadedDocument(record.id) ?? record;
      res.json({
        success: drain.failed === 0,
        record: updated,
        outboxId: item.id,
        driveFileId: updated.driveFileId,
        webViewLink: updated.driveWebViewLink,
        drain,
      });
    } catch (error: any) {
      console.error("Document upload error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/documents/uploaded", async (_req, res) => {
    try {
      const records = await storage.getAllUploadedDocuments();
      res.json(records);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── File Storage View URL (provider-agnostic presigned URL refresh) ───────

  app.get("/api/file-storage/view-url", async (req, res) => {
    try {
      const fileId = req.query.fileId as string;
      if (!fileId || !fileId.trim()) {
        return res.status(400).json({ error: "fileId is required" });
      }
      const fileStorage = getFileStorage();
      const viewUrl = await fileStorage.getFileUrl(fileId.trim());
      res.json({ viewUrl });
    } catch (error: any) {
      console.error("View URL refresh error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Plexus Drive Explorer ──────────────────────────────────────────────────

  app.get("/api/plexus-drive/folder", async (req, res) => {
    try {
      if (!requireDriveProvider(res)) return;
      if (!await requireDriveConnected(res)) return;
      const { getUncachableGoogleDriveClient } = await import("../integrations/googleDrive");

      const rootId = await getPlexusRootId();
      const requestedId = req.query.folderId as string | undefined;
      const targetFolderId = requestedId || rootId;

      if (targetFolderId !== rootId) {
        const drive = await getUncachableGoogleDriveClient();
        const inScope = await isDescendantOfRoot(drive, targetFolderId, rootId);
        if (!inScope) {
          return res.status(403).json({ error: "Folder is outside the Plexus Ancillary Platform tree" });
        }
      }

      const drive = await getUncachableGoogleDriveClient();
      const escapedId = targetFolderId.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const listResp = await drive.files.list({
        q: `'${escapedId}' in parents and trashed = false`,
        fields: "files(id,name,mimeType,webViewLink,size,modifiedTime)",
        orderBy: "folder,name",
        pageSize: 200,
        spaces: "drive",
      });

      const files = (listResp.data.files || []).map((f) => ({
        id: f.id!,
        name: f.name!,
        mimeType: f.mimeType!,
        isFolder: f.mimeType === "application/vnd.google-apps.folder",
        webViewLink: f.webViewLink || null,
        size: f.size || null,
        modifiedTime: f.modifiedTime || null,
      }));

      res.json({ folderId: targetFolderId, files });
    } catch (error: any) {
      console.error("Plexus Drive folder error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/plexus-drive/search", async (req, res) => {
    try {
      if (!requireDriveProvider(res)) return;
      if (!await requireDriveConnected(res)) return;
      const query = req.query.q as string;
      if (!query || query.trim().length < 1) {
        return res.status(400).json({ error: "Search query is required" });
      }

      const { getUncachableGoogleDriveClient } = await import("../integrations/googleDrive");
      const rootId = await getPlexusRootId();
      const drive = await getUncachableGoogleDriveClient();

      const escapedQuery = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const searchResp = await drive.files.list({
        q: `name contains '${escapedQuery}' and trashed = false`,
        fields: "files(id,name,mimeType,webViewLink,parents)",
        pageSize: 200,
        spaces: "drive",
      });

      const allFiles = searchResp.data.files || [];

      const buildPath = async (fileParents: string[] | undefined): Promise<string> => {
        if (!fileParents || fileParents.length === 0) return "";
        const parts: string[] = [];
        let currentId = fileParents[0];
        let depth = 0;
        while (currentId && depth < 10) {
          if (currentId === rootId) {
            parts.unshift("Plexus Ancillary Platform");
            break;
          }
          try {
            const parentResp = await drive.files.get({ fileId: currentId, fields: "id,name,parents" });
            parts.unshift(parentResp.data.name || "");
            currentId = parentResp.data.parents?.[0] || "";
          } catch {
            break;
          }
          depth++;
        }
        return parts.join(" / ");
      };

      const results: { id: string; name: string; mimeType: string; isFolder: boolean; webViewLink: string | null; path: string }[] = [];

      for (const file of allFiles) {
        const fileParents = file.parents || [];
        const pathStr = await buildPath(fileParents);
        if (!pathStr.startsWith("Plexus Ancillary Platform")) continue;

        results.push({
          id: file.id!,
          name: file.name!,
          mimeType: file.mimeType!,
          isFolder: file.mimeType === "application/vnd.google-apps.folder",
          webViewLink: file.webViewLink || null,
          path: pathStr,
        });
      }

      res.json({ results });
    } catch (error: any) {
      console.error("Plexus Drive search error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/plexus-drive/move", async (req, res) => {
    try {
      if (!requireDriveProvider(res)) return;
      if (!await requireDriveConnected(res)) return;
      const { fileId, destinationFolderId } = req.body;
      if (!fileId || !destinationFolderId) {
        return res.status(400).json({ error: "fileId and destinationFolderId are required" });
      }

      const { getUncachableGoogleDriveClient } = await import("../integrations/googleDrive");
      const rootId = await getPlexusRootId();
      const drive = await getUncachableGoogleDriveClient();

      const [fileInScope, destInScope] = await Promise.all([
        isDescendantOfRoot(drive, fileId, rootId),
        isDescendantOfRoot(drive, destinationFolderId, rootId),
      ]);

      if (!fileInScope) {
        return res.status(403).json({ error: "Source file is outside the Plexus Ancillary Platform tree" });
      }
      if (!destInScope) {
        return res.status(403).json({ error: "Destination folder is outside the Plexus Ancillary Platform tree" });
      }

      const fileResp = await drive.files.get({ fileId, fields: "parents" });
      const currentParents = (fileResp.data.parents || []).join(",");

      await drive.files.update({
        fileId,
        addParents: destinationFolderId,
        removeParents: currentParents,
        fields: "id,parents",
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Plexus Drive move error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/plexus-drive/folder-tree", async (req, res) => {
    try {
      if (!requireDriveProvider(res)) return;
      if (!await requireDriveConnected(res)) return;
      const { getUncachableGoogleDriveClient } = await import("../integrations/googleDrive");
      const rootId = await getPlexusRootId();
      const drive = await getUncachableGoogleDriveClient();

      const buildTree = async (folderId: string, depth: number): Promise<any[]> => {
        if (depth > 4) return [];
        const listResp = await drive.files.list({
          q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: "files(id,name)",
          orderBy: "name",
          pageSize: 100,
          spaces: "drive",
        });
        const folders = listResp.data.files || [];
        const result = [];
        for (const folder of folders) {
          const children = await buildTree(folder.id!, depth + 1);
          result.push({ id: folder.id!, name: folder.name!, children });
        }
        return result;
      };

      const children = await buildTree(rootId, 0);
      res.json({ id: rootId, name: "Plexus Ancillary Platform", children });
    } catch (error: any) {
      console.error("Plexus Drive folder-tree error:", error);
      res.status(500).json({ error: error.message });
    }
  });
}
