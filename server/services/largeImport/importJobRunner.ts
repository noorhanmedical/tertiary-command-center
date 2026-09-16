// Durable background runner for large-file patient ingestion.
//
// Two phases, both resumable and both driven off the persisted import_jobs row
// so the HTTP request never stays open through processing:
//
//   ANALYZE  (uploaded → parsing → validating → preview_ready)
//     parse the staged file (streaming) → classify rows against existing
//     identity → persist counts + detected columns/facility + a bounded
//     preview. No DB writes to patient_screenings yet.
//
//   IMPORT   (preview_ready → importing → completed | failed)
//     re-parse the staged file (deterministic, cheap) → classify → ensure ONE
//     batch for the job → chunked idempotent write with live progress →
//     cleanup temp artifact.
//
// Re-parsing at import time (instead of stashing 15k rows in the DB) keeps the
// job row small and is naturally idempotent: the writer's (import_job_id,
// import_row_index) unique guard + the job cursor make a retry safe.

import fs from "node:fs/promises";
import { db } from "../../db";
import { screeningBatches } from "@shared/schema";
import type { ImportJob } from "@shared/schema";
import { getImportJob, updateImportJob, loadImportRowDecisions } from "../../repositories/importJobs.repo";
import { parseLargeFile, type ParseResult } from "./streamingParsers";
import { classifyRows, tallyClassifications, toPreviewRow, type ClassifiedRow } from "./dedupClassifier";
import { loadExistingIdentityIndex } from "./existingIdentityIndex";
import { writeClassifiedRows, DEFAULT_CHUNK_SIZE } from "./chunkedWriter";
import type { ImportFileFormat } from "@shared/schema";

const PREVIEW_SIZE = 50;

function previewFromClassified(rows: ClassifiedRow[]) {
  return rows.slice(0, PREVIEW_SIZE).map(toPreviewRow);
}

async function parseAndClassify(job: ImportJob): Promise<{ parse: ParseResult; classified: ClassifiedRow[] }> {
  if (!job.tempPath) throw new Error("import job has no staged file");
  const parse = await parseLargeFile(job.tempPath, (job.fileFormat ?? "unknown") as ImportFileFormat, {
    defaultFacility: job.facility ?? null,
    // Manager-approved corrections (re-normalize deterministically; file never mutated).
    columnOverrides: (job.columnOverrides ?? {}) as Record<string, never>,
    rowOverrides: (job.rowOverrides ?? {}) as Record<string, Record<string, unknown>>,
  });
  const existingIndex = await loadExistingIdentityIndex(job.clinicId ?? null);
  const classified = classifyRows(parse.rows, existingIndex);
  return { parse, classified };
}

/** ANALYZE phase — parse + classify + persist preview/counts. */
export async function runAnalysis(jobId: number): Promise<void> {
  const job = await getImportJob(jobId);
  if (!job) return;
  try {
    await updateImportJob(jobId, { status: "parsing" });
    const { parse, classified } = await parseAndClassify(job);

    if (parse.rows.length === 0) {
      await updateImportJob(jobId, {
        status: "failed",
        errorType: "parse_failed",
        errorMessage: parse.warnings.join("; ") || "No patient rows detected in file",
        retryable: false,
        warnings: parse.warnings as never,
        workbookInfo: (parse.workbookInfo ?? {}) as never,
      });
      return;
    }

    await updateImportJob(jobId, { status: "validating" });
    const counts = tallyClassifications(classified);

    await updateImportJob(jobId, {
      status: "preview_ready",
      fileFormat: parse.format,
      detectedSheet: parse.workbookInfo?.chosenSheet ?? null,
      detectedColumns: (parse.detection.fieldToHeader ?? {}) as never,
      workbookInfo: {
        ...(parse.workbookInfo ?? {}),
        // Full source-header list + current header→field mapping so the UI can
        // offer a mapping-correction editor (remap or ignore any source column).
        sourceHeaders: parse.headers,
        headerFieldMapping: parse.headers.map((h, i) => ({ header: h, field: parse.detection.mapping[i] ?? null })),
      } as never,
      totalRows: counts.total,
      validRows: counts.valid,
      invalidRows: counts.invalid,
      duplicateRows: counts.duplicate,
      newRows: counts.new,
      existingRows: counts.existing,
      possibleRows: counts.possible,
      totalChunks: Math.ceil(counts.new / (job.chunkSize || DEFAULT_CHUNK_SIZE)),
      preview: previewFromClassified(classified) as never,
      warnings: parse.warnings as never,
    });
  } catch (err) {
    await updateImportJob(jobId, {
      status: "failed",
      errorType: "parse_failed",
      errorMessage: (err as Error)?.message ?? String(err),
      retryable: true,
    });
  }
}

async function ensureBatchForJob(job: ImportJob): Promise<number> {
  if (job.batchId) return job.batchId;
  const [batch] = await db
    .insert(screeningBatches)
    .values({
      clinicId: job.clinicId ?? undefined,
      name: `Large import — ${job.originalFilename ?? `job ${job.id}`}`,
      facility: job.facility ?? undefined,
      status: "draft",
      importKind: "large_file",
      importCreatedBy: job.createdByUserId ?? undefined,
      isTest: job.isTest ?? false,
    } as never)
    .returning({ id: screeningBatches.id });
  await updateImportJob(job.id, { batchId: batch.id });
  return batch.id;
}

/** IMPORT phase — chunked idempotent write with live progress. Resumable. */
export async function runImport(jobId: number): Promise<void> {
  const job = await getImportJob(jobId);
  if (!job) return;
  if (job.status === "completed") return; // already done — idempotent no-op
  try {
    const { classified } = await parseAndClassify(job);
    const batchId = await ensureBatchForJob({ ...job, batchId: job.batchId });
    // Manager resolutions for POSSIBLE_MATCH rows (empty for a straight import).
    const decisions = await loadImportRowDecisions(jobId);

    await updateImportJob(jobId, { status: "importing" });

    const chunkSize = job.chunkSize || DEFAULT_CHUNK_SIZE;
    // Baseline imported count when resuming a partially-completed job.
    const baselineImported = job.cursorRow && job.cursorRow > 0 ? job.importedRows ?? 0 : 0;
    const result = await writeClassifiedRows(classified, {
      importJobId: jobId,
      batchId,
      clinicId: job.clinicId ?? null,
      chunkSize,
      isTest: job.isTest ?? false,
      decisions,
      fromRowIndex: job.cursorRow ?? 0,
      onChunk: async ({ processed, inserted, lastRowIndex }) => {
        await updateImportJob(jobId, {
          importedRows: baselineImported + inserted,
          processedChunks: Math.ceil(processed / chunkSize),
          cursorRow: lastRowIndex,
        });
      },
    });

    // Update the batch patient count.
    await db.execute(
      (await import("drizzle-orm")).sql`
        UPDATE screening_batches SET patient_count = (
          SELECT count(*) FROM patient_screenings WHERE batch_id = ${batchId}
        ) WHERE id = ${batchId}`,
    );

    await updateImportJob(jobId, {
      status: "completed",
      importedRows: result.inserted,
      cursorRow: result.lastRowIndex,
      completedAt: new Date(),
    });

    await cleanupTempFile(jobId);

    // P0 — auto-enqueue Plexus IQ for the freshly imported batch through the
    // CANONICAL durable runner. startBatchAnalysis creates the analysis_jobs
    // row and runs runAnalysisLoop in the background (no per-patient browser
    // requests, no second inline loop). Import completion is already durable;
    // an IQ-enqueue failure (e.g. empty eligible set) is logged, never fatal.
    try {
      const { startBatchAnalysis, EmptyBatchError, NoSuchBatchError } = await import(
        "../batchAnalysisRunner"
      );
      const iq = await startBatchAnalysis(batchId, job.createdByUserId ?? null);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({
        level: "info", source: "import_job_runner", kind: "iq_enqueued",
        importJobId: jobId, batchId, analysisJobId: iq.jobId,
        totalPatients: iq.totalPatients, eligibleCount: iq.eligibleCount ?? null,
        duplicate: iq.duplicate ? iq.duplicate.reason : null,
      }));
      void EmptyBatchError; void NoSuchBatchError;
    } catch (iqErr) {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({
        level: "warn", source: "import_job_runner", kind: "iq_enqueue_skipped",
        importJobId: jobId, batchId,
        message: (iqErr as Error)?.message ?? String(iqErr),
      }));
    }
  } catch (err) {
    await updateImportJob(jobId, {
      status: "failed",
      errorType: "write_failed",
      errorMessage: (err as Error)?.message ?? String(err),
      retryable: true,
    });
  }
}

/** Delete the staged temp artifact (best-effort). */
export async function cleanupTempFile(jobId: number): Promise<void> {
  const job = await getImportJob(jobId);
  if (!job?.tempPath) return;
  try {
    await fs.unlink(job.tempPath);
  } catch {
    // Already gone — fine.
  }
  await updateImportJob(jobId, { tempPath: null });
}
