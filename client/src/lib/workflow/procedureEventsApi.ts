import { apiRequest } from "@/lib/queryClient";

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
  const res = await apiRequest("POST", "/api/procedure-events/complete", input);
  return res.json();
}
