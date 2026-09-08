import { requestJson } from "@/lib/workflow/safeFetch";

export type ProcedureCompleteInput = {
  serviceType: string;
  executionCaseId?: number | null;
  patientScreeningId?: number | null;
  globalScheduleEventId?: number | null;
  patientName?: string | null;
  patientDob?: string | null;
  facilityId?: string | null;
  note?: string | null;
  completedAt?: string | null;
};

export type ProcedureCompleteResponse = {
  procedureEvent: {
    id: number;
    procedureStatus: string;
    serviceType: string;
    completedAt: string | null;
  } & Record<string, unknown>;
  documentReadinessRows: Array<Record<string, unknown>>;
};

export async function markProcedureCompleteApi(
  input: ProcedureCompleteInput,
): Promise<ProcedureCompleteResponse> {
  return requestJson<ProcedureCompleteResponse>(
    "POST",
    "/api/procedure-events/complete",
    input,
  );
}

// ── Procedure events (clinic-scoped reads) ──────────────────────────────────

export type ProcedureEventDto = {
  id: number;
  serviceType: string;
  procedureStatus: string;
  completedAt: string | null;
  ancillaryCaseId: number | null;
  executionCaseId: number | null;
  patientScreeningId: number | null;
} & Record<string, unknown>;

/** List procedure events for a case (clinic-scoped). Used by the ACS Procedure
 *  card to resolve the canonical event + its status. */
export async function listProcedureEventsApi(params: {
  executionCaseId?: number | null;
  patientScreeningId?: number | null;
  serviceType?: string | null;
}): Promise<ProcedureEventDto[]> {
  const qs = new URLSearchParams();
  if (params.executionCaseId != null) qs.set("executionCaseId", String(params.executionCaseId));
  if (params.patientScreeningId != null) qs.set("patientScreeningId", String(params.patientScreeningId));
  if (params.serviceType) qs.set("serviceType", params.serviceType);
  const rows = await requestJson<ProcedureEventDto[]>("GET", `/api/procedure-events?${qs.toString()}`);
  return Array.isArray(rows) ? rows : [];
}

// ── Procedure component evidence (BrainWave / VitalWave) ─────────────────────

/** The structured component payload stored on procedure_events.metadata.
 *  Each component is { performed, completedAt? }; EEG additionally carries an
 *  optional channelCount. The shape is validated server-side against
 *  shared/schema/procedureComponents. */
export type ComponentEntry = { performed: boolean; completedAt?: string; channelCount?: number };
export type ProcedureComponentsPayload = Record<string, ComponentEntry>;

export type LoadedComponents = {
  procedureEventId: number;
  serviceType: string;
  components: { service: "brainwave" | "vitalwave"; components: ProcedureComponentsPayload } | null;
};

export async function getProcedureComponentsApi(procedureEventId: number): Promise<LoadedComponents> {
  return requestJson<LoadedComponents>("GET", `/api/procedure-events/${procedureEventId}/components`);
}

export type SaveComponentsResponse = { status: string; noteReconciliation?: string };

export async function saveProcedureComponentsApi(
  procedureEventId: number,
  components: ProcedureComponentsPayload,
): Promise<SaveComponentsResponse> {
  return requestJson<SaveComponentsResponse>(
    "POST",
    `/api/procedure-events/${procedureEventId}/components`,
    { components },
  );
}
