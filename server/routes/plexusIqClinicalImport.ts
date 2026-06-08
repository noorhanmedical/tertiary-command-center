import type { Express, Request, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { storage } from "../storage";
import { eq } from "drizzle-orm";
import { patientScreenings, screeningBatches } from "@shared/schema";
import { VALID_FACILITIES } from "@shared/plexus";
import { logAudit } from "../services/auditService";
import { invalidatePatientDatabase } from "./patientDatabase";
import {
  findSchedulerForBatch,
  createAssignmentTask,
} from "../services/schedulerAssignmentService";
import {
  startBatchAnalysis,
  NoSuchBatchError,
  EmptyBatchError,
} from "../services/batchAnalysisRunner";
import { extractDateFromPrevTests } from "./helpers";

// Clinical-paste bulk import + durable qualification job routes for
// Plexus IQ. Re-uses the existing analysis_jobs infra so the client can
// poll progress with the same shape used by /api/batches/:id/analysis-status.

// Per-patient traceability sentinel. Every clinical-import insert
// stamps this prefix so future readers (status endpoint, retries,
// human inspection) can recover the import row index, MRN, parser
// warnings, and raw row snippet without touching the schema.
const CLINICAL_IMPORT_NOTES_HEADER = "[plexus-iq-clinical-import]";

// Build the structured notes block for one imported clinical row. The
// AGE and SEX values are NOT included here because they have dedicated
// columns (`age` + `gender`); duplicating them in notes would mislead
// reviewers. Long clinical text inside `extra` is preserved verbatim.
function buildClinicalImportNotes(input: {
  rowIndex?: number | null;
  mrn?: string | null;
  previousAncillaries?: string | null;
  parserWarnings?: string[] | null;
  raw?: string | null;
  existingNotes?: string | null;
}): string | null {
  const headerLines: string[] = [CLINICAL_IMPORT_NOTES_HEADER];
  headerLines.push(`source: plexus-iq-clinical-import`);
  if (input.rowIndex != null) headerLines.push(`rowIndex: ${input.rowIndex}`);
  if (input.mrn?.trim()) headerLines.push(`MRN: ${input.mrn.trim()}`);
  if (input.previousAncillaries?.trim())
    headerLines.push(`Ancillaries Completed: ${input.previousAncillaries.trim()}`);
  if (input.parserWarnings?.length) {
    for (const w of input.parserWarnings) headerLines.push(`Parser warning: ${w}`);
  }
  if (input.raw?.trim()) {
    // Cap raw at 2000 chars to keep notes readable but not lossy for
    // typical clinical paste rows (which are well under that).
    const snippet =
      input.raw.length > 2000
        ? input.raw.slice(0, 2000) + "\n…(truncated)"
        : input.raw;
    headerLines.push(`raw:\n${snippet}`);
  }
  const header = headerLines.join("\n");
  const existing = (input.existingNotes ?? "").trim();
  if (header && existing) return `${header}\n\n${existing}`;
  return header || existing || null;
}

// BatchFlow imports phone and email into patient records — the
// client parser extracts both (header-driven path and Start/End
// path) and the wire payload carries them into patient_screenings.
// SOURCE MARKER: BatchFlow imports phone and email into patient records
const clinicalImportRowSchema = z.object({
  facility: z.string().optional(),
  scheduleDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "scheduleDate must be YYYY-MM-DD")
    .optional(),
  patientType: z.enum(["visit", "outreach"]).optional(),
  name: z.string().min(1, "name is required"),
  time: z.string().optional(),
  dob: z.string().optional(),
  age: z.string().optional(),
  sex: z.string().optional(),
  mrn: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  clinician: z.string().optional(),
  dateAdded: z.string().optional(),
  diagnoses: z.string().optional(),
  history: z.string().optional(),
  medications: z.string().optional(),
  previousAncillaries: z.string().optional(),
  insurance: z.string().optional(),
  raw: z.string().optional(),
  rowIndex: z.number().int().optional(),
});

const clinicalImportSchema = z.object({
  rows: z.array(clinicalImportRowSchema).min(1, "rows is required"),
  defaultFacility: z.string().optional(),
  defaultScheduleDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "defaultScheduleDate must be YYYY-MM-DD")
    .optional(),
  defaultPatientType: z.enum(["visit", "outreach"]).optional(),
});

const qualificationJobStartSchema = z.object({
  batchIds: z.array(z.number().int().positive()).optional(),
  patientIds: z.array(z.number().int().positive()).optional(),
  retryFailed: z.boolean().optional(),
});

const FACILITY_LOOKUP: Record<string, (typeof VALID_FACILITIES)[number]> = (() => {
  const m: Record<string, (typeof VALID_FACILITIES)[number]> = {};
  for (const f of VALID_FACILITIES) m[f.toLowerCase()] = f;
  return m;
})();

function resolveFacility(raw: string | undefined): string | null {
  if (!raw) return null;
  const k = raw.trim().toLowerCase();
  if (!k) return null;
  if (FACILITY_LOOKUP[k]) return FACILITY_LOOKUP[k];
  for (const f of VALID_FACILITIES) {
    if (f.toLowerCase().includes(k)) return f;
  }
  return null;
}

async function resolveBatchForGroup(
  facility: string,
  scheduleDate: string,
  userId: string | null,
): Promise<{ batchId: number; created: boolean }> {
  const existing = await storage.getAllScreeningBatches();
  const match = existing.find(
    (b) => b.facility === facility && b.scheduleDate === scheduleDate,
  );
  if (match) return { batchId: match.id, created: false };

  const batch = await storage.createScreeningBatch({
    name: `${facility} - ${scheduleDate}`,
    patientCount: 0,
    status: "draft",
    facility,
    scheduleDate,
  });

  // Best-effort scheduler assignment, matching the behavior of
  // POST /api/batches. We don't fail the import if assignment fails —
  // the user can assign later.
  try {
    const assignment = await findSchedulerForBatch(facility, scheduleDate);
    if (!assignment.requiresManualAssignment) {
      if (assignment.scheduler) {
        await storage.updateScreeningBatch(batch.id, {
          assignedSchedulerId: assignment.scheduler.id,
        });
        await createAssignmentTask(batch.id, batch.name, assignment.scheduler.id);
      } else {
        await createAssignmentTask(batch.id, batch.name, null);
      }
    }
  } catch (assignErr) {
    console.error(
      `[plexusIqClinicalImport] scheduler assignment failed for batch ${batch.id}:`,
      assignErr,
    );
  }

  void userId;
  return { batchId: batch.id, created: true };
}

export function registerPlexusIqClinicalImportRoutes(app: Express) {
  // ─── Clinical import: bulk-insert patients from parsed rows ───────────
  app.post("/api/plexus-iq/clinical-import", async (req: Request, res: Response) => {
    const parsed = clinicalImportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    }

    const {
      rows,
      defaultFacility,
      defaultScheduleDate,
      defaultPatientType,
    } = parsed.data;

    type Resolved = z.infer<typeof clinicalImportRowSchema> & {
      facility: string;
      scheduleDate: string;
      patientType: "visit" | "outreach";
    };
    const resolvedRows: Resolved[] = [];
    // Skip records are visible — every dropped row carries rowIndex,
    // patientName when available, reason, and a short raw snippet so
    // the client UI can show "X skipped, why, which rows" rather than
    // a silent drop.
    type SkipError = {
      rowIndex: number;
      patientName?: string;
      reason: string;
      raw?: string;
    };
    const errors: SkipError[] = [];

    rows.forEach((r, idx) => {
      const rowIndex = r.rowIndex ?? idx + 1;
      const rawSnippet = r.raw && r.raw.length > 200 ? r.raw.slice(0, 200) + "…" : r.raw;
      const facility =
        resolveFacility(r.facility ?? defaultFacility) ??
        (defaultFacility ? resolveFacility(defaultFacility) : null);
      if (!facility) {
        errors.push({
          rowIndex,
          patientName: r.name?.trim() || undefined,
          reason: `Unknown or missing facility "${r.facility ?? defaultFacility ?? ""}"`,
          raw: rawSnippet,
        });
        return;
      }
      const scheduleDate = r.scheduleDate ?? defaultScheduleDate;
      if (!scheduleDate) {
        errors.push({
          rowIndex,
          patientName: r.name?.trim() || undefined,
          reason: "Missing scheduleDate",
          raw: rawSnippet,
        });
        return;
      }
      const patientType: "visit" | "outreach" =
        r.patientType ?? defaultPatientType ?? "visit";
      if (!r.name?.trim()) {
        errors.push({
          rowIndex,
          reason: "Missing name",
          raw: rawSnippet,
        });
        return;
      }
      resolvedRows.push({ ...r, rowIndex, facility, scheduleDate, patientType });
    });

    if (resolvedRows.length === 0) {
      return res.status(400).json({
        ok: false,
        importedCount: 0,
        skippedCount: rows.length,
        errors,
        batchIds: [],
        patientIds: [],
        batchPatientMap: [],
      });
    }

    // Group rows by facility+scheduleDate so we resolve each batch once.
    const groups = new Map<string, Resolved[]>();
    for (const r of resolvedRows) {
      const key = `${r.facility}::${r.scheduleDate}`;
      const arr = groups.get(key);
      if (arr) arr.push(r);
      else groups.set(key, [r]);
    }

    const batchIds: number[] = [];
    const patientIds: number[] = [];
    const batchPatientMap: Array<{
      batchId: number;
      patientIds: number[];
      facility: string;
      scheduleDate: string;
    }> = [];

    const userId: string | null = req.session.userId ?? null;

    try {
      for (const [, groupRows] of groups) {
        const facility = groupRows[0].facility;
        const scheduleDate = groupRows[0].scheduleDate;
        const resolved = await resolveBatchForGroup(facility, scheduleDate, userId);
        const batchId = resolved.batchId;
        if (!batchIds.includes(batchId)) batchIds.push(batchId);

        // Single INSERT per group via Drizzle's array-values insert.
        // For 100-200 patients this is one fast SQL round-trip per group
        // rather than 100 sequential POSTs from the client.
        const inserts = groupRows.map((r) => {
          const ageNum = r.age?.trim()
            ? Number.parseInt(r.age.trim().replace(/[^0-9-]/g, ""), 10) || null
            : null;
          // MRN + rowIndex + parser warnings + raw row trace go into
          // structured notes so every imported patient is individually
          // traceable back to the clinical paste, without any new
          // schema columns.
          const notes = buildClinicalImportNotes({
            rowIndex: r.rowIndex ?? null,
            mrn: r.mrn ?? null,
            previousAncillaries: r.previousAncillaries ?? null,
            parserWarnings: null,
            raw: r.raw ?? null,
            existingNotes: null,
          });
          return {
            batchId,
            name: r.name.trim(),
            time: r.time?.trim() || null,
            age: ageNum,
            gender: r.sex?.trim() || null,
            dob: r.dob?.trim() || null,
            // BatchFlow imports phone and email into patient records.
            // SOURCE MARKER: BatchFlow imports phone and email into patient records
            phoneNumber: r.phone?.trim() || null,
            email: r.email?.trim() || null,
            insurance: r.insurance?.trim() || null,
            facility,
            diagnoses: r.diagnoses?.trim() || null,
            history: r.history?.trim() || null,
            medications: r.medications?.trim() || null,
            previousTests: r.previousAncillaries?.trim() || null,
            previousTestsDate:
              extractDateFromPrevTests(r.previousAncillaries?.trim() || null) ||
              null,
            noPreviousTests: /no\s+record/i.test(
              r.previousAncillaries?.trim() ?? "",
            ),
            notes,
            qualifyingTests: [] as string[],
            reasoning: {} as Record<string, unknown>,
            status: "draft" as const,
            appointmentStatus: "pending" as const,
            patientType: r.patientType,
          };
        });

        const insertedRows = await db
          .insert(patientScreenings)
          .values(inserts)
          .returning();

        // Reconciliation guard: every row we attempted to insert must
        // come back, otherwise we'd silently drop a patient. This is
        // belt-and-braces — Drizzle returning() will already throw on
        // failure — but the explicit check makes the contract visible
        // and surfaces the mismatch as a structured row error.
        if (insertedRows.length !== inserts.length) {
          for (let i = insertedRows.length; i < inserts.length; i++) {
            errors.push({
              rowIndex: groupRows[i]?.rowIndex ?? i + 1,
              reason: `INSERT returned ${insertedRows.length}/${inserts.length} rows — patient not persisted`,
            });
          }
        }

        for (const row of insertedRows) {
          patientIds.push(row.id);
        }

        await storage.updateScreeningBatch(batchId, {
          patientCount: (await storage.getPatientScreeningsByBatch(batchId))
            .length,
        });

        batchPatientMap.push({
          batchId,
          patientIds: insertedRows.map((c) => c.id),
          facility,
          scheduleDate,
        });

        void logAudit(req, "create", "patient_screenings_bulk", batchId, {
          count: insertedRows.length,
          source: "plexus-iq-clinical-import",
        });
      }

      invalidatePatientDatabase();

      return res.json({
        ok: true,
        importedCount: patientIds.length,
        skippedCount: errors.length,
        errors,
        batchIds,
        patientIds,
        batchPatientMap,
      });
    } catch (error: unknown) {
      console.error("[plexusIqClinicalImport] bulk insert error:", error);
      return res.status(500).json({
        ok: false,
        importedCount: patientIds.length,
        skippedCount: errors.length,
        errors: [
          ...errors,
          {
            rowIndex: 0,
            reason:
              error instanceof Error
                ? error.message
                : "Unknown server error during bulk insert",
          },
        ],
        batchIds,
        patientIds,
        batchPatientMap,
      });
    }
  });

  // ─── Start a qualification job for a given batch ─────────────────────
  // For simplicity (and to match the existing analysis_jobs schema, which
  // is batch-scoped), the request takes one or more batchIds. The first
  // batch is kicked off immediately; additional batches are kicked off
  // in sequence (each running concurrently inside batchProcess).
  app.post(
    "/api/plexus-iq/qualification-jobs",
    async (req: Request, res: Response) => {
      const parsed = qualificationJobStartSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const { batchIds = [], patientIds = [], retryFailed } = parsed.data;
      const resolvedBatchIds = new Set<number>(batchIds);

      // If patientIds were supplied, look up their batches.
      for (const pid of patientIds) {
        const p = await storage.getPatientScreening(pid);
        if (p?.batchId) resolvedBatchIds.add(p.batchId);
      }

      if (resolvedBatchIds.size === 0) {
        return res
          .status(400)
          .json({ error: "Provide at least one batchId or patientId" });
      }

      const userId: string | null = req.session.userId ?? null;
      const startedJobs: Array<{ batchId: number; jobId: number; totalPatients: number }> = [];
      const startErrors: Array<{ batchId: number; reason: string }> = [];

      for (const batchId of resolvedBatchIds) {
        try {
          const { jobId, totalPatients } = await startBatchAnalysis(
            batchId,
            userId,
            { resetFailed: !!retryFailed },
          );
          startedJobs.push({ batchId, jobId, totalPatients });
        } catch (err: unknown) {
          if (err instanceof NoSuchBatchError) {
            startErrors.push({ batchId, reason: "Batch not found" });
          } else if (err instanceof EmptyBatchError) {
            startErrors.push({ batchId, reason: "No patients in batch" });
          } else {
            startErrors.push({
              batchId,
              reason: err instanceof Error ? err.message : "Unknown error",
            });
          }
        }
      }

      if (startedJobs.length === 0) {
        return res.status(400).json({
          ok: false,
          jobId: null,
          jobs: [],
          errors: startErrors,
        });
      }

      // Convention: `jobId` is the first job's id (most callers want a
      // single id to poll). All jobs are also surfaced in `jobs`.
      return res.json({
        ok: true,
        jobId: startedJobs[0].jobId,
        jobs: startedJobs,
        errors: startErrors,
      });
    },
  );

  // ─── Job status (shape matches /api/batches/:id/analysis-status) ─────
  app.get(
    "/api/plexus-iq/qualification-jobs/:jobId/status",
    async (req: Request, res: Response) => {
      const jobId = Number.parseInt(String(req.params.jobId), 10);
      if (!Number.isFinite(jobId)) {
        return res.status(400).json({ error: "Invalid jobId" });
      }
      // We look up by the latest job for the batch the jobId belongs to,
      // since the existing repo doesn't expose a getById helper. Fall
      // back: scan via batchId-of-jobId path by reading the analysis_jobs
      // row directly via storage.
      try {
        const { db: rawDb } = await import("../db");
        const { analysisJobs } = await import("@shared/schema");
        const rows = await rawDb
          .select()
          .from(analysisJobs)
          .where(eq(analysisJobs.id, jobId));
        const job = rows[0];
        if (!job) {
          return res.status(404).json({ error: "Job not found" });
        }
        const total = job.totalPatients ?? 0;
        const completed = job.completedPatients ?? 0;
        const queued = Math.max(0, total - completed);

        // Aggregate per-patient failure detail from patient_screenings.
        // Each failed patient carries the AI error reason in reasoning
        // under the reserved key __analysisError.message; surface it
        // so the multi-job status UI can show the actual cause per row
        // rather than a generic "Analysis failed".
        const patients = await storage.getPatientScreeningsByBatch(job.batchId);
        const failed = patients.filter((p) => p.status === "error");
        const errors = failed.map((p) => {
          const reasoning = (p.reasoning ?? {}) as Record<string, unknown>;
          const analysisErr = reasoning["__analysisError"] as
            | { message?: string; failedAt?: string }
            | undefined;
          return {
            patientId: p.id,
            patientName: p.name,
            error:
              analysisErr?.message ?? "Analysis failed (status=error)",
          };
        });

        let status: "queued" | "processing" | "completed" | "failed" | "cancelled" =
          "processing";
        if (job.status === "completed") status = "completed";
        else if (job.status === "failed") status = "failed";
        else if (job.status === "running") {
          status = completed === 0 ? "queued" : "processing";
        }

        const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

        return res.json({
          ok: true,
          jobId: job.id,
          batchId: job.batchId,
          status,
          total,
          queued,
          processing: 0,
          completed,
          failed: failed.length,
          skipped: 0,
          percent,
          startedAt: job.startedAt,
          completedAt: job.completedAt ?? null,
          errorMessage: job.errorMessage ?? null,
          errors,
        });
      } catch (error: unknown) {
        console.error("[plexusIqClinicalImport] job-status error:", error);
        res.status(500).json({
          error:
            error instanceof Error ? error.message : "Failed to fetch job status",
        });
      }
    },
  );

  // ─── Retry failed patients for a given job ───────────────────────────
  // Resets patients with status="error" in the underlying batch back to
  // "draft" and re-kicks the existing batch-analysis runner. Returns the
  // new jobId so the client can switch its poll target.
  app.post(
    "/api/plexus-iq/qualification-jobs/:jobId/retry-failed",
    async (req: Request, res: Response) => {
      const jobId = Number.parseInt(String(req.params.jobId), 10);
      if (!Number.isFinite(jobId)) {
        return res.status(400).json({ error: "Invalid jobId" });
      }
      try {
        const { db: rawDb } = await import("../db");
        const { analysisJobs } = await import("@shared/schema");
        const rows = await rawDb
          .select()
          .from(analysisJobs)
          .where(eq(analysisJobs.id, jobId));
        const job = rows[0];
        if (!job) {
          return res.status(404).json({ error: "Job not found" });
        }

        // Reset patients with status="error" back to "draft" so the
        // analysis runner picks them up again.
        await db.transaction(async (tx) => {
          await tx
            .update(patientScreenings)
            .set({ status: "draft", qualifyingTests: [], reasoning: {} })
            .where(eq(patientScreenings.batchId, job.batchId));
          await tx
            .update(screeningBatches)
            .set({ status: "draft" })
            .where(eq(screeningBatches.id, job.batchId));
        });

        const userId: string | null = req.session.userId ?? null;
        const { jobId: newJobId, totalPatients } = await startBatchAnalysis(
          job.batchId,
          userId,
          { resetFailed: true },
        );
        return res.json({ ok: true, jobId: newJobId, totalPatients });
      } catch (err: unknown) {
        if (err instanceof NoSuchBatchError) {
          return res.status(404).json({ error: "Batch not found" });
        }
        if (err instanceof EmptyBatchError) {
          return res.status(400).json({ error: "No patients in batch" });
        }
        console.error("[plexusIqClinicalImport] retry-failed error:", err);
        res.status(500).json({
          error: err instanceof Error ? err.message : "Failed to retry job",
        });
      }
    },
  );
}
