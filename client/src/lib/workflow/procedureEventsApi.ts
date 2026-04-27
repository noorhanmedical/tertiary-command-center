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
