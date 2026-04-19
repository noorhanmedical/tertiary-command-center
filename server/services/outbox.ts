import { db } from "../db";
import { outboxItems, type OutboxItem, type InsertOutboxItem, type OutboxKind } from "@shared/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { readBlob } from "./blobStore";
import { storage } from "../storage";

export interface EnqueueDriveFileInput {
  blobId: number;
  facility?: string | null;
  patientName?: string | null;
  ancillaryType?: string | null;
  docKind: string; // e.g. "report", "informed_consent", "screening_form", "generated_note"
  filename: string;
  isTest?: boolean;
}

export async function enqueueDriveFile(input: EnqueueDriveFileInput): Promise<OutboxItem> {
  const [row] = await db.insert(outboxItems).values({
    kind: "drive_file",
    blobId: input.blobId,
    facility: input.facility ?? null,
    patientName: input.patientName ?? null,
    ancillaryType: input.ancillaryType ?? null,
    docKind: input.docKind,
    filename: input.filename,
    status: "pending",
    isTest: input.isTest ?? false,
  } as InsertOutboxItem).returning();
  return row;
}

/**
 * Coalesce sheet-sync requests: if a pending item of this kind already exists, skip.
 */
export async function enqueueSheetSync(kind: "sheet_billing" | "sheet_patients", isTest = false): Promise<OutboxItem | null> {
  const existing = await db
    .select()
    .from(outboxItems)
    .where(and(eq(outboxItems.kind, kind), inArray(outboxItems.status, ["pending", "failed"])))
    .limit(1);
  if (existing[0]) return existing[0];
  const [row] = await db.insert(outboxItems).values({
    kind,
    status: "pending",
    isTest,
  } as InsertOutboxItem).returning();
  return row;
}

export async function listOutboxItems(filter?: { status?: string; kind?: OutboxKind; isTest?: boolean }): Promise<OutboxItem[]> {
  const where = [] as any[];
  if (filter?.status) where.push(eq(outboxItems.status, filter.status));
  if (filter?.kind) where.push(eq(outboxItems.kind, filter.kind));
  if (typeof filter?.isTest === "boolean") where.push(eq(outboxItems.isTest, filter.isTest));
  const q = db.select().from(outboxItems);
  const res = where.length ? await q.where(and(...where)).orderBy(desc(outboxItems.id)) : await q.orderBy(desc(outboxItems.id));
  return res;
}

export async function deleteOutboxItem(id: number): Promise<void> {
  await db.delete(outboxItems).where(eq(outboxItems.id, id));
}

export async function deleteTestOutboxItems(): Promise<number> {
  const result = await db.delete(outboxItems).where(eq(outboxItems.isTest, true)).returning({ id: outboxItems.id });
  return result.length;
}

async function markUploading(id: number) {
  await db.update(outboxItems).set({ status: "uploading", lastAttemptAt: new Date() }).where(eq(outboxItems.id, id));
}
async function markCompleted(id: number, resultId?: string | null, resultUrl?: string | null) {
  await db.update(outboxItems).set({
    status: "completed",
    completedAt: new Date(),
    resultId: resultId ?? null,
    resultUrl: resultUrl ?? null,
    errorText: null,
  }).where(eq(outboxItems.id, id));
}
async function markFailed(id: number, error: string) {
  await db.update(outboxItems).set({
    status: "failed",
    errorText: error.slice(0, 2000),
    attempts: sql`${outboxItems.attempts} + 1`,
  }).where(eq(outboxItems.id, id));
}

async function processDriveFile(item: OutboxItem): Promise<void> {
  if (!item.blobId) throw new Error("drive_file outbox item missing blobId");
  const data = await readBlob(item.blobId);
  if (!data) throw new Error(`Blob ${item.blobId} not found on disk`);

  const { getFileStorage, getStorageProvider } = await import("../integrations/fileStorage");
  const provider = getStorageProvider();

  let folder: string;
  if (provider === "google_drive") {
    const { ensureStructuredFacilityFolderTree, getFacilityFolderId, getOrCreateFolder, getUncachableGoogleDriveClient } =
      await import("../integrations/googleDrive");

    if (item.facility && item.patientName && item.ancillaryType) {
      const tree = await ensureStructuredFacilityFolderTree(item.facility, item.patientName, item.ancillaryType);
      const docKind = item.docKind ?? "report";
      const map: Record<string, string | undefined> = {
        report: tree.reportFolderId,
        informed_consent: tree.informedConsentFolderId,
        screening_form: tree.screeningFormFolderId,
        order_note: tree.orderNoteFolderId,
        procedure_note: tree.procedureNoteFolderId,
        billing_doc: tree.billingDocFolderId,
        generated_note: tree.orderNoteFolderId,
      };
      folder = map[docKind] || tree.reportFolderId;
    } else if (item.facility) {
      folder = await getFacilityFolderId(item.facility);
    } else {
      const drive = await getUncachableGoogleDriveClient();
      folder = await getOrCreateFolder(drive, "Plexus Ancillary Platform");
    }
  } else {
    const safePatient = (item.patientName ?? "unassigned").replace(/[^a-zA-Z0-9\s\-_.]/g, "").trim().slice(0, 80) || "unassigned";
    folder = `${item.facility ?? "general"}/${item.ancillaryType ?? "misc"}/${safePatient}/${item.docKind}`;
  }

  const fileStorage = getFileStorage();
  const result = await fileStorage.uploadFile({
    filename: item.filename ?? data.blob.filename,
    content: data.buffer,
    contentType: data.blob.contentType,
    folder,
  });

  // If owner is uploaded_document or generated_note, persist the drive metadata back.
  if (data.blob.ownerType === "generated_note") {
    await storage.updateGeneratedNoteDriveInfo(data.blob.ownerId, result.id, result.viewUrl ?? "");
  }
  // For uploaded_document we already set drive_file_id at save time if Drive was on,
  // but in outbox-first mode we now backfill it here.
  if (data.blob.ownerType === "uploaded_document") {
    const { db } = await import("../db");
    const { uploadedDocuments } = await import("@shared/schema");
    const { eq: _eq } = await import("drizzle-orm");
    await db.update(uploadedDocuments).set({
      driveFileId: result.id,
      driveWebViewLink: result.viewUrl ?? null,
    }).where(_eq(uploadedDocuments.id, data.blob.ownerId));
  }

  await markCompleted(item.id, result.id, result.viewUrl ?? null);
}

async function processSheetBilling(item: OutboxItem): Promise<void> {
  const { runBillingSyncWithLock } = await import("./syncService");
  const result = await runBillingSyncWithLock(true);
  if (!result) {
    // Another sync absorbed it; treat as completed.
    await markCompleted(item.id);
    return;
  }
  await markCompleted(item.id, result.spreadsheetId, result.spreadsheetId ? `https://docs.google.com/spreadsheets/d/${result.spreadsheetId}` : null);
}

async function processSheetPatients(item: OutboxItem): Promise<void> {
  const { runPatientsSyncWithLock } = await import("./syncService");
  const result = await runPatientsSyncWithLock(true);
  if (!result) { await markCompleted(item.id); return; }
  await markCompleted(item.id, result.spreadsheetId, result.spreadsheetId ? `https://docs.google.com/spreadsheets/d/${result.spreadsheetId}` : null);
}

export interface DrainResult {
  attempted: number;
  succeeded: number;
  failed: number;
  errors: { id: number; error: string }[];
}

export async function drainOutbox(opts?: { ids?: number[]; onlyFailed?: boolean; isTest?: boolean }): Promise<DrainResult> {
  const where = [] as any[];
  if (opts?.ids?.length) {
    where.push(inArray(outboxItems.id, opts.ids));
  } else {
    where.push(inArray(outboxItems.status, opts?.onlyFailed ? ["failed"] : ["pending", "failed"]));
  }
  if (typeof opts?.isTest === "boolean") where.push(eq(outboxItems.isTest, opts.isTest));

  const items = await db.select().from(outboxItems).where(and(...where)).orderBy(outboxItems.id);
  const result: DrainResult = { attempted: 0, succeeded: 0, failed: 0, errors: [] };

  for (const item of items) {
    result.attempted++;
    try {
      await markUploading(item.id);
      if (item.kind === "drive_file") await processDriveFile(item);
      else if (item.kind === "sheet_billing") await processSheetBilling(item);
      else if (item.kind === "sheet_patients") await processSheetPatients(item);
      else throw new Error(`Unknown outbox kind: ${item.kind}`);
      result.succeeded++;
    } catch (err: any) {
      const msg = err?.message || String(err);
      await markFailed(item.id, msg);
      result.failed++;
      result.errors.push({ id: item.id, error: msg });
    }
  }
  return result;
}

export async function getOutboxSummary() {
  const all = await db.select().from(outboxItems);
  const summary = { pending: 0, failed: 0, uploading: 0, completed: 0, total: all.length };
  for (const it of all) {
    summary[it.status as keyof typeof summary] = (summary[it.status as keyof typeof summary] || 0) + 1;
  }
  return summary;
}
