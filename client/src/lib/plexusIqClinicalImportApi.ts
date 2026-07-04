// Thin fetch helpers for the Plexus IQ clinical-import + qualification
// job endpoints. All routes are read-only on the existing schema (no
// new tables) and reuse the analysis_jobs row already created by the
// shared batchAnalysisRunner.

import type { PlexusIqClinicalImportRow } from "./plexusIqClinicalImportParser";

export type ClinicalImportRowPayload = Omit<
  PlexusIqClinicalImportRow,
  "raw"
> & { raw?: string };

/**
 * Plexus IQ runtime hardening — Routes step 1/4.
 *
 * Shared shape used by both `POST /api/plexus-iq/clinical-import` and
 * `POST /api/batches` to disambiguate Append vs New Run uploads/creates.
 *
 *   - `newRun` creates a fresh sibling batch for the facility/date.
 *   - `append` reuses an existing batch (when `targetBatchId` is set,
 *     that exact batch; otherwise Clinical Import falls back to find-
 *     or-create on facility + scheduleDate).
 */
export type PlexusIqBatchPlacement = {
  mode: "append" | "newRun";
  targetBatchId?: number;
};

/**
 * Plexus IQ runtime hardening — Routes step 4.
 *
 * When `startBatchAnalysis` trips the duplicate-job guard, the route
 * surfaces the existing job id so callers can pivot polling without
 * re-issuing the request.
 */
export type PlexusIqDuplicateJob = {
  existingJobId: number;
  existingStatus: string;
  reason: "running" | "overlapping_target";
};

export type ClinicalImportResponse = {
  ok: boolean;
  importedCount: number;
  skippedCount: number;
  errors: Array<{
    rowIndex: number;
    patientName?: string;
    reason: string;
    raw?: string;
  }>;
  batchIds: number[];
  patientIds: number[];
  batchPatientMap: Array<{
    batchId: number;
    patientIds: number[];
    facility: string;
    scheduleDate: string;
  }>;
  /**
   * Set on placement validation failures (invalid `targetBatchId`,
   * facility mismatch, date mismatch, or `targetBatchId` paired with a
   * multi-group upload). When present, `ok` is `false` and the import
   * was rejected before any patients were created.
   */
  error?: string;
  /**
   * Set on multi-group validation rejection so the UI can tell the
   * user "your paste spanned N facility/date groups; targetBatchId is
   * only valid for one."
   */
  groupCount?: number;
};

export type QualificationJobStartJob = {
  batchId: number;
  jobId: number;
  totalPatients: number;
  /**
   * Plexus IQ runtime hardening — Routes step 2. Surfaced verbatim
   * from `StartBatchAnalysisResult` so callers can render
   * "X eligible / Y skipped" without a second roundtrip.
   */
  eligibleCount?: number;
  skippedCount?: number;
  duplicate?: PlexusIqDuplicateJob;
};

export type QualificationJobStartResponse = {
  ok: boolean;
  jobId: number | null;
  jobs: QualificationJobStartJob[];
  errors: Array<{ batchId: number; reason: string }>;
};

/**
 * Plexus IQ runtime hardening — Routes step 3.
 *
 * Retry-failed has three terminal shapes:
 *   - happy path:        `{ ok: true, jobId, totalPatients, retryableCount, ... }`
 *   - zero failed:       `{ ok: false, jobId: null, retryableCount: 0, reason }`
 *   - duplicate trip:    `{ ok: false, jobId: null, retryableCount, duplicate, reason }`
 *
 * Modeled as one flat shape so callers can branch on `ok` and treat
 * the rest as optional metadata.
 */
export type RetryQualificationJobFailedResponse = {
  ok: boolean;
  jobId: number | null;
  totalPatients?: number;
  retryableCount: number;
  eligibleCount?: number;
  skippedCount?: number;
  duplicate?: PlexusIqDuplicateJob;
  reason?: string;
};

export type QualificationJobStatus = {
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
  percent: number;
  startedAt?: string;
  completedAt?: string | null;
  errorMessage?: string | null;
  errors: Array<{
    patientId: number;
    patientName: string;
    error: string;
    /**
     * Plexus IQ runtime hardening — per-row failure category.
     * Sourced from `reasoning.__analysisFailure.category` when present.
     * Legacy rows (pre-hardening) omit this and the UI renders a generic
     * "Analysis failed" pill rather than an invented bucket.
     */
    category?:
      | "missing_clinical"
      | "missing_demographic"
      | "technical_failed"
      | "ai_error";
  }>;
  /**
   * Plexus IQ runtime hardening — runner steps 6/7/8 metadata readout.
   *
   * All fields are optional because the server status endpoint reads
   * them out of `analysis_jobs.metadata` only when the runner has
   * persisted them. Older jobs (pre-hardening) will not have any of
   * these set; the UI should treat each as missing-by-default.
   */
  chunkIndex?: number;
  totalChunks?: number;
  patientsPerMinute?: number;
  etaSecondsRemaining?: number;
  rateLimitedCount?: number;
  aiBatchFallbackCount?: number;
  /** Failure-bucket counters from runner step 5. */
  missingClinicalCount?: number;
  missingDemographicCount?: number;
  technicalFailedCount?: number;
  aiErrorCount?: number;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid JSON from ${url} (status ${res.status})`);
  }
  if (!res.ok) {
    const errMsg =
      (parsed as { error?: string })?.error ?? `Request failed (${res.status})`;
    throw new Error(errMsg);
  }
  return parsed as T;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error ?? "";
    } catch {
      /* noop */
    }
    throw new Error(`Request failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  return (await res.json()) as T;
}

export async function importPlexusIqClinicalRows(
  rows: ClinicalImportRowPayload[],
  defaults: {
    facility?: string;
    scheduleDate?: string;
    patientType?: "visit" | "outreach";
    // Plexus IQ runtime hardening — Routes step 1.
    // Optional. When omitted the server defaults to `append`
    // (preserves today's find-or-create on facility + scheduleDate).
    placement?: PlexusIqBatchPlacement;
  } = {},
): Promise<ClinicalImportResponse> {
  return postJson<ClinicalImportResponse>("/api/plexus-iq/clinical-import", {
    rows,
    defaultFacility: defaults.facility,
    defaultScheduleDate: defaults.scheduleDate,
    defaultPatientType: defaults.patientType,
    placement: defaults.placement,
  });
}

export async function startPlexusIqQualificationJob(input: {
  batchIds?: number[];
  patientIds?: number[];
  retryFailed?: boolean;
  // Plexus IQ runtime hardening — Routes step 2.
  // Optional patient-status filter. Server runner default is
  // `['draft','pending']` (skip completed); pass `['error']` to retry
  // only failed, or omit to let the runner pick the default.
  statuses?: string[];
}): Promise<QualificationJobStartResponse> {
  return postJson<QualificationJobStartResponse>(
    "/api/plexus-iq/qualification-jobs",
    input,
  );
}

export async function fetchPlexusIqQualificationJobStatus(
  jobId: number,
): Promise<QualificationJobStatus> {
  return getJson<QualificationJobStatus>(
    `/api/plexus-iq/qualification-jobs/${jobId}/status`,
  );
}

export async function retryPlexusIqQualificationJobFailed(
  jobId: number,
): Promise<RetryQualificationJobFailedResponse> {
  return postJson<RetryQualificationJobFailedResponse>(
    `/api/plexus-iq/qualification-jobs/${jobId}/retry-failed`,
    {},
  );
}
