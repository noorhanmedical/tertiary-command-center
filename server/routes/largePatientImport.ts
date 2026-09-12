// Large-file patient import routes.
//
// Streams the upload to a temp file on DISK (never into RAM), records a durable
// import_jobs row, and returns immediately with a job id. Parsing/validation
// and the chunked import run in the background; the client polls status.
//
// Coexists with the existing quick-import (interactive paste / small upload) —
// both converge on the SAME normalization (shared/patientImportRow) and the
// SAME canonical target (patient_screenings), so patient semantics never fork.

import type { Express, Request, Response } from "express";
import multer from "multer";
import os from "node:os";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  createImportJob,
  getImportJob,
  updateImportJob,
  findImportJobByIdempotencyKey,
  listRecentImportJobs,
  upsertImportRowDecision,
  loadImportRowDecisions,
} from "../repositories/importJobs.repo";
import { db } from "../db";
import { patientScreenings, IMPORT_ROW_DECISIONS, type ImportRowDecision } from "@shared/schema";
import { inArray } from "drizzle-orm";
import { detectFormat, parseLargeFile } from "../services/largeImport/streamingParsers";
import {
  runAnalysis,
  runImport,
  cleanupTempFile,
} from "../services/largeImport/importJobRunner";
import { classifyRows } from "../services/largeImport/dedupClassifier";
import { loadExistingIdentityIndex } from "../services/largeImport/existingIdentityIndex";
import type { ImportFileFormat } from "@shared/schema";

// ─── Upload ceiling ──────────────────────────────────────────────────────────
// Rationale: the requirement is 128 MB. We set 250 MB to give headroom for
// legitimately large EHR exports that carry embedded media/formatting (the
// useful patient rows are far smaller). This is SAFE to raise past the old
// 50 MB memory cap because the file is streamed to disk, never buffered in
// application RAM, and the parser reads it incrementally. The ceiling bounds
// processing time and zip-bomb blast radius; combined with the parser's row
// cap it prevents an adversarial file from exhausting resources.
const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;

const ALLOWED_EXTS = new Set(["csv", "tsv", "tab", "xlsx", "xls", "xlsm"]);
const IMPORT_TMP_DIR = path.join(os.tmpdir(), "plexus-imports");

function ensureTmpDir() {
  try { fs.mkdirSync(IMPORT_TMP_DIR, { recursive: true }); } catch { /* exists */ }
}

// Disk storage — stream straight to a temp file. No memoryStorage.
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { ensureTmpDir(); cb(null, IMPORT_TMP_DIR); },
    filename: (_req, file, cb) => {
      const ext = (file.originalname.toLowerCase().split(".").pop() ?? "dat").replace(/[^a-z0-9]/g, "");
      cb(null, `${Date.now()}-${randomUUID()}.${ext}`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname.toLowerCase().split(".").pop() ?? "").trim();
    if (ALLOWED_EXTS.has(ext)) return cb(null, true);
    cb(new Error(`Unsupported file type ".${ext}". Bulk import accepts CSV, TSV, or XLSX.`));
  },
});

const RETENTION_MS = 24 * 60 * 60 * 1000; // keep temp artifact + job 24h for retry

async function safeUnlink(p?: string | null) {
  if (!p) return;
  try { await fsp.unlink(p); } catch { /* gone */ }
}

export function registerLargePatientImportRoutes(app: Express) {
  // ── POST upload — stream to disk, create job, kick off analysis ──────────
  app.post(
    "/api/patient-import/large",
    (req: Request, res: Response, next) => {
      upload.single("file")(req, res, (err: unknown) => {
        if (err) {
          const msg = (err as Error)?.message ?? "Upload failed";
          const tooLarge = /file too large/i.test(msg) || (err as { code?: string })?.code === "LIMIT_FILE_SIZE";
          return res.status(tooLarge ? 413 : 400).json({
            error: tooLarge
              ? `File exceeds the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit.`
              : msg,
          });
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) return res.status(400).json({ error: "No file uploaded (field name must be 'file')." });

      try {
        const clinicId = (req as Request & { clinicId?: number | null }).clinicId ?? null;
        const userId = req.session?.userId ?? null;
        const facility = typeof req.body?.facility === "string" && req.body.facility.trim()
          ? req.body.facility.trim() : null;
        const idempotencyKey = typeof req.body?.idempotencyKey === "string" && req.body.idempotencyKey.trim()
          ? req.body.idempotencyKey.trim() : null;
        const isTest = req.body?.isTest === "true" || req.body?.isTest === true;

        // Idempotent re-submit: return the existing job instead of a duplicate.
        if (idempotencyKey) {
          const existing = await findImportJobByIdempotencyKey(clinicId, idempotencyKey);
          if (existing) {
            await safeUnlink(file.path); // discard the redundant upload
            return res.status(200).json({ jobId: existing.id, status: existing.status, reused: true });
          }
        }

        const format = detectFormat(file.originalname, file.mimetype);
        const job = await createImportJob({
          clinicId: clinicId ?? undefined,
          createdByUserId: userId ?? undefined,
          status: "uploaded",
          kind: "large_file",
          idempotencyKey: idempotencyKey ?? undefined,
          originalFilename: file.originalname,
          mimeType: file.mimetype,
          byteSize: String(file.size) as never,
          fileFormat: format,
          tempPath: file.path,
          facility: facility ?? undefined,
          facilitySource: facility ? "import_selection" : undefined,
          expiresAt: new Date(Date.now() + RETENTION_MS) as never,
          isTest,
        } as never);

        // Background analysis; return immediately.
        void runAnalysis(job.id).catch((e) => console.error("[largeImport] analysis error:", e));

        return res.status(202).json({ jobId: job.id, status: "uploaded", format });
      } catch (error) {
        await safeUnlink(file.path);
        return res.status(500).json({ error: (error as Error)?.message ?? "Failed to start import" });
      }
    },
  );

  // ── GET status ──────────────────────────────────────────────────────────
  app.get("/api/patient-import/large/:id", async (req: Request, res: Response) => {
    const job = await getImportJob(parseInt(String(req.params.id), 10));
    if (!job) return res.status(404).json({ error: "Import job not found" });
    if (!assertScope(req, res, job)) return;
    return res.json(shapeJob(job));
  });

  // ── GET paginated preview ────────────────────────────────────────────────
  app.get("/api/patient-import/large/:id/preview", async (req: Request, res: Response) => {
    const job = await getImportJob(parseInt(String(req.params.id), 10));
    if (!job) return res.status(404).json({ error: "Import job not found" });
    if (!assertScope(req, res, job)) return;

    const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));

    // First page (<=50) is served from the stored preview (no re-parse).
    const stored = Array.isArray(job.preview) ? (job.preview as unknown[]) : [];
    if (offset + limit <= stored.length) {
      return res.json({ rows: stored.slice(offset, offset + limit), offset, limit, total: job.totalRows });
    }

    // Deeper pages: re-parse the staged file (deterministic, bounded) and slice.
    if (!job.tempPath) {
      return res.json({ rows: stored.slice(offset, offset + limit), offset, limit, total: job.totalRows, note: "artifact_expired" });
    }
    try {
      const parse = await parseLargeFile(job.tempPath, (job.fileFormat ?? "unknown") as ImportFileFormat, {
        defaultFacility: job.facility ?? null,
      });
      const idx = await loadExistingIdentityIndex(job.clinicId ?? null);
      const classified = classifyRows(parse.rows, idx);
      const page = classified.slice(offset, offset + limit).map((cr) => ({
        rowIndex: cr.row.rowIndex, name: cr.row.name, dob: cr.row.dob, phone: cr.row.phone,
        mrn: cr.row.mrn, facility: cr.row.facility, insurance: cr.row.insurance,
        classification: cr.classification, matchTier: cr.matchTier, reasons: cr.reasons,
      }));
      return res.json({ rows: page, offset, limit, total: classified.length });
    } catch (e) {
      return res.status(500).json({ error: (e as Error)?.message ?? "Preview failed" });
    }
  });

  // ── POST confirm — start (or resume) the chunked import ──────────────────
  app.post("/api/patient-import/large/:id/confirm", async (req: Request, res: Response) => {
    const job = await getImportJob(parseInt(String(req.params.id), 10));
    if (!job) return res.status(404).json({ error: "Import job not found" });
    if (!assertScope(req, res, job)) return;

    const canRun = ["preview_ready", "failed", "importing"].includes(job.status);
    if (!canRun) {
      return res.status(409).json({ error: `Import cannot start from status "${job.status}".` });
    }
    if (job.status === "completed") {
      return res.status(200).json({ jobId: job.id, status: "completed" });
    }

    // POSSIBLE_MATCH rows are governed entirely by persisted per-row decisions
    // (import_as_new writes; use_existing/skip/unresolved never write). No
    // "include all possible" flag exists — unresolved possible matches are
    // never auto-imported.
    void runImport(job.id).catch((e) => console.error("[largeImport] import error:", e));
    return res.status(202).json({ jobId: job.id, status: "importing" });
  });

  // ── GET possible-matches — side-by-side incoming vs existing patient ─────
  app.get("/api/patient-import/large/:id/possible-matches", async (req: Request, res: Response) => {
    const job = await getImportJob(parseInt(String(req.params.id), 10));
    if (!job) return res.status(404).json({ error: "Import job not found" });
    if (!assertScope(req, res, job)) return;
    if (!job.tempPath) return res.status(410).json({ error: "Upload artifact expired; re-upload to review." });

    const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));

    try {
      const parse = await parseLargeFile(job.tempPath, (job.fileFormat ?? "unknown") as ImportFileFormat, {
        defaultFacility: job.facility ?? null,
      });
      const idx = await loadExistingIdentityIndex(job.clinicId ?? null);
      const classified = classifyRows(parse.rows, idx);
      const possible = classified.filter((c) => c.classification === "POSSIBLE_MATCH");
      const decisions = await loadImportRowDecisions(job.id);

      // Batch-fetch the candidate existing patients for this page.
      const page = possible.slice(offset, offset + limit);
      const existingIds = page.map((p) => p.matchedScreeningId).filter((v): v is number => v != null);
      const existingById = new Map<number, Record<string, unknown>>();
      if (existingIds.length > 0) {
        const rows = await db
          .select({
            id: patientScreenings.id, name: patientScreenings.name, dob: patientScreenings.dob,
            phone: patientScreenings.phoneNumber, mrn: patientScreenings.mrn, facility: patientScreenings.facility,
          })
          .from(patientScreenings)
          .where(inArray(patientScreenings.id, existingIds));
        for (const r of rows) existingById.set(r.id, r);
      }

      const items = page.map((cr) => {
        const existing = cr.matchedScreeningId != null ? existingById.get(cr.matchedScreeningId) ?? null : null;
        const decision = decisions.get(cr.row.rowIndex) ?? null;
        return {
          rowIndex: cr.row.rowIndex,
          incoming: {
            name: cr.row.name, dob: cr.row.dob, phone: cr.row.phone,
            mrn: cr.row.mrn, facility: cr.row.facility, insurance: cr.row.insurance,
          },
          existingPatient: existing
            ? { screeningId: existing.id, name: existing.name, dob: existing.dob, phone: existing.phone, mrn: existing.mrn, facility: existing.facility }
            : null,
          matchReason: describeMatch(cr.matchTier, cr.reasons),
          decision: decision ? { decision: decision.decision, matchedScreeningId: decision.matchedScreeningId, resolvedAt: decision.resolvedAt } : null,
        };
      });

      return res.json({ total: possible.length, offset, limit, items });
    } catch (e) {
      return res.status(500).json({ error: (e as Error)?.message ?? "Failed to load possible matches" });
    }
  });

  // ── POST resolve one possible-match row ──────────────────────────────────
  app.post("/api/patient-import/large/:id/possible-matches/:rowIndex/resolve", async (req: Request, res: Response) => {
    const job = await getImportJob(parseInt(String(req.params.id), 10));
    if (!job) return res.status(404).json({ error: "Import job not found" });
    if (!assertScope(req, res, job)) return;

    const rowIndex = parseInt(String(req.params.rowIndex), 10);
    if (!Number.isFinite(rowIndex)) return res.status(400).json({ error: "Invalid rowIndex" });
    const decision = String(req.body?.decision ?? "") as ImportRowDecision;
    if (!IMPORT_ROW_DECISIONS.includes(decision)) {
      return res.status(400).json({ error: `decision must be one of ${IMPORT_ROW_DECISIONS.join(", ")}` });
    }
    const matchedScreeningId =
      decision === "use_existing" && Number.isFinite(Number(req.body?.matchedScreeningId))
        ? Number(req.body.matchedScreeningId) : null;
    if (decision === "use_existing" && matchedScreeningId == null) {
      return res.status(400).json({ error: "matchedScreeningId is required for use_existing" });
    }

    const saved = await upsertImportRowDecision({
      importJobId: job.id,
      rowIndex,
      decision,
      matchedScreeningId,
      resolvedByUserId: req.session?.userId ?? null,
    });
    return res.json({ jobId: job.id, rowIndex, decision: saved.decision, matchedScreeningId: saved.matchedScreeningId });
  });

  // ── POST cancel — terminal + cleanup ─────────────────────────────────────
  app.post("/api/patient-import/large/:id/cancel", async (req: Request, res: Response) => {
    const job = await getImportJob(parseInt(String(req.params.id), 10));
    if (!job) return res.status(404).json({ error: "Import job not found" });
    if (!assertScope(req, res, job)) return;
    await updateImportJob(job.id, { status: "cancelled" });
    await cleanupTempFile(job.id);
    return res.json({ jobId: job.id, status: "cancelled" });
  });

  // ── GET recent jobs (for a jobs list UI) ─────────────────────────────────
  app.get("/api/patient-import/large", async (req: Request, res: Response) => {
    const clinicId = (req as Request & { clinicId?: number | null }).clinicId ?? null;
    const jobs = await listRecentImportJobs(clinicId, 50);
    return res.json({ jobs: jobs.map(shapeJob) });
  });
}

// Human-readable, non-leaky match reason for the review UI.
function describeMatch(matchTier: string | null, reasons: string[]): string {
  if (reasons.includes("duplicate_within_file")) return "Duplicate of another row in this file";
  switch (matchTier) {
    case "name_dob_phone": return "Same name, DOB, and phone as an existing patient";
    case "mrn_dob": return "Same MRN and DOB as an existing patient";
    case "facility_mrn_dob": return "Same facility, MRN, and DOB as an existing patient";
    default: return "Possible match to an existing patient";
  }
}

// Non-admin requests are scoped to their own clinic. Admin (clinicId null) sees all.
function assertScope(req: Request, res: Response, job: { clinicId: number | null }): boolean {
  const clinicId = (req as Request & { clinicId?: number | null }).clinicId ?? null;
  if (clinicId == null) return true; // admin
  if (job.clinicId !== clinicId) {
    res.status(403).json({ error: "Not authorized for this import job's clinic." });
    return false;
  }
  return true;
}

function shapeJob(job: Record<string, unknown>) {
  return {
    jobId: job.id,
    status: job.status,
    fileFormat: job.fileFormat,
    originalFilename: job.originalFilename,
    byteSize: job.byteSize != null ? Number(job.byteSize) : null,
    facility: job.facility,
    facilitySource: job.facilitySource,
    detectedSheet: job.detectedSheet,
    detectedColumns: job.detectedColumns,
    workbookInfo: job.workbookInfo,
    counts: {
      total: job.totalRows,
      valid: job.validRows,
      invalid: job.invalidRows,
      duplicate: job.duplicateRows,
      new: job.newRows,
      existing: job.existingRows,
      possible: job.possibleRows,
      imported: job.importedRows,
    },
    progress: {
      processedChunks: job.processedChunks,
      totalChunks: job.totalChunks,
      cursorRow: job.cursorRow,
    },
    preview: job.preview,
    warnings: job.warnings,
    error: job.errorType ? { type: job.errorType, message: job.errorMessage, retryable: job.retryable } : null,
    batchId: job.batchId,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  };
}
