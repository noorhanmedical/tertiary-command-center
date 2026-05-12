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

// Compose AGE / SEX / MRN / Ancillaries Completed into the existing
// patient notes column when no dedicated schema columns exist. Long
// clinical text is preserved verbatim; we only prepend a structured
// header.
function structuredNotes(input: {
  mrn?: string | null;
  age?: string | null;
  sex?: string | null;
  previousAncillaries?: string | null;
  raw?: string | null;
  extra?: string | null;
}): string | null {
  const lines: string[] = [];
  if (input.mrn?.trim()) lines.push(`MRN: ${input.mrn.trim()}`);
  if (input.age?.trim()) lines.push(`AGE: ${input.age.trim()}`);
  if (input.sex?.trim()) lines.push(`SEX: ${input.sex.trim()}`);
  if (input.previousAncillaries?.trim())
    lines.push(`Ancillaries Completed: ${input.previousAncillaries.trim()}`);
  const header = lines.join("\n");
  const body = (input.extra ?? "").trim();
  if (header && body) return `${header}\n\n${body}`;
  return header || body || null;
}

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
    const errors: Array<{ rowIndex: number; reason: string }> = [];

    rows.forEach((r, idx) => {
      const rowIndex = r.rowIndex ?? idx + 1;
      const facility =
        resolveFacility(r.facility ?? defaultFacility) ??
        (defaultFacility ? resolveFacility(defaultFacility) : null);
      if (!facility) {
        errors.push({
          rowIndex,
          reason: `Unknown or missing facility "${r.facility ?? defaultFacility ?? ""}"`,
        });
        return;
      }
      const scheduleDate = r.scheduleDate ?? defaultScheduleDate;
      if (!scheduleDate) {
        errors.push({ rowIndex, reason: "Missing scheduleDate" });
        return;
      }
      const patientType: "visit" | "outreach" =
        r.patientType ?? defaultPatientType ?? "visit";
      if (!r.name?.trim()) {
        errors.push({ rowIndex, reason: "Missing name" });
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
          // MRN doesn't have a dedicated column — keep it in notes so it
          // surfaces in the UI alongside the previousAncillaries copy.
          const notes = structuredNotes({
            mrn: r.mrn ?? null,
            age: null,
            sex: null,
            previousAncillaries: r.previousAncillaries ?? null,
            extra: null,
          });
          return {
            batchId,
            name: r.name.trim(),
            time: r.time?.trim() || null,
            age: ageNum,
            gender: r.sex?.trim() || null,
            dob: r.dob?.trim() || null,
            phoneNumber: null as string | null,
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
        const patients = await storage.getPatientScreeningsByBatch(job.batchId);
        const failed = patients.filter((p) => p.status === "error");
        const errors = failed.map((p) => ({
          patientId: p.id,
          patientName: p.name,
          error: "Analysis failed (status=error)",
        }));

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
