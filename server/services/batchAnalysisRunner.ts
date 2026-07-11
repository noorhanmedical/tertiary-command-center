import { db } from "../db";
import { storage } from "../storage";
import { eq } from "drizzle-orm";
import { patientScreenings, screeningBatches } from "@shared/schema";
import { batchProcess } from "../replit_integrations/batch";
import { screenSinglePatientWithAI } from "./screening";
import { commitPatient } from "./patientCommitService";
import { getQualificationMode } from "../routes/helpers";
import { invalidatePatientDatabase } from "../routes/patientDatabase";
import { preserveAdminReviewReasoning } from "@shared/plexus-iq/adminReviewEvidence";

// Mandatory safety fix (Phase 3): the batch runner must never silently
// overwrite `patient_screenings.reasoning` and wipe an operator's admin-
// reviewed decisions. Every reasoning write in this file routes through
// `preserveAdminReviewReasoning`, which reads the existing blob, copies
// every key beginning with `adminReview:` forward on top of the caller's
// new reasoning, and returns the list of preserved keys so we can log
// them. Preserved keys always win. There is no override — a future
// "force overwrite" would be a Zod-validated explicit option on
// `startBatchAnalysis`, not a silent default.
function mergePreserveAndLog(
  patientId: number,
  jobId: number,
  batchId: number,
  existing: Record<string, unknown> | null | undefined,
  next: Record<string, unknown>,
  writeSite: string,
): Record<string, unknown> {
  const { reasoning, preservedKeys } = preserveAdminReviewReasoning(existing, next);
  if (preservedKeys.length > 0) {
    console.log(
      `[batchAnalysisRunner:${batchId}] job=${jobId} patient=${patientId} site=${writeSite} preserved adminReview keys:`,
      preservedKeys,
    );
  }
  return reasoning;
}

// Shared, durable batch-analysis runner. Used by:
//   - POST /api/batches/:id/analyze              (Plexus IQ "Generate")
//   - POST /api/plexus-iq/qualification-jobs     (clinical-import path)
//
// Behaviour matches the original analyze handler exactly so existing
// callers see no behavioural change.
//
// Reliability:
//   - Creates an analysis_jobs row up-front so the status endpoint can
//     be polled immediately.
//   - Runs screenSinglePatientWithAI with limited concurrency.
//   - One patient failure does not fail the whole job.
//   - Calls commitPatient for auto-commit on success.

export type StartBatchAnalysisResult = {
  jobId: number;
  totalPatients: number;
};

export class NoSuchBatchError extends Error {
  constructor(public readonly batchId: number) {
    super(`Batch ${batchId} not found`);
    this.name = "NoSuchBatchError";
  }
}

export class EmptyBatchError extends Error {
  constructor(public readonly batchId: number) {
    super(`Batch ${batchId} has no patients`);
    this.name = "EmptyBatchError";
  }
}

// Default lowered from 5 to 2 so Replit's per-process socket budget and
// the OpenAI 60s/attempt timeout don't compound. Override via env when
// running against a beefier host: `BATCH_ANALYSIS_CONCURRENCY=5`. The
// pure accessor lives in `batchAnalysisConfig.ts` so callers that just
// need the values can skip the db / storage / drizzle load.
import {
  BATCH_ANALYSIS_CONCURRENCY_DEFAULT as DEFAULT_BATCH_ANALYSIS_CONCURRENCY,
  getBatchAnalysisConfig,
} from "./batchAnalysisConfig";
export { getBatchAnalysisConfig };

export type StartBatchAnalysisOptions = {
  resetFailed?: boolean;
  /** Restrict the analysis to a subset of patients in this batch. Used
   *  by Plexus IQ's single-patient Generate so it can re-use the
   *  durable runner without re-processing the entire batch. When set,
   *  only these patient ids inside the batch are analyzed; the job
   *  row's totalPatients reflects the restricted set. Unknown ids are
   *  silently dropped. */
  restrictToPatientIds?: number[];
};

// Kicks off the durable analyze job. Returns `{ jobId, totalPatients }`
// synchronously after the job row is created; the heavy work (AI calls,
// commits, batch status update) runs as an unawaited background task.
export async function startBatchAnalysis(
  batchId: number,
  userId: string | null,
  options: StartBatchAnalysisOptions = {},
): Promise<StartBatchAnalysisResult> {
  const batch = await storage.getScreeningBatch(batchId);
  if (!batch) throw new NoSuchBatchError(batchId);
  const allPatients = await storage.getPatientScreeningsByBatch(batchId);
  if (allPatients.length === 0) throw new EmptyBatchError(batchId);
  const restrictIds = options.restrictToPatientIds && options.restrictToPatientIds.length > 0
    ? new Set(options.restrictToPatientIds)
    : null;
  const patients = restrictIds
    ? allPatients.filter((p) => restrictIds.has(p.id))
    : allPatients;
  if (patients.length === 0) throw new EmptyBatchError(batchId);

  await db.transaction(async (tx) => {
    if (batch.status === "processing" || batch.status === "error" || options.resetFailed) {
      await tx
        .update(screeningBatches)
        .set({ status: "draft" })
        .where(eq(screeningBatches.id, batchId));
      const resetStatuses = options.resetFailed
        ? ["processing", "error"]
        : ["processing"];
      const candidates = patients.filter((p) => resetStatuses.includes(p.status));
      for (const p of candidates) {
        // Preserve any admin-reviewed evidence keys instead of blanking
        // reasoning. The reset only clears AI-derived state; operator-
        // staged assignments and audit log survive.
        const { reasoning: resetReasoning, preservedKeys } =
          preserveAdminReviewReasoning(p.reasoning as Record<string, unknown> | null, {});
        if (preservedKeys.length > 0) {
          console.log(
            `[batchAnalysisRunner:${batchId}] reset-to-draft patient=${p.id} preserved adminReview keys:`,
            preservedKeys,
          );
        }
        await tx
          .update(patientScreenings)
          .set({ status: "draft", qualifyingTests: [], reasoning: resetReasoning })
          .where(eq(patientScreenings.id, p.id));
      }
    }
    await tx
      .update(screeningBatches)
      .set({ status: "processing" })
      .where(eq(screeningBatches.id, batchId));
  });

  const job = await storage.createAnalysisJob({
    batchId,
    status: "running",
    totalPatients: patients.length,
    completedPatients: 0,
  });

  // Run the heavy work in the background.
  void runAnalysisLoop(batchId, job.id, userId, restrictIds).catch((err) => {
    console.error("[batchAnalysisRunner] background loop error:", err);
  });

  return { jobId: job.id, totalPatients: patients.length };
}

async function runAnalysisLoop(
  batchId: number,
  jobId: number,
  userId: string | null,
  restrictIds: Set<number> | null = null,
): Promise<void> {
  try {
    const batch = await storage.getScreeningBatch(batchId);
    if (!batch) throw new NoSuchBatchError(batchId);
    const allPatients = await storage.getPatientScreeningsByBatch(batchId);
    const patients = restrictIds
      ? allPatients.filter((p) => restrictIds.has(p.id))
      : allPatients;
    const facilityQualMode = await getQualificationMode(batch.facility ?? null);
    console.log(
      `[batchAnalysisRunner:${batchId}] qualification mode: ${facilityQualMode} (facility: ${batch.facility ?? "none"})`,
    );

    const concurrency = Math.max(
      1,
      Number(process.env.BATCH_ANALYSIS_CONCURRENCY ?? DEFAULT_BATCH_ANALYSIS_CONCURRENCY),
    );
    // Dev-only audit logs so per-patient processing can be verified by
    // tailing the server console. We deliberately keep these out of
    // production logging to avoid noise; the per-patient persistence
    // already gives durable proof.
    const isDev = process.env.NODE_ENV !== "production";
    if (isDev) {
      console.log(
        `[batchAnalysisRunner:${batchId}] starting job ${jobId} with ${patients.length} patients; concurrency=${concurrency}`,
      );
    }

    await batchProcess(
      patients,
      async (patient) => {
        try {
          // Per-patient AI qualification. Each iteration here processes
          // exactly one patient through screenSinglePatientWithAI — no
          // batch-level AI call exists or is acceptable. The clinical
          // import fields (dob, insurance, previousTests, full notes
          // including MRN / row index / parser warnings) are
          // intentionally forwarded so each patient is evaluated on
          // their own full saved record.
          if (isDev) {
            console.log(
              `[batchAnalysisRunner:${batchId}] starting patient ${patient.id} ${patient.name}`,
            );
          }
          const result = await screenSinglePatientWithAI(
            {
              name: patient.name,
              time: patient.time,
              age: patient.age,
              gender: patient.gender,
              dob: patient.dob,
              insurance: patient.insurance,
              previousTests: patient.previousTests,
              diagnoses: patient.diagnoses,
              history: patient.history,
              medications: patient.medications,
              notes: patient.notes,
            },
            facilityQualMode,
          );

          if (result) {
            const match = result?.patients?.[0] || result;
            const rawReasoning: Record<string, any> = match.reasoning || {};
            for (const testKey of Object.keys(rawReasoning)) {
              const entry = rawReasoning[testKey];
              if (entry && typeof entry === "object" && entry.pearls !== undefined) {
                if (
                  !Array.isArray(entry.pearls) ||
                  entry.pearls.some((p: unknown) => typeof p !== "string")
                ) {
                  entry.pearls = undefined;
                }
              }
            }
            const mergedReasoning = mergePreserveAndLog(
              patient.id,
              jobId,
              batchId,
              patient.reasoning as Record<string, unknown> | null,
              rawReasoning,
              "ai_complete",
            );
            await storage.updatePatientScreening(patient.id, {
              qualifyingTests: match.qualifyingTests || [],
              reasoning: mergedReasoning,
              diagnoses: match.diagnoses || patient.diagnoses || null,
              history: match.history || patient.history || null,
              medications: match.medications || patient.medications || null,
              age: match.age || patient.age || null,
              gender: match.gender || patient.gender || null,
              status: "completed",
            });
          } else {
            const mergedReasoning = mergePreserveAndLog(
              patient.id,
              jobId,
              batchId,
              patient.reasoning as Record<string, unknown> | null,
              {},
              "ai_no_result",
            );
            await storage.updatePatientScreening(patient.id, {
              qualifyingTests: [],
              reasoning: mergedReasoning,
              status: "completed",
            });
          }
          try {
            await commitPatient(patient.id, userId ?? null, { auto: true });
          } catch (commitErr) {
            console.error(
              `[batchAnalysisRunner:${batchId}] auto-commit failed for patient ${patient.id}:`,
              commitErr,
            );
          }
          if (isDev) {
            console.log(
              `[batchAnalysisRunner:${batchId}] completed patient ${patient.id} ${patient.name}`,
            );
          }
        } catch (err: any) {
          const errMsg = err?.message ?? String(err);
          console.error(
            `[batchAnalysisRunner:${batchId}] failed to analyze patient ${patient.id} ${patient.name}:`,
            errMsg,
          );
          // Preserve the failure detail in `reasoning` (JSONB) so the
          // qualification-jobs status endpoint can surface per-patient
          // error reasons without a new schema column. Retry resets
          // this back to {} before the next attempt.
          const errorReasoning = mergePreserveAndLog(
            patient.id,
            jobId,
            batchId,
            patient.reasoning as Record<string, unknown> | null,
            {
              __analysisError: {
                message: errMsg,
                failedAt: new Date().toISOString(),
              },
            } as Record<string, unknown>,
            "analysis_error",
          );
          await storage.updatePatientScreening(patient.id, {
            qualifyingTests: [],
            reasoning: errorReasoning,
            status: "error",
          });
        }
        await storage.incrementAnalysisJobProgress(jobId).catch(() => {});
      },
      { concurrency, retries: 3 },
    );

    await db.transaction(async (tx) => {
      await tx
        .update(screeningBatches)
        .set({ status: "completed", patientCount: patients.length })
        .where(eq(screeningBatches.id, batchId));
    });
    await storage.updateAnalysisJob(jobId, {
      status: "completed",
      completedAt: new Date(),
    });
    invalidatePatientDatabase();
  } catch (error: unknown) {
    console.error(`[batchAnalysisRunner:${batchId}] analysis loop error:`, error);
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(screeningBatches)
          .set({ status: "error" })
          .where(eq(screeningBatches.id, batchId));
      });
    } catch (resetErr: unknown) {
      console.error(
        `[batchAnalysisRunner:${batchId}] failed to set batch status to error:`,
        resetErr,
      );
    }
    try {
      const failedJob = await storage.getLatestAnalysisJobByBatch(batchId);
      if (failedJob && failedJob.status === "running") {
        const errMsg =
          error instanceof Error ? error.message : "Unknown analysis error";
        await storage.updateAnalysisJob(failedJob.id, {
          status: "failed",
          errorMessage: errMsg,
          completedAt: new Date(),
        });
      }
    } catch (jobErr: unknown) {
      console.error(
        `[batchAnalysisRunner:${batchId}] failed to mark analysis job as failed:`,
        jobErr,
      );
    }
  }
}

// ─── Stuck-job recovery ────────────────────────────────────────────────
//
// Any analysis_jobs row still in `running` whose `startedAt` is older
// than JOB_STUCK_THRESHOLD_MS is considered stuck. We mark it `failed`
// with a clear `errorMessage`, set its batch back to `error`, and
// surface the recovered jobs so the caller can show them in the UI.
// This is safe to call repeatedly — once a stuck job is failed, it
// won't be picked up again. Patients keep their existing status
// (`completed` patients are not reset).

export type RecoveredStuckJob = {
  jobId: number;
  batchId: number;
  startedAt: string | null;
  totalPatients: number;
  completedPatients: number;
};

export async function recoverStuckAnalysisJobs(
  thresholdMs: number = getBatchAnalysisConfig().JOB_STUCK_THRESHOLD_MS,
): Promise<RecoveredStuckJob[]> {
  const cutoff = new Date(Date.now() - thresholdMs);
  // We read the small set of recent running jobs via the existing
  // storage helper — analysis_jobs is small.
  const jobs = await storage.getRecentAnalysisJobs(200);
  const recovered: RecoveredStuckJob[] = [];
  for (const job of jobs) {
    if (job.status !== "running") continue;
    const startedAt = job.startedAt instanceof Date ? job.startedAt : new Date(job.startedAt ?? 0);
    if (!Number.isFinite(startedAt.getTime())) continue;
    if (startedAt.getTime() >= cutoff.getTime()) continue;
    try {
      await storage.updateAnalysisJob(job.id, {
        status: "failed",
        errorMessage: `Stuck in running for >= ${thresholdMs}ms; recovered automatically. Re-run via retry-failed.`,
        completedAt: new Date(),
      });
      try {
        await db
          .update(screeningBatches)
          .set({ status: "error" })
          .where(eq(screeningBatches.id, job.batchId));
      } catch (stErr) {
        console.warn(`[batchAnalysisRunner] recover: batch status update failed for ${job.batchId}:`, stErr);
      }
      recovered.push({
        jobId: job.id,
        batchId: job.batchId,
        startedAt: startedAt.toISOString(),
        totalPatients: job.totalPatients ?? 0,
        completedPatients: job.completedPatients ?? 0,
      });
    } catch (err) {
      console.warn(`[batchAnalysisRunner] recover: failed to mark job ${job.id} as failed:`, err);
    }
  }
  return recovered;
}
