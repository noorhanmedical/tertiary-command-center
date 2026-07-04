import type { Express, Request, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { storage } from "../storage";
import { and, eq, inArray } from "drizzle-orm";
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

// Plexus IQ runtime hardening — Routes step 1: placement.
//
// Wire shape uses camelCase (`newRun`) to match the rest of the
// PlexusIQ API surface (`patientType: 'visit' | 'outreach'`,
// `defaultPatientType`, etc.). There is no app-wide snake_case
// convention to follow here.
//
// Defaults are NOT applied at the schema level. The handler picks
// the correct default per surface to preserve current behavior:
//   - Clinical Import default = `append` (today's same-fac/date
//     find-or-create behavior, kept until the UI dialog ships)
//   - Add Patient default = `newRun` (today's behavior; will be
//     wired in a later routes step)
const placementSchema = z.object({
  mode: z.enum(["append", "newRun"]),
  targetBatchId: z.number().int().positive().optional(),
});

const clinicalImportSchema = z.object({
  rows: z.array(clinicalImportRowSchema).min(1, "rows is required"),
  defaultFacility: z.string().optional(),
  defaultScheduleDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "defaultScheduleDate must be YYYY-MM-DD")
    .optional(),
  defaultPatientType: z.enum(["visit", "outreach"]).optional(),
  placement: placementSchema.optional(),
});

const qualificationJobStartSchema = z.object({
  batchIds: z.array(z.number().int().positive()).optional(),
  patientIds: z.array(z.number().int().positive()).optional(),
  retryFailed: z.boolean().optional(),
  // Plexus IQ runtime hardening — Routes step 2.
  // Optional status filter forwarded straight to startBatchAnalysis.
  // Runner default is `['draft','pending']` (skip completed). Sending
  // an explicit list overrides that — e.g. `['error']` for retry-only.
  statuses: z.array(z.string()).optional(),
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

/**
 * Plexus IQ runtime hardening — Routes step 1.
 *
 * Resolve which batch a row group should land in, honoring placement.
 *
 * Modes:
 *   - `append` (default for Clinical Import; preserves today's
 *     find-or-create behavior).
 *       * If `targetBatchId` provided: validate it exists and matches
 *         the group's facility + scheduleDate; return that id without
 *         creating a new batch.
 *       * Otherwise: find an existing batch for facility+scheduleDate;
 *         create one if none exists.
 *   - `newRun`: always create a fresh sibling batch under the same
 *     facility/scheduleDate. Adds a `(Run N)` suffix to the name when
 *     siblings already exist so the new run is distinguishable in lists.
 *
 * Throws PlacementError on validation failure so the handler can return
 * a 400 with the structured reason.
 */
class PlacementError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "PlacementError";
  }
}

type PlacementResolution = { mode: "append" | "newRun"; targetBatchId?: number };

async function resolveBatchForGroup(
  facility: string,
  scheduleDate: string,
  userId: string | null,
  placement: PlacementResolution,
): Promise<{ batchId: number; created: boolean }> {
  const existing = await storage.getAllScreeningBatches();

  if (placement.mode === "append" && placement.targetBatchId != null) {
    const target = existing.find((b) => b.id === placement.targetBatchId);
    if (!target) {
      throw new PlacementError(
        `targetBatchId ${placement.targetBatchId} not found`,
      );
    }
    if (target.facility !== facility) {
      throw new PlacementError(
        `targetBatchId ${placement.targetBatchId} belongs to facility "${target.facility ?? ""}", expected "${facility}"`,
      );
    }
    if (target.scheduleDate !== scheduleDate) {
      throw new PlacementError(
        `targetBatchId ${placement.targetBatchId} has scheduleDate "${target.scheduleDate ?? ""}", expected "${scheduleDate}"`,
      );
    }
    return { batchId: target.id, created: false };
  }

  if (placement.mode === "append") {
    const match = existing.find(
      (b) => b.facility === facility && b.scheduleDate === scheduleDate,
    );
    if (match) return { batchId: match.id, created: false };
  }

  // newRun, OR append-with-no-existing-match: create a fresh batch.
  const siblings =
    placement.mode === "newRun"
      ? existing.filter(
          (b) => b.facility === facility && b.scheduleDate === scheduleDate,
        )
      : [];
  const baseName = `${facility} - ${scheduleDate}`;
  const name = siblings.length > 0 ? `${baseName} (Run ${siblings.length + 1})` : baseName;
  const batch = await storage.createScreeningBatch({
    name,
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
      placement: placementInput,
    } = parsed.data;

    // Plexus IQ runtime hardening — Routes step 1.
    // Clinical Import preserves today's behavior when the client
    // does not send a placement: append-to-same-facility-and-date
    // (find-or-create). The UI dialog will start sending an
    // explicit placement in a later block.
    const placement: PlacementResolution = placementInput
      ? { mode: placementInput.mode, targetBatchId: placementInput.targetBatchId }
      : { mode: "append" };

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

    // Plexus IQ runtime hardening — Routes step 1.
    // `targetBatchId` only makes sense for a single facility/date
    // upload. Reject mixed uploads up-front rather than silently
    // splitting between target-batch and find-or-create behavior.
    if (placement.targetBatchId != null && groups.size > 1) {
      return res.status(400).json({
        ok: false,
        error:
          "placement.targetBatchId is only valid when the upload contains a single facility/scheduleDate group",
        groupCount: groups.size,
      });
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
        const resolved = await resolveBatchForGroup(
          facility,
          scheduleDate,
          userId,
          placement,
        );
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
      // Plexus IQ runtime hardening — Routes step 1.
      // PlacementError is a client validation failure (invalid
      // targetBatchId / mismatched facility / mismatched date).
      // Return 400 + structured reason so the UI can show the user
      // why their placement was rejected.
      if (error instanceof PlacementError) {
        return res.status(400).json({
          ok: false,
          error: error.reason,
          importedCount: 0,
          skippedCount: errors.length,
          errors,
          batchIds: [],
          patientIds: [],
          batchPatientMap: [],
        });
      }
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
      const { batchIds = [], patientIds = [], retryFailed, statuses } = parsed.data;
      const resolvedBatchIds = new Set<number>(batchIds);

      // Plexus IQ runtime hardening — Routes step 2.
      // Group patientIds by their owning batchId so we can pass each
      // batch's narrow slice to its own startBatchAnalysis call.
      // Without this, sending patientIds spanning two batches would
      // ask the runner to filter batch A by ids that include batch
      // B's patients — the runner intersects, so those B ids would
      // silently drop and batch A would over-process.
      const patientIdsByBatch = new Map<number, number[]>();
      for (const pid of patientIds) {
        const p = await storage.getPatientScreening(pid);
        if (!p?.batchId) continue;
        resolvedBatchIds.add(p.batchId);
        const slice = patientIdsByBatch.get(p.batchId);
        if (slice) slice.push(pid);
        else patientIdsByBatch.set(p.batchId, [pid]);
      }

      if (resolvedBatchIds.size === 0) {
        return res
          .status(400)
          .json({ error: "Provide at least one batchId or patientId" });
      }

      const userId: string | null = req.session.userId ?? null;
      type StartedJob = {
        batchId: number;
        jobId: number;
        totalPatients: number;
        // Plexus IQ runtime hardening — Routes step 2.
        // Surfaced verbatim from startBatchAnalysis so the UI can
        // show "X eligible / Y skipped" and detect duplicate-job
        // protection trips without a second roundtrip.
        eligibleCount?: number;
        skippedCount?: number;
        duplicate?: {
          existingJobId: number;
          existingStatus: string;
          reason: "running" | "overlapping_target";
        };
      };
      const startedJobs: StartedJob[] = [];
      const startErrors: Array<{ batchId: number; reason: string }> = [];

      for (const batchId of resolvedBatchIds) {
        try {
          const batchPatientIds = patientIdsByBatch.get(batchId);
          const result = await startBatchAnalysis(
            batchId,
            userId,
            {
              resetFailed: !!retryFailed,
              ...(batchPatientIds && batchPatientIds.length > 0
                ? { patientIds: batchPatientIds }
                : {}),
              ...(statuses && statuses.length > 0 ? { statuses } : {}),
            },
          );
          startedJobs.push({
            batchId,
            jobId: result.jobId,
            totalPatients: result.totalPatients,
            eligibleCount: result.eligibleCount,
            skippedCount: result.skippedCount,
            duplicate: result.duplicate,
          });
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

        // Plexus IQ runtime hardening — status v2.
        // Read analysis_jobs.metadata for the runtime-hardening counters,
        // chunk progress, throughput, rate-limit, and ai-batch fallback
        // signals. Legacy jobs (pre-hardening) have metadata={} so each
        // field is treated as optional/undefined and the UI renders the
        // count as "—" rather than a fake zero.
        const metadata = (job.metadata ?? {}) as Record<string, unknown>;
        const counters = (metadata.counters ?? {}) as Record<string, unknown>;
        const numOrUndef = (v: unknown): number | undefined =>
          typeof v === "number" && Number.isFinite(v) ? v : undefined;

        const skipped = numOrUndef(counters.skipped) ?? 0;
        const missingClinicalCount = numOrUndef(counters.missingClinical);
        const missingDemographicCount = numOrUndef(counters.missingDemographic);
        const technicalFailedCount = numOrUndef(counters.technicalFailed);
        const aiErrorCount = numOrUndef(counters.aiError);
        const chunkIndex = numOrUndef(metadata.chunkIndex);
        const totalChunks = numOrUndef(metadata.totalChunks);
        const patientsPerMinute = numOrUndef(metadata.patientsPerMinute);
        const etaSecondsRemaining = numOrUndef(metadata.etaSecondsRemaining);
        const rateLimitedCount = numOrUndef(metadata.rateLimitedCount) ?? 0;
        const aiBatchFallbackCount = numOrUndef(metadata.aiBatchFallbackCount) ?? 0;

        // Queued = whatever the runner says is left in the target set,
        // falling back to `total - completed` for legacy jobs without
        // a metadata counters block.
        const queued =
          numOrUndef(counters.queued) ?? Math.max(0, total - completed);

        // Aggregate per-patient failure detail from patient_screenings.
        // Each failed patient carries either:
        //   - reasoning.__analysisFailure: { category, reason, failedAt }
        //     (runtime-hardening shape — preferred)
        //   - reasoning.__analysisError:   { message, failedAt }
        //     (legacy mirror)
        // The category is surfaced alongside the message so the multi-job
        // UI can split missing-info from technical/AI failures.
        const patients = await storage.getPatientScreeningsByBatch(job.batchId);
        const failed = patients.filter((p) => p.status === "error");
        const errors = failed.map((p) => {
          const reasoning = (p.reasoning ?? {}) as Record<string, unknown>;
          const failure = reasoning["__analysisFailure"] as
            | { category?: string; reason?: string; failedAt?: string }
            | undefined;
          const analysisErr = reasoning["__analysisError"] as
            | { message?: string; failedAt?: string }
            | undefined;
          return {
            patientId: p.id,
            patientName: p.name,
            error:
              failure?.reason ??
              analysisErr?.message ??
              "Analysis failed (status=error)",
            category: failure?.category,
          };
        });

        let status: "queued" | "processing" | "completed" | "failed" | "cancelled" =
          "processing";
        if (job.status === "completed") status = "completed";
        else if (job.status === "failed") status = "failed";
        else if (job.status === "running") {
          status = completed === 0 ? "queued" : "processing";
        }

        // Percent uses (completed + failed + skipped) over total so the
        // bar reaches 100% even when the eligible set finishes with
        // some failures or pre-check skips — matches the runner's own
        // accounting in analysis_jobs.metadata.counters.
        const percent =
          total === 0
            ? 0
            : Math.round(((completed + failed.length + skipped) / total) * 100);

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
          skipped,
          percent,
          chunkIndex,
          totalChunks,
          patientsPerMinute,
          etaSecondsRemaining,
          rateLimitedCount,
          aiBatchFallbackCount,
          missingClinicalCount,
          missingDemographicCount,
          technicalFailedCount,
          aiErrorCount,
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
  // Plexus IQ runtime hardening — Routes step 3.
  //
  // Targets ONLY patients with `status='error'` in the underlying
  // batch. Completed, draft, and pending rows are left alone.
  //
  // Behavior changes vs the prior version:
  //   - No longer resets every patient in the batch (the old code
  //     blew away `completed` rows and re-qualified them).
  //   - No longer flips the batch row's status to `draft`.
  //   - Returns a clear "no retryable failed patients found" response
  //     when there's nothing to do, instead of silently starting an
  //     empty job.
  //   - Surfaces `eligibleCount` / `skippedCount` / `duplicate` /
  //     `retryableCount` so the UI can show what actually ran.
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

        // Derive failed patientIds from THIS batch only. Anything that
        // isn't in `status='error'` is left untouched: completed rows
        // stay completed, draft/pending rows stay queued for the
        // normal Generate flow.
        const allPatients = await storage.getPatientScreeningsByBatch(job.batchId);
        const failedIds = allPatients
          .filter((p) => p.status === "error")
          .map((p) => p.id);
        const retryableCount = failedIds.length;

        if (retryableCount === 0) {
          return res.status(200).json({
            ok: false,
            jobId: null,
            retryableCount: 0,
            reason: "no retryable failed patients found",
          });
        }

        // Scope the reset to ONLY the failed rows. This fixes the
        // user-reported pain point: prior versions reset every row in
        // the batch, including completed ones, which then got
        // re-qualified on every retry.
        await db
          .update(patientScreenings)
          .set({ status: "draft", qualifyingTests: [], reasoning: {} })
          .where(
            and(
              eq(patientScreenings.batchId, job.batchId),
              inArray(patientScreenings.id, failedIds),
            ),
          );

        const userId: string | null = req.session.userId ?? null;
        // Pass `patientIds` only. The runner's `resolveEligiblePatients`
        // gives `patientIds` precedence over `statuses`, so adding
        // `statuses: ['error']` here would be a no-op (and confusing:
        // we've just reset those rows to 'draft', so an `['error']`
        // status filter would intersect to zero if it were honoured).
        const result = await startBatchAnalysis(
          job.batchId,
          userId,
          {
            resetFailed: true,
            patientIds: failedIds,
          },
        );

        if (result.duplicate) {
          // A duplicate-job trip means an existing run is already
          // covering these patients. Surface the existing job id so
          // the client can switch its poll target without a second
          // request.
          return res.status(200).json({
            ok: false,
            jobId: null,
            retryableCount,
            duplicate: result.duplicate,
            reason: "duplicate job in flight",
          });
        }

        return res.json({
          ok: true,
          jobId: result.jobId,
          totalPatients: result.totalPatients,
          retryableCount,
          eligibleCount: result.eligibleCount,
          skippedCount: result.skippedCount,
          duplicate: result.duplicate,
        });
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
