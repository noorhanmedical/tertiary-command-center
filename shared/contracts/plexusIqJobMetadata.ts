// Plexus IQ runtime hardening — durable job metadata contract.
//
// Lives on analysis_jobs.metadata (jsonb). Both server (runner +
// status endpoint) and client (status payload type) read this same
// shape. Every field is optional so legacy jobs that pre-date the
// metadata column still parse as `{}`.

export type PlexusIqFailureCategory =
  | "missing_clinical"
  | "missing_demographic"
  | "technical_failed"
  | "ai_error";

export type PlexusIqChunkEntry = {
  /** 1-based chunk index. */
  index: number;
  /** ISO timestamp at chunk start. */
  startedAt: string;
  /** ISO timestamp at chunk end (omitted while in flight). */
  endedAt?: string;
  /** Number of patients in this chunk. */
  size: number;
  /** Number successfully processed (status flipped from draft/pending). */
  processed: number;
  /** Number that landed in `status='error'` during this chunk. */
  failed: number;
};

export type PlexusIqAiBatchFallbackEvent = {
  chunkIndex: number;
  /** Number of patients in the failing micro-batch. */
  size: number;
  reason: string;
  at: string;
};

export type PlexusIqRateLimitEvent = {
  chunkIndex: number;
  at: string;
  reason: string;
  /** Backoff in ms applied after this event. */
  backoffMs: number;
};

export type PlexusIqJobMetadata = {
  /** Schema version for this metadata blob — bump if shape changes. */
  schemaVersion?: 1;
  /**
   * Eligible patient ids the runner was given at job start. The runner
   * only processes ids in this list. Empty/missing = "use the
   * batch-wide draft+pending fallback".
   */
  targetPatientIds?: number[];
  chunkSize?: number;
  chunkIndex?: number;
  totalChunks?: number;
  /** Last patient id the runner has finished. Used for resume cursors. */
  cursorPatientId?: number | null;
  /** Counters. Sum should reconcile with totalPatients. */
  counters?: {
    processed?: number;
    skipped?: number;
    queued?: number;
    failed?: number;
    missingClinical?: number;
    missingDemographic?: number;
    technicalFailed?: number;
    aiError?: number;
  };
  /** Rolling chunk history (capped to last ~50 entries). */
  chunkHistory?: PlexusIqChunkEntry[];
  /** Computed at chunk boundaries for the status payload. */
  patientsPerMinute?: number;
  etaSecondsRemaining?: number;
  /** Total rate-limit events the runner saw across the job. */
  rateLimitedCount?: number;
  rateLimitEvents?: PlexusIqRateLimitEvent[];
  /** Total micro-batch parse-failure fallbacks across the job. */
  aiBatchFallbackCount?: number;
  aiBatchFallbackEvents?: PlexusIqAiBatchFallbackEvent[];
  /** Mirror of the env vars the runner started with — helps debugging. */
  runtimeConfig?: {
    concurrency: number;
    chunkSize: number;
    aiBatchSize: number;
    aiBatchFallbackEnabled: boolean;
    aiTimeoutMs: number;
    rateLimitRpm: number;
    rateLimitBurst: number;
    adaptiveBackoffEnabled: boolean;
  };
};

/** Shape stored on patient_screenings.reasoning when a patient fails. */
export type PlexusIqAnalysisFailure = {
  category: PlexusIqFailureCategory;
  reason: string;
  failedAt: string;
};

/** Public job-status shape returned by /api/plexus-iq/qualification-jobs/:id/status. */
export type PlexusIqQualificationJobStatusV2 = {
  ok: boolean;
  jobId: number;
  batchId: number;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  total: number;
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  skipped: number;
  // Per-category breakdown (failed = missingClinical + missingDemographic + technicalFailed + aiError).
  missingClinical: number;
  missingDemographic: number;
  technicalFailed: number;
  aiError: number;
  percent: number;
  // Throughput signals (omit if no chunks have completed yet).
  patientsPerMinute?: number;
  etaSecondsRemaining?: number;
  chunkIndex?: number;
  totalChunks?: number;
  currentChunkSize?: number;
  rateLimitedCount: number;
  aiBatchFallbackCount: number;
  startedAt?: string;
  completedAt?: string | null;
  errorMessage?: string | null;
  errors: Array<{
    patientId: number;
    patientName: string;
    error: string;
    category?: PlexusIqFailureCategory;
  }>;
};
