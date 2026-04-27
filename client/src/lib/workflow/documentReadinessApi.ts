import { apiRequest } from "@/lib/queryClient";

export type CaseDocumentReadiness = {
  id: number;
  executionCaseId: number | null;
  patientScreeningId: number | null;
  patientName: string | null;
  patientDob: string | null;
  facilityId: string | null;
  serviceType: string;
  documentType: string;
  documentStatus: string;
  documentId: number | null;
  storageKey: string | null;
  blocksBilling: boolean;
  generatedByAi: boolean;
  uploadedByUserId: string | null;
  completedAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type CaseDocumentReadinessFilters = {
  executionCaseId?: number;
  patientScreeningId?: number;
  facilityId?: string;
  serviceType?: string;
  documentType?: string;
  documentStatus?: string;
  blocksBilling?: boolean;
  limit?: number;
};

function buildQuery(filters: CaseDocumentReadinessFilters): string {
  const params = new URLSearchParams();
  if (filters.executionCaseId != null) params.set("executionCaseId", String(filters.executionCaseId));
  if (filters.patientScreeningId != null) params.set("patientScreeningId", String(filters.patientScreeningId));
  if (filters.facilityId) params.set("facilityId", filters.facilityId);
  if (filters.serviceType) params.set("serviceType", filters.serviceType);
  if (filters.documentType) params.set("documentType", filters.documentType);
  if (filters.documentStatus) params.set("documentStatus", filters.documentStatus);
  if (filters.blocksBilling !== undefined) params.set("blocksBilling", String(filters.blocksBilling));
  if (filters.limit != null) params.set("limit", String(filters.limit));
  return params.toString();
}

export function caseDocumentReadinessQueryKey(filters: CaseDocumentReadinessFilters): string[] {
  return ["/api/case-document-readiness", buildQuery(filters)];
}

export async function fetchCaseDocumentReadiness(
  filters: CaseDocumentReadinessFilters = {},
): Promise<CaseDocumentReadiness[]> {
  const qs = buildQuery(filters);
  const res = await apiRequest("GET", `/api/case-document-readiness${qs ? `?${qs}` : ""}`);
  return res.json();
}

export type ProcedureNote = {
  id: number;
  executionCaseId: number | null;
  patientScreeningId: number | null;
  procedureEventId: number | null;
  serviceType: string;
  noteType: string;
  generationStatus: string;
  generatedText: string | null;
  generatedByAi: boolean;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProcedureNotesFilters = {
  executionCaseId?: number;
  patientScreeningId?: number;
  procedureEventId?: number;
  serviceType?: string;
  noteType?: string;
  generationStatus?: string;
  limit?: number;
};

function buildNoteQuery(filters: ProcedureNotesFilters): string {
  const params = new URLSearchParams();
  if (filters.executionCaseId != null) params.set("executionCaseId", String(filters.executionCaseId));
  if (filters.patientScreeningId != null) params.set("patientScreeningId", String(filters.patientScreeningId));
  if (filters.procedureEventId != null) params.set("procedureEventId", String(filters.procedureEventId));
  if (filters.serviceType) params.set("serviceType", filters.serviceType);
  if (filters.noteType) params.set("noteType", filters.noteType);
  if (filters.generationStatus) params.set("generationStatus", filters.generationStatus);
  if (filters.limit != null) params.set("limit", String(filters.limit));
  return params.toString();
}

export function procedureNotesQueryKey(filters: ProcedureNotesFilters): string[] {
  return ["/api/procedure-notes", buildNoteQuery(filters)];
}

export async function fetchProcedureNotes(
  filters: ProcedureNotesFilters = {},
): Promise<ProcedureNote[]> {
  const qs = buildNoteQuery(filters);
  const res = await apiRequest("GET", `/api/procedure-notes${qs ? `?${qs}` : ""}`);
  return res.json();
}
