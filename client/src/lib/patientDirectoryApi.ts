// Patient Directory client API helper (Batch D).
//
// Thin typed wrappers over the server routes added in Batch C. Every
// helper returns a typed shape or throws a typed error so call sites
// can render fallback UI cleanly. Uses the existing apiRequest helper
// (no new dependencies).

import { apiRequest } from "@/lib/queryClient";
import type { PatientIdentityInput } from "../../../shared/patientIdentity";
import type { PatientDirectoryEvent } from "@/lib/patientDirectoryAuditTypes";

export type SearchHit = {
  patientScreeningId: number;
  name: string;
  facility: string | null;
  dob: string | null;
  phoneNumber: string | null;
  mrn: string | null;
};

export type DirectorySnapshot = {
  profile: {
    patientScreeningId: number;
    identity: {
      name: string;
      facility: string | null;
      mrn: string | null;
      dob: string | null;
      phoneNumber: string | null;
      email: string | null;
      insurance: string | null;
    };
    patientType: string;
    adminApprovalStatus: string;
    adminApprovedAt: string | null;
    adminApprovedByUserId: string | null;
    createdAt: string;
    source: {
      batchId: number;
      batchName: string | null;
      batchCreatedAt: string;
      sourceFileName: string | null;
    };
  };
  engagement: {
    currentAssignmentId: number | null;
    currentAssignmentStatus: string | null;
    currentAssignedTo: string | null;
    lastEngagementUpdate: string | null;
  };
  callHistory: ReadonlyArray<{
    id: number;
    startedAt: string;
    outcome: string;
    notes: string | null;
    callbackAt: string | null;
    attemptNumber: number | null;
    durationSeconds: number | null;
  }>;
  cooldown: {
    active: boolean;
    intervalLabel: string;
    startsAt: string | null;
    endsAt: string | null;
    reason: string | null;
    setByUserId: string | null;
  } | null;
  priorTests: ReadonlyArray<{
    testName: string;
    dateOfService: string | null;
    facility: string | null;
    source: string | null;
    notes: string | null;
  }>;
  events: ReadonlyArray<PatientDirectoryEvent>;
  flags: {
    doNotContact: boolean;
    doNotContactReason: string | null;
    everSentToEngagement: boolean;
    everAdminApproved: boolean;
  };
};

export type DuplicateFacts = {
  sentToEngagement: Array<{ patientScreeningId: number; identity: PatientIdentityInput; sentAt: string | null }>;
  doNotContact: Array<{ patientScreeningId: number; identity: PatientIdentityInput; reason: string | null; setAt: string | null }>;
  cooldowns: Array<{ patientScreeningId: number; identity: PatientIdentityInput; active: boolean; endsAt: string | null; reason: string | null }>;
  priorTests: Array<{ identity: PatientIdentityInput; testName: string; dateOfService: string | null; facility: string | null }>;
};

async function jsonOrFail<T>(res: Response, fallback: T | null = null): Promise<T | null> {
  if (res.status === 404 || res.status === 501) return fallback;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

// ── search ─────────────────────────────────────────────────────────────
export async function searchPatientDirectory(q: string, limit = 50): Promise<ReadonlyArray<SearchHit>> {
  const res = await fetch(`/api/patient-directory/search?q=${encodeURIComponent(q)}&limit=${limit}`, { credentials: "include" });
  const body = await jsonOrFail<{ rows: SearchHit[] }>(res, { rows: [] });
  return body?.rows ?? [];
}

export type DocumentSearchHit = {
  id: number;
  title: string;
  kind: string;
  filename: string;
  facility: string | null;
  contentType: string;
  downloadUrl: string;
};

export async function searchDocumentLibrary(q: string, limit = 25): Promise<ReadonlyArray<DocumentSearchHit>> {
  const res = await fetch(`/api/documents-library/search?q=${encodeURIComponent(q)}&limit=${limit}`, { credentials: "include" });
  const body = await jsonOrFail<{ rows: DocumentSearchHit[] }>(res, { rows: [] });
  return body?.rows ?? [];
}

export type BillingSearchHit = {
  id: number;
  patientName: string;
  service: string;
  facility: string | null;
  dateOfService: string | null;
  mrn: string | null;
  billingStatus: string | null;
};

export async function searchBillingRecords(q: string, limit = 25): Promise<ReadonlyArray<BillingSearchHit>> {
  const res = await fetch(`/api/billing-records/search?q=${encodeURIComponent(q)}&limit=${limit}`, { credentials: "include" });
  const body = await jsonOrFail<{ rows: BillingSearchHit[] }>(res, { rows: [] });
  return body?.rows ?? [];
}

// ── snapshot / audit / restrictions / prior tests ─────────────────────
export async function getPatientDirectorySnapshot(id: number): Promise<DirectorySnapshot | null> {
  const res = await fetch(`/api/patient-directory/${id}`, { credentials: "include" });
  return (await jsonOrFail<DirectorySnapshot>(res, null));
}

export async function getPatientDirectoryAudit(id: number): Promise<ReadonlyArray<PatientDirectoryEvent>> {
  const res = await fetch(`/api/patient-directory/${id}/audit`, { credentials: "include" });
  const body = await jsonOrFail<{ events: PatientDirectoryEvent[] }>(res, { events: [] });
  return body?.events ?? [];
}

export async function getPatientDirectoryRestrictions(id: number): Promise<{
  doNotContact: boolean;
  doNotContactReason: string | null;
  cooldown: DirectorySnapshot["cooldown"];
} | null> {
  const res = await fetch(`/api/patient-directory/${id}/contact-restrictions`, { credentials: "include" });
  return (await jsonOrFail(res, null));
}

export async function getPatientDirectoryPriorTests(id: number): Promise<ReadonlyArray<DirectorySnapshot["priorTests"][number]>> {
  const res = await fetch(`/api/patient-directory/${id}/prior-tests`, { credentials: "include" });
  const body = await jsonOrFail<{ tests: DirectorySnapshot["priorTests"] }>(res, { tests: [] });
  return body?.tests ?? [];
}

// ── create / update ────────────────────────────────────────────────────
export type CreatePatientInput = {
  name: string;
  dob: string;
  batchId: number;
  facility?: string | null;
  mrn?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  insurance?: string | null;
  notes?: string | null;
  patientType?: "visit" | "outreach";
};

export async function createPatientDirectoryProfile(input: CreatePatientInput): Promise<{ patientScreeningId: number }> {
  const res = await apiRequest("POST", "/api/patient-directory", input);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}

export async function updatePatientDirectoryProfile(id: number, patch: Partial<CreatePatientInput>): Promise<void> {
  const res = await apiRequest("PATCH", `/api/patient-directory/${id}`, patch);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
}

// ── import preview / confirm ───────────────────────────────────────────
export type ImportPreviewRequest = {
  format: "csv" | "txt";
  text: string;
  facts?: unknown; // ImportPreviewFacts shape (loose to keep API forward-compatible)
};

export async function importPreview(req: ImportPreviewRequest): Promise<{ rows: ReadonlyArray<unknown> }> {
  const res = await apiRequest("POST", "/api/patient-directory/import-preview", req);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}

export type ImportConfirmRequest = {
  batchId: number;
  selected: Array<{ identity: PatientIdentityInput; patientType?: "visit" | "outreach" }>;
};

export async function importConfirm(req: ImportConfirmRequest): Promise<{ createdIds: number[] }> {
  const res = await apiRequest("POST", "/api/patient-directory/import-confirm", req);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}

// ── prior tests ────────────────────────────────────────────────────────
export type AddPriorTestRequest = {
  patientName: string;
  testName: string;
  dateOfService?: string | null;
  facility?: string | null;
  source?: string | null;
  notes?: string | null;
};

export async function addPriorTest(id: number, input: AddPriorTestRequest): Promise<void> {
  const res = await apiRequest("POST", `/api/patient-directory/${id}/prior-tests`, input);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
}

// ── DNC / cooldown ─────────────────────────────────────────────────────
export async function setDoNotContact(id: number, reason: string | null): Promise<void> {
  const res = await apiRequest("POST", `/api/patient-directory/${id}/contact-restrictions`, { action: "set", reason });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
}

export async function clearDoNotContact(id: number): Promise<void> {
  const res = await apiRequest("POST", `/api/patient-directory/${id}/contact-restrictions`, { action: "clear" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
}

export async function setCooldown(id: number, endsAt: string, reason: string | null): Promise<void> {
  const res = await apiRequest("POST", `/api/patient-directory/${id}/cooldown`, { action: "set", endsAt, reason });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
}

export async function clearCooldown(id: number): Promise<void> {
  const res = await apiRequest("POST", `/api/patient-directory/${id}/cooldown`, { action: "clear" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
}

// ── audit events (write) ───────────────────────────────────────────────
export async function logPatientDirectoryEvent(
  id: number,
  kind: string,
  payload?: Record<string, unknown>,
  sourceModule?: string,
): Promise<void> {
  const res = await apiRequest("POST", `/api/patient-directory/${id}/events`, { kind, payload, sourceModule });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
}

// ── duplicate-warning facts ────────────────────────────────────────────
export type DuplicateFactsTarget = { patientScreeningId: number; identity: PatientIdentityInput };

export async function fetchDuplicateWarningFacts(
  targets: ReadonlyArray<DuplicateFactsTarget>,
): Promise<DuplicateFacts> {
  if (targets.length === 0) return { sentToEngagement: [], doNotContact: [], cooldowns: [], priorTests: [] };
  const res = await apiRequest("POST", "/api/patient-directory/duplicate-warning-facts", { targets });
  if (!res.ok) {
    // Endpoint may not be registered yet (activation flag OFF).
    if (res.status === 404) return { sentToEngagement: [], doNotContact: [], cooldowns: [], priorTests: [] };
    throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/** True if the activation routes are reachable (the duplicate-facts endpoint exists). */
export async function isPatientDirectoryActivationReachable(): Promise<boolean> {
  try {
    const res = await apiRequest("POST", "/api/patient-directory/duplicate-warning-facts", { targets: [] });
    return res.ok;
  } catch {
    return false;
  }
}
