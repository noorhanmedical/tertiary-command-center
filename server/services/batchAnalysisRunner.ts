import { db } from "../db";
import { storage } from "../storage";
import { eq } from "drizzle-orm";
import { patientScreenings, screeningBatches, type PatientScreening } from "@shared/schema";
import { batchProcess } from "../replit_integrations/batch";
import { screenSinglePatientWithAI } from "./screening";
import { getQualificationMode } from "../routes/helpers";
import { invalidatePatientDatabase } from "../routes/patientDatabase";
import { classifyPlexusIqPreCheck } from "./plexusIqPreCheck";
import { readPlexusIqRuntimeConfig, type PlexusIqRuntimeConfig } from "./plexusIqRuntimeConfig";
import {
  screenPatientsWithAIBatch,
  type MicroBatchPatientInput,
} from "./plexusIqAiBatch";
import type {
  PlexusIqAnalysisFailure,
  PlexusIqChunkEntry,
  PlexusIqFailureCategory,
  PlexusIqJobMetadata,
} from "@shared/contracts/plexusIqJobMetadata";
import { classifyMicroBatchFailureReason } from "../lib/aiObservability";
import {
  classifyLogSafeError,
  errorPhiSafe,
  logPhiSafe,
  warnPhiSafe,
} from "../lib/phiSafeLogger";

/**
 * Plexus IQ runtime hardening — step 3 helper.
 *
 * Resolve the eligible patient set for a job based on the options the
 * caller provided.
 *
 * Precedence:
 *   1. `options.patientIds` (intersected with batch rows)
 *   2. `options.statuses` filter
 *   3. **Default**: `status IN ('draft','pending')` — completed
 *      patients are SKIPPED. This is the change introduced in step 3:
 *      "Generate" on a batch with mixed completed + draft patients no
 *      longer re-AIs the completed work.
 *
 * Step 4 will use the `skipped` count for duplicate-job protection
 * and surface it on the status payload.
 */
export const DEFAULT_ELIGIBLE_STATUSES: ReadonlyArray<string> = ["draft", "pending"];

/** Stable user-facing reasons persisted with analysis failures. */
const SAFE_ANALYSIS_FAILURE_REASONS: Record<PlexusIqFailureCategory, string> = {
  missing_clinical: "Required clinical information is missing.",
  missing_demographic: "Required demographic information is missing.",
  technical_failed: "Analysis failed because of a technical error.",
  ai_error: "AI analysis failed.",
};

async function writeAnalysisFailure(
  patientId: number,
  failure: PlexusIqAnalysisFailure,
): Promise<void> {
  const safeFailure: PlexusIqAnalysisFailure = {
    category: failure.category,
    reason: SAFE_ANALYSIS_FAILURE_REASONS[failure.category],
    failedAt: failure.failedAt,
  };
  await storage.updatePatientScreening(patientId, {
    qualifyingTests: [],
    reasoning: {
      __analysisFailure: safeFailure,
      __analysisError: {
        message: safeFailure.reason,
        failedAt: safeFailure.failedAt,
      },
    } as Record<string, unknown>,
    status: "error",
  });
}

/**
 * Plexus IQ runtime hardening — step 6 helper.
 *
 * Build the metadata snapshot that gets persisted at terminal status
 * (completed or failed). The initial metadata is stamped at job
 * creation; this snapshot reconciles the counters and keeps the
 * targetPatientIds / runtimeConfig fields the duplicate-job guard
 * relies on.
 */
function buildTerminalMetadata(args: {
  eligibleIds: number[];
  initialSkipped: number;
  counters: RunnerCounters;
  chunkHistory?: PlexusIqChunkEntry[];
  config?: PlexusIqRuntimeConfig;
}): PlexusIqJobMetadata {
  const { eligibleIds, initialSkipped, counters, chunkHistory, config } = args;
  const queued = Math.max(
    0,
    eligibleIds.length - counters.processed - counters.failed,
  );
  const speed = chunkHistory ? computeThroughput(chunkHistory) : {};
  return {
    schemaVersion: 1,
    targetPatientIds: eligibleIds,
    chunkSize: config?.chunkSize,
    chunkHistory: chunkHistory && chunkHistory.length > 0 ? chunkHistory : undefined,
    counters: {
      processed: counters.processed,
      skipped: initialSkipped,
      queued,
      failed: counters.failed,
      missingClinical: counters.missingClinical,
      missingDemographic: counters.missingDemographic,
      technicalFailed: counters.technicalFailed,
      aiError: counters.aiError,
    },
    patientsPerMinute: speed.patientsPerMinute,
    runtimeConfig: config,
  };
}

function classifyCaughtError(err: unknown): PlexusIqFailureCategory {
  if (!err) return "technical_failed";
  const errAny = err as { message?: string; status?: number; statusCode?: number };
  const status = errAny.status ?? errAny.statusCode;
  if (status === 429 || status === 503) return "ai_error";
  const msg = (errAny.message ?? "").toLowerCase();
  if (msg.includes("timed out") || msg.includes("timeout")) return "technical_failed";
  if (msg.includes("network") || msg.includes("econnreset") || msg.includes("fetch")) {
    return "technical_failed";
  }
  return "ai_error";
}

/**
 * Plexus IQ runtime hardening — step 4 helper.
 *
 * The duplicate-job guard reads the existing job's
 * `metadata.targetPatientIds` (when present) to decide whether the
 * incoming request overlaps. Returns:
 *   - `null` when the existing job pre-dates the metadata column
 *     (or its metadata is empty/legacy): caller should treat the
 *     existing job as covering everything and respond `running`.
 *   - a `Set<number>` of target patient ids otherwise.
 *
 * Step 6 starts writing `targetPatientIds` so subsequent jobs make
 * the precise overlap decision; until then this helper degrades
 * safely by saying "treat the existing job as a superset."
 */
function readActiveJobTargetIds(metadata: unknown): Set<number> | null {
  if (!metadata || typeof metadata !== "object") return null;
  const meta = metadata as { targetPatientIds?: unknown };
  const ids = meta.targetPatientIds;
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const numeric = ids.filter((n): n is number => Number.isFinite(n));
  return numeric.length > 0 ? new Set(numeric) : null;
}

export function resolveEligiblePatients(
  patients: PatientScreening[],
  options: StartBatchAnalysisOptions,
): { eligible: PatientScreening[]; skipped: PatientScreening[] } {
  if (options.patientIds && options.patientIds.length > 0) {
    const wanted = new Set(options.patientIds);
    const eligible = patients.filter((p) => wanted.has(p.id));
    const skipped = patients.filter((p) => !wanted.has(p.id));
    return { eligible, skipped };
  }
  const statuses = new Set(
    options.statuses && options.statuses.length > 0
      ? options.statuses
      : DEFAULT_ELIGIBLE_STATUSES,
  );
  const eligible = patients.filter((p) => statuses.has(p.status));
  const skipped = patients.filter((p) => !statuses.has(p.status));
  return { eligible, skipped };
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

/**
 * Plexus IQ runtime hardening — extended options type (step 1).
 *
 * `patientIds` and `statuses` are declared here so callers can begin
 * passing them, but the loop body does NOT yet read them — this step
 * is type-only so the existing runner behaviour is preserved exactly.
 * Subsequent steps add the eligible-set filter, skip-completed default,
 * duplicate-job guard, failure categories, metadata writes, and the
 * chunk loop.
 */
export type StartBatchAnalysisOptions = {
  resetFailed?: boolean;
  /**
   * Explicit eligible patient ids. When provided in a later step the
   * runner will intersect with the batch's actual patient rows so
   * caller mistakes can't reach across batches. Not yet consumed.
   */
  patientIds?: number[];
  /**
   * Filter the eligible set by patient status. A later step will
   * default this to `['draft','pending']` to honour "skip completed"
   * — but for now the runner still iterates every patient.
   */
  statuses?: string[];
};

export type StartBatchAnalysisResult = {
  jobId: number;
  totalPatients: number;
  /**
   * Plexus IQ runtime hardening — populated in later steps. Reserved
   * here so callers can read these fields once available without a
   * second type breaking change.
   */
  eligibleCount?: number;
  skippedCount?: number;
  duplicate?: {
    existingJobId: number;
    existingStatus: string;
    reason: "running" | "overlapping_target";
  };
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
//
// Plexus IQ runtime hardening — step 1 widens the options type to
// accept patientIds/statuses, but the body still ignores them. This
// keeps the change reviewable as a no-op type widening.
export async function startBatchAnalysis(
  batchId: number,
  userId: string | null,
  options: StartBatchAnalysisOptions = {},
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

  // Plexus IQ runtime hardening — step 3: eligible set defaults to
  // draft+pending so completed patients are skipped.
  const { eligible, skipped } = resolveEligiblePatients(patients, options);
  const eligibleIds = eligible.map((p) => p.id);

  // Plexus IQ runtime hardening — step 4: duplicate-job guard.
  // If a job is already running for this batch and the requested
  // eligible set overlaps the in-flight job's target, return the
  // existing jobId so the UI just polls the running job instead of
  // starting another loop. When the existing job is older than the
  // metadata column (no targetPatientIds), we conservatively treat it
  // as covering everything and report `reason: 'running'`.
  if (eligible.length > 0) {
    const existing = await storage.getActiveAnalysisJobByBatch(batchId);
    if (existing) {
      const existingTarget = readActiveJobTargetIds(existing.metadata);
      const requestedIds = new Set(eligibleIds);
      const overlap =
        existingTarget === null
          ? true
          : Array.from(existingTarget).some((id) => requestedIds.has(id));
      if (overlap) {
        return {
          jobId: existing.id,
          totalPatients: existing.totalPatients,
          eligibleCount: existingTarget ? existingTarget.size : existing.totalPatients,
          skippedCount: skipped.length,
          duplicate: {
            existingJobId: existing.id,
            existingStatus: existing.status,
            reason: existingTarget === null ? "running" : "overlapping_target",
          },
        };
      }
      // Disjoint targets — fall through and start a second job
      // side-by-side. (Today only the same-batch path can reach this;
      // explicit patientIds[] differing from the active set is the
      // intended use case.)
    }
  }

  // Plexus IQ runtime hardening — step 6: stamp the initial metadata
  // shape onto the analysis_jobs row so the status endpoint + step 4
  // duplicate-job overlap check can read precise targets. Counters
  // start at zero; the runner mutates them as it goes and flushes
  // them per chunk in step 7.
  const config = readPlexusIqRuntimeConfig();
  const chunkSize = Math.max(1, Math.floor(config.chunkSize));
  const totalChunks = Math.max(1, Math.ceil(eligibleIds.length / chunkSize));
  const initialMetadata: PlexusIqJobMetadata = {
    schemaVersion: 1,
    targetPatientIds: eligibleIds,
    chunkSize,
    chunkIndex: 0,
    totalChunks,
    cursorPatientId: null,
    counters: {
      processed: 0,
      skipped: skipped.length,
      queued: eligibleIds.length,
      failed: 0,
      missingClinical: 0,
      missingDemographic: 0,
      technicalFailed: 0,
      aiError: 0,
    },
    chunkHistory: [],
    rateLimitedCount: 0,
    aiBatchFallbackCount: 0,
    runtimeConfig: config,
  };

  const job = await storage.createAnalysisJob({
    batchId,
    status: "running",
    totalPatients: eligible.length,
    completedPatients: 0,
    metadata: initialMetadata as unknown as Record<string, unknown>,
  });

  // Run the heavy work in the background. `eligibleIds` is forwarded
  // so the loop can target the resolved set rather than re-querying.
  void runAnalysisLoop(batchId, job.id, userId, eligibleIds, skipped.length, config).catch((error: unknown) => {
    errorPhiSafe({
      source: "batch_analysis",
      operation: "batch_analysis",
      outcome: "failed",
      category: classifyLogSafeError(error),
    });
  });

  return {
    jobId: job.id,
    totalPatients: eligible.length,
    eligibleCount: eligible.length,
    skippedCount: skipped.length,
  };
}

type RunnerCounters = {
  processed: number;
  failed: number;
  missingClinical: number;
  missingDemographic: number;
  technicalFailed: number;
  aiError: number;
};

function emptyRunnerCounters(): RunnerCounters {
  return {
    processed: 0,
    failed: 0,
    missingClinical: 0,
    missingDemographic: 0,
    technicalFailed: 0,
    aiError: 0,
  };
}

function bumpFailureCounter(
  counters: RunnerCounters,
  category: PlexusIqFailureCategory,
): void {
  counters.failed += 1;
  if (category === "missing_clinical") counters.missingClinical += 1;
  else if (category === "missing_demographic") counters.missingDemographic += 1;
  else if (category === "ai_error") counters.aiError += 1;
  else counters.technicalFailed += 1;
}

function snapshotCounters(c: RunnerCounters): RunnerCounters {
  return { ...c };
}

function diffCounters(a: RunnerCounters, b: RunnerCounters): RunnerCounters {
  return {
    processed: a.processed - b.processed,
    failed: a.failed - b.failed,
    missingClinical: a.missingClinical - b.missingClinical,
    missingDemographic: a.missingDemographic - b.missingDemographic,
    technicalFailed: a.technicalFailed - b.technicalFailed,
    aiError: a.aiError - b.aiError,
  };
}

/**
 * Plexus IQ runtime hardening — step 7 throughput helpers.
 *
 * `computeThroughput` averages over the trailing 5 chunks (less
 * jittery than the single-current-chunk rate). `computeEtaSeconds`
 * derives the remaining seconds from the rolling rate.
 */
function computeThroughput(history: ReadonlyArray<PlexusIqChunkEntry>): {
  patientsPerMinute?: number;
} {
  if (history.length === 0) return {};
  const window = history.slice(-5);
  const processed = window.reduce((s, c) => s + c.processed + c.failed, 0);
  if (processed === 0) return { patientsPerMinute: 0 };
  let elapsedMs = 0;
  for (const c of window) {
    if (!c.endedAt) continue;
    const ms = Date.parse(c.endedAt) - Date.parse(c.startedAt);
    if (Number.isFinite(ms) && ms > 0) elapsedMs += ms;
  }
  if (elapsedMs === 0) return { patientsPerMinute: 0 };
  return { patientsPerMinute: Math.round((processed * 60_000) / elapsedMs) };
}

function computeEtaSeconds(
  total: number,
  done: number,
  perMinute?: number,
): number | undefined {
  if (!perMinute || perMinute <= 0) return undefined;
  const remaining = Math.max(0, total - done);
  if (remaining === 0) return 0;
  return Math.round((remaining / perMinute) * 60);
}

/**
 * Plexus IQ runtime hardening — step 8 micro-batch helpers.
 *
 * `MicroBatchCacheEntry` is the per-patient shape stored in the
 * chunk-local cache. The cached object is wrapped in `{ patients: [..] }`
 * by the per-patient callback so the downstream persistence code (which
 * already reads `result?.patients?.[0] || result`) is unchanged.
 */
type MicroBatchCacheEntry = {
  qualifyingTests: string[];
  reasoning: Record<string, unknown>;
  diagnoses?: string | null;
  history?: string | null;
  medications?: string | null;
  age?: number | null;
  gender?: string | null;
};

async function runMicroBatchAi(args: {
  chunkPatients: PatientScreening[];
  aiResultCache: Map<number, MicroBatchCacheEntry>;
  mode: Parameters<typeof screenPatientsWithAIBatch>[1];
  config: PlexusIqRuntimeConfig;
  onFallback: (count: number) => void;
}): Promise<void> {
  const {
    chunkPatients,
    aiResultCache,
    mode,
    config,
    onFallback,
  } = args;
  // Pre-check filter: only feed AI-eligible patients to the micro
  // batch. Patients that fail the pre-check are handled by the
  // per-patient callback's own pre-check (no double work, no double
  // writes).
  const eligible: { patient: PatientScreening; input: MicroBatchPatientInput }[] = [];
  for (const p of chunkPatients) {
    const pre = classifyPlexusIqPreCheck({
      id: p.id,
      name: p.name,
      dob: p.dob,
      insurance: p.insurance,
      diagnoses: p.diagnoses,
      history: p.history,
      medications: p.medications,
    });
    if (!pre.ok) continue;
    eligible.push({
      patient: p,
      input: {
        // patientIndex assigned per mini-batch below; placeholder here.
        patientIndex: 0,
        name: p.name,
        time: p.time,
        age: p.age,
        gender: p.gender,
        dob: p.dob,
        insurance: p.insurance,
        previousTests: p.previousTests,
        diagnoses: p.diagnoses,
        history: p.history,
        medications: p.medications,
        notes: p.notes,
      },
    });
  }
  const batchSize = Math.max(2, Math.floor(config.aiBatchSize));
  for (let i = 0; i < eligible.length; i += batchSize) {
    const mini = eligible.slice(i, i + batchSize);
    const reindexed: MicroBatchPatientInput[] = mini.map((entry, idx) => ({
      ...entry.input,
      patientIndex: idx + 1,
    }));
    const res = await screenPatientsWithAIBatch(reindexed, mode, {
      timeoutMs: Math.max(1000, Math.floor(config.aiTimeoutMs)),
    });
    if (res.ok) {
      for (const r of res.results) {
        const source = mini[r.patientIndex - 1];
        if (!source) continue;
        aiResultCache.set(source.patient.id, {
          qualifyingTests: Array.isArray(r.qualifyingTests) ? r.qualifyingTests : [],
          reasoning:
            r.reasoning && typeof r.reasoning === "object" ? r.reasoning : {},
          diagnoses: r.diagnoses ?? null,
          history: r.history ?? null,
          medications: r.medications ?? null,
          age: r.age ?? null,
          gender: r.gender ?? null,
        });
      }
    } else {
      onFallback(mini.length);
      warnPhiSafe({
        source: "batch_analysis",
        operation: "batch_analysis",
        outcome: "partial",
        category: classifyMicroBatchFailureReason(res.reason),
        count: mini.length,
      });
    }
  }
}

async function runAnalysisLoop(
  batchId: number,
  jobId: number,
  userId: string | null,
  eligibleIds: number[],
  initialSkipped: number,
  config: PlexusIqRuntimeConfig,
): Promise<void> {
  // Plexus IQ runtime hardening — step 6/7: maintain an in-memory
  // counter accumulator and chunk history across the loop. Step 7
  // flushes counters and a chunk-history snapshot to metadata at
  // every chunk boundary so the status endpoint can compute ETA +
  // speed in flight.
  const counters = emptyRunnerCounters();
  const chunkHistory: PlexusIqChunkEntry[] = [];
  try {
    const batch = await storage.getScreeningBatch(batchId);
    if (!batch) throw new NoSuchBatchError(batchId);
    // Plexus IQ runtime hardening — step 2: load only the eligible
    // patients computed at job start. With the current default (no
    // options) `eligibleIds` covers every patient in the batch, so the
    // resulting list matches today's `getPatientScreeningsByBatch`.
    // Steps 3+ narrow the default so completed rows are skipped.
    const allPatients = await storage.getPatientScreeningsByBatch(batchId);
    const eligibleSet = new Set(eligibleIds);
    const patients =
      eligibleIds.length === 0
        ? allPatients
        : allPatients.filter((p) => eligibleSet.has(p.id));
    const facilityQualMode = await getQualificationMode(batch.facility ?? null);

    // Plexus IQ runtime hardening — step 7: use PLEXUS_IQ_* config.
    // The legacy BATCH_ANALYSIS_CONCURRENCY env var is preserved by
    // readPlexusIqRuntimeConfig() so existing operators see no change
    // until they explicitly raise PLEXUS_IQ_ANALYSIS_CONCURRENCY.
    const concurrency = Math.max(1, Math.floor(config.concurrency));
    const chunkSize = Math.max(1, Math.floor(config.chunkSize));
    logPhiSafe({
      source: "batch_analysis",
      operation: "batch_analysis",
      outcome: "started",
      total: patients.length,
    });

    // Plexus IQ runtime hardening — step 7: chunk loop. Slice the
    // eligible patient list into chunks of `chunkSize`; each chunk
    // runs through `batchProcess` with the same concurrency as
    // before, but counters + chunk history are persisted to metadata
    // after every chunk so the status endpoint can render ETA + speed
    // live and the duplicate-job guard sees a fresh cursor.
    const totalChunks = Math.max(1, Math.ceil(patients.length / chunkSize));
    let aiBatchFallbackTotal = 0;
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, patients.length);
      const chunkPatients = patients.slice(start, end);
      const chunkStart = Date.now();
      const chunkBefore = snapshotCounters(counters);

      // Plexus IQ runtime hardening — step 8: opt-in micro-batch AI.
      // Default `PLEXUS_IQ_AI_BATCH_SIZE=1` skips this entirely and
      // every patient flows through `screenSinglePatientWithAI` as
      // before. When operators raise the env var, we pre-run the
      // failure-category pre-check (cheap, pure) to filter to AI-
      // eligible patients, then ask the model to qualify them in
      // groups of `aiBatchSize`. Results land in `aiResultCache` and
      // the per-patient callback below uses the cache instead of
      // making a single-patient call. Any micro-batch failure (parse
      // error, truncation, timeout) is logged + counted; those
      // patients silently fall through to the per-patient path so
      // the run completes safely.
      const aiResultCache = new Map<number, MicroBatchCacheEntry>();
      if (config.aiBatchSize > 1) {
        await runMicroBatchAi({
          chunkPatients,
          aiResultCache,
          mode: facilityQualMode,
          config,
          onFallback: (count: number) => {
            aiBatchFallbackTotal += count;
          },
        });
      }

      await batchProcess(
        chunkPatients,
        async (patient) => {
        // Plexus IQ runtime hardening — step 5: failure-category
        // pre-check. Patients with no clinical info or no demographic
        // info bypass the AI call and land in a category-specific
        // error state. The category lives in
        // `reasoning.__analysisFailure` (jsonb shape) so the status
        // endpoint can split missing-info from technical/AI failures.
        const pre = classifyPlexusIqPreCheck({
          id: patient.id,
          name: patient.name,
          dob: patient.dob,
          insurance: patient.insurance,
          diagnoses: patient.diagnoses,
          history: patient.history,
          medications: patient.medications,
        });
        if (!pre.ok) {
          await writeAnalysisFailure(patient.id, pre.failure);
          bumpFailureCounter(counters, pre.failure.category);
          return;
        }
        try {
          // Per-patient AI qualification. Each iteration here processes
          // exactly one patient through screenSinglePatientWithAI — no
          // batch-level AI call exists or is acceptable. The clinical
          // import fields (dob, insurance, previousTests, full notes
          // including MRN / row index / parser warnings) are
          // intentionally forwarded so each patient is evaluated on
          // their own full saved record.
          // Step 8: prefer the cached micro-batch result when present.
          // Cache miss (or aiBatchSize=1) keeps the legacy per-patient
          // call path. The cached shape is a normal AI result, so the
          // downstream persistence code is unchanged.
          const cached = aiResultCache.get(patient.id);
          const result = cached
            ? { patients: [cached] }
            : await screenSinglePatientWithAI(
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
          counters.processed += 1;
        } catch (error: unknown) {
          // Classify internally, but never persist or emit the provider message.
          const category = classifyCaughtError(error);
          errorPhiSafe({
            source: "batch_analysis",
            operation: "batch_analysis",
            outcome: "failed",
            category: category === "technical_failed"
              ? classifyLogSafeError(error)
              : "provider_error",
          });
          await writeAnalysisFailure(patient.id, {
            category,
            reason: SAFE_ANALYSIS_FAILURE_REASONS[category],
            failedAt: new Date().toISOString(),
          });
          bumpFailureCounter(counters, category);
        }
        await storage.incrementAnalysisJobProgress(jobId).catch(() => {});
      },
        { concurrency, retries: 3 },
      );

      // ── Chunk boundary: persist progress + ETA snapshot ───────────
      const chunkEnd = Date.now();
      const chunkAfter = snapshotCounters(counters);
      const chunkDelta = diffCounters(chunkAfter, chunkBefore);
      const lastPatient = chunkPatients[chunkPatients.length - 1];
      const entry: PlexusIqChunkEntry = {
        index: chunkIndex + 1,
        startedAt: new Date(chunkStart).toISOString(),
        endedAt: new Date(chunkEnd).toISOString(),
        size: chunkPatients.length,
        processed: chunkDelta.processed,
        failed: chunkDelta.failed,
      };
      chunkHistory.push(entry);
      while (chunkHistory.length > 50) chunkHistory.shift();

      const speed = computeThroughput(chunkHistory);
      const interimMetadata: PlexusIqJobMetadata = {
        schemaVersion: 1,
        targetPatientIds: eligibleIds,
        chunkSize,
        chunkIndex: chunkIndex + 1,
        totalChunks,
        cursorPatientId: lastPatient ? lastPatient.id : null,
        counters: {
          processed: counters.processed,
          skipped: initialSkipped,
          queued: Math.max(
            0,
            eligibleIds.length - counters.processed - counters.failed,
          ),
          failed: counters.failed,
          missingClinical: counters.missingClinical,
          missingDemographic: counters.missingDemographic,
          technicalFailed: counters.technicalFailed,
          aiError: counters.aiError,
        },
        chunkHistory,
        patientsPerMinute: speed.patientsPerMinute,
        etaSecondsRemaining: computeEtaSeconds(
          eligibleIds.length,
          counters.processed + counters.failed,
          speed.patientsPerMinute,
        ),
        rateLimitedCount: 0,
        aiBatchFallbackCount: aiBatchFallbackTotal,
        runtimeConfig: config,
      };
      await storage.updateAnalysisJob(jobId, {
        metadata: interimMetadata as unknown as Record<string, unknown>,
      });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(screeningBatches)
        .set({ status: "completed", patientCount: patients.length })
        .where(eq(screeningBatches.id, batchId));
    });
    // Plexus IQ runtime hardening — step 6: persist final counters
    // into metadata at terminal status so the status endpoint and any
    // post-run analytics get a stable readout.
    await storage.updateAnalysisJob(jobId, {
      status: "completed",
      completedAt: new Date(),
      metadata: buildTerminalMetadata({
        eligibleIds,
        initialSkipped,
        counters,
        chunkHistory,
        config,
      }) as unknown as Record<string, unknown>,
    });
    invalidatePatientDatabase();
  } catch (error: unknown) {
    errorPhiSafe({
      source: "batch_analysis",
      operation: "batch_analysis",
      outcome: "failed",
      category: classifyLogSafeError(error),
    });
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(screeningBatches)
          .set({ status: "error" })
          .where(eq(screeningBatches.id, batchId));
      });
    } catch {
      errorPhiSafe({
        source: "batch_analysis",
        operation: "batch_analysis",
        outcome: "db_failed",
        category: "shutdown_failure",
      });
    }
    try {
      const failedJob = await storage.getLatestAnalysisJobByBatch(batchId);
      if (failedJob && failedJob.status === "running") {
        await storage.updateAnalysisJob(failedJob.id, {
          status: "failed",
          errorMessage: "Analysis job failed",
          completedAt: new Date(),
          metadata: buildTerminalMetadata({
            eligibleIds,
            initialSkipped,
            counters,
          }) as unknown as Record<string, unknown>,
        });
      }
    } catch {
      errorPhiSafe({
        source: "batch_analysis",
        operation: "batch_analysis",
        outcome: "db_failed",
        category: "internal_error",
      });
    }
  }
}
