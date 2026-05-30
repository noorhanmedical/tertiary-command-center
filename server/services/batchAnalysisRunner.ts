import { db } from "../db";
import { storage } from "../storage";
import { eq } from "drizzle-orm";
import { patientScreenings, screeningBatches } from "@shared/schema";
import { batchProcess } from "../replit_integrations/batch";
import { screenSinglePatientWithAI } from "./screening";
import { commitPatient } from "./patientCommitService";
import { getQualificationMode } from "../routes/helpers";
import { invalidatePatientDatabase } from "../routes/patientDatabase";

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

// Kicks off the durable analyze job. Returns `{ jobId, totalPatients }`
// synchronously after the job row is created; the heavy work (AI calls,
// commits, batch status update) runs as an unawaited background task.
export async function startBatchAnalysis(
  batchId: number,
  userId: string | null,
  options: { resetFailed?: boolean } = {},
): Promise<StartBatchAnalysisResult> {
  const batch = await storage.getScreeningBatch(batchId);
  if (!batch) throw new NoSuchBatchError(batchId);
  const patients = await storage.getPatientScreeningsByBatch(batchId);
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
        await tx
          .update(patientScreenings)
          .set({ status: "draft", qualifyingTests: [], reasoning: {} })
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
  void runAnalysisLoop(batchId, job.id, userId).catch((err) => {
    console.error("[batchAnalysisRunner] background loop error:", err);
  });

  return { jobId: job.id, totalPatients: patients.length };
}

async function runAnalysisLoop(
  batchId: number,
  jobId: number,
  userId: string | null,
): Promise<void> {
  try {
    const batch = await storage.getScreeningBatch(batchId);
    if (!batch) throw new NoSuchBatchError(batchId);
    const patients = await storage.getPatientScreeningsByBatch(batchId);
    const facilityQualMode = await getQualificationMode(batch.facility ?? null);
    console.log(
      `[batchAnalysisRunner:${batchId}] qualification mode: ${facilityQualMode} (facility: ${batch.facility ?? "none"})`,
    );

    const concurrency = Math.max(
      1,
      Number(process.env.BATCH_ANALYSIS_CONCURRENCY ?? 5),
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
            await storage.updatePatientScreening(patient.id, {
              qualifyingTests: match.qualifyingTests || [],
              reasoning: rawReasoning,
              diagnoses: match.diagnoses || patient.diagnoses || null,
              history: match.history || patient.history || null,
              medications: match.medications || patient.medications || null,
              age: match.age || patient.age || null,
              gender: match.gender || patient.gender || null,
              status: "completed",
            });
          } else {
            await storage.updatePatientScreening(patient.id, {
              qualifyingTests: [],
              reasoning: {},
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
          await storage.updatePatientScreening(patient.id, {
            qualifyingTests: [],
            reasoning: {
              __analysisError: {
                message: errMsg,
                failedAt: new Date().toISOString(),
              },
            } as Record<string, unknown>,
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
