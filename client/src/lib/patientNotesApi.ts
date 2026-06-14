// patientNotesApi — Phase 2 PR 2.6
//
// Thin client over /api/patient-notes.

export type PatientNoteType =
  | "quick_note"
  | "call_note"
  | "acs_note"
  | "admin_note"
  | "system_note";

export type PatientNoteRow = {
  id: number;
  patientScreeningId: number;
  executionCaseId: number | null;
  noteType: PatientNoteType;
  body: string;
  authorUserId: string | null;
  isInternal: boolean;
  metadata: Record<string, unknown>;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchPatientNotes(filters: {
  patientScreeningId?: number;
  executionCaseId?: number;
  noteType?: PatientNoteType;
  includeArchived?: boolean;
  limit?: number;
} = {}): Promise<PatientNoteRow[]> {
  const qs = new URLSearchParams();
  if (filters.patientScreeningId != null) qs.set("patientScreeningId", String(filters.patientScreeningId));
  if (filters.executionCaseId != null) qs.set("executionCaseId", String(filters.executionCaseId));
  if (filters.noteType) qs.set("noteType", filters.noteType);
  if (filters.includeArchived) qs.set("includeArchived", "true");
  if (filters.limit != null) qs.set("limit", String(filters.limit));
  const res = await fetch(`/api/patient-notes${qs.toString() ? `?${qs}` : ""}`, { credentials: "include" });
  return jsonOrThrow<PatientNoteRow[]>(res);
}

export async function createPatientNote(input: {
  patientScreeningId: number;
  executionCaseId?: number | null;
  noteType?: PatientNoteType;
  body: string;
  isInternal?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<PatientNoteRow> {
  const res = await fetch("/api/patient-notes", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<PatientNoteRow>(res);
}

export async function archivePatientNote(id: number): Promise<PatientNoteRow> {
  const res = await fetch(`/api/patient-notes/${id}/archive`, {
    method: "PATCH",
    credentials: "include",
  });
  return jsonOrThrow<PatientNoteRow>(res);
}
