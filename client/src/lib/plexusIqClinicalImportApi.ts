// Thin fetch helpers for the Plexus IQ clinical-import + qualification
// job endpoints. All routes are read-only on the existing schema (no
// new tables) and reuse the analysis_jobs row already created by the
// shared batchAnalysisRunner.

import type { PlexusIqClinicalImportRow } from "./plexusIqClinicalImportParser";

export type ClinicalImportRowPayload = Omit<
  PlexusIqClinicalImportRow,
  "raw"
> & { raw?: string };

export type ClinicalImportResponse = {
  ok: boolean;
  importedCount: number;
  skippedCount: number;
  errors: Array<{ rowIndex: number; reason: string }>;
  batchIds: number[];
  patientIds: number[];
  batchPatientMap: Array<{
    batchId: number;
    patientIds: number[];
    facility: string;
    scheduleDate: string;
  }>;
};

export type QualificationJobStartResponse = {
  ok: boolean;
  jobId: number | null;
  jobs: Array<{ batchId: number; jobId: number; totalPatients: number }>;
  errors: Array<{ batchId: number; reason: string }>;
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
  errors: Array<{ patientId: number; patientName: string; error: string }>;
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
  } = {},
): Promise<ClinicalImportResponse> {
  return postJson<ClinicalImportResponse>("/api/plexus-iq/clinical-import", {
    rows,
    defaultFacility: defaults.facility,
    defaultScheduleDate: defaults.scheduleDate,
    defaultPatientType: defaults.patientType,
  });
}

export async function startPlexusIqQualificationJob(input: {
  batchIds?: number[];
  patientIds?: number[];
  retryFailed?: boolean;
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
): Promise<{ ok: boolean; jobId: number; totalPatients: number }> {
  return postJson<{ ok: boolean; jobId: number; totalPatients: number }>(
    `/api/plexus-iq/qualification-jobs/${jobId}/retry-failed`,
    {},
  );
}
