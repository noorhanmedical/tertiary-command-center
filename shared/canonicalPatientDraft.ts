// Canonical patient draft — the ONE shape every patient source (manual form,
// smart paste, bulk import, Plexus IQ) converges on before identity resolution
// and canonical persistence. Pure module (no runtime deps beyond the shared
// identity/normalization helpers) so client and server agree on the draft.
//
// A draft is NOT a persisted patient. It is the normalized, human-reviewable
// intermediate produced by normalization and consumed by the canonical write
// service. Provenance travels with the draft but never becomes identity.

import type { PatientIdentityInput } from "./patientIdentity";

export const PATIENT_SOURCE_TYPES = [
  "manual",
  "manual_paste",
  "bulk_import",
  "plexus_iq",
  "api",
  "emr_import",
] as const;
export type PatientSourceType = (typeof PATIENT_SOURCE_TYPES)[number];

/** Canonical demographic + clinical draft. All fields optional except name. */
export type CanonicalPatientDraft = {
  name: string;
  dob?: string | null;
  gender?: string | null;
  age?: number | null;
  phoneNumber?: string | null;
  email?: string | null;
  address?: string | null;
  mrn?: string | null;
  /** Distinct external/source patient identifier (NEVER the MRN). Persisted as
   *  an external identifier, not a patient_screenings column. */
  patientId?: string | null;
  insurance?: string | null;
  memberId?: string | null;
  facility?: string | null;
  provider?: string | null;
  diagnoses?: string | null;
  medications?: string | null;
  history?: string | null;
  allergies?: string | null;
  notes?: string | null;
  patientType?: "visit" | "outreach" | null;
};

/** A partial patch of a draft where any field may be explicitly nulled. */
export type PatientDraftPatch = { [K in keyof CanonicalPatientDraft]?: CanonicalPatientDraft[K] | null };

/** Provenance travels with a create; it records WHERE a draft came from
 *  without ever participating in identity. */
export type PatientProvenance = {
  sourceType: PatientSourceType;
  clinicId?: number | null;
  facility?: string | null;
  createdByUserId?: string | null;
  importJobId?: number | null;
  importRowIndex?: number | null;
  batchId?: number | null;
  sourceSystem?: string | null;
};

/** Fields whose change can alter identity resolution — an update touching any
 *  of these MUST rerun duplicate/collision resolution before persisting. */
export const IDENTITY_SENSITIVE_FIELDS = ["name", "dob", "mrn", "phoneNumber", "facility"] as const;
export type IdentitySensitiveField = (typeof IDENTITY_SENSITIVE_FIELDS)[number];

export function isIdentitySensitiveChange(changed: ReadonlyArray<string>): boolean {
  return changed.some((f) => (IDENTITY_SENSITIVE_FIELDS as readonly string[]).includes(f));
}

/** Project a draft onto the identity matcher input (shared/patientIdentity). */
export function draftToIdentityInput(draft: CanonicalPatientDraft): PatientIdentityInput {
  return {
    name: draft.name,
    dob: draft.dob ?? null,
    mrn: draft.mrn ?? null,
    facility: draft.facility ?? null,
    phoneNumber: draft.phoneNumber ?? null,
  };
}

const s = (v: unknown): string | null => {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length > 0 ? t : null;
};

/**
 * SHARED core patient_screenings insert-value builder. THE single place that
 * maps a canonical draft + provenance to the columns written to
 * patient_screenings. Every source (manual, paste, bulk, IQ) builds its insert
 * through this so the core write semantics + provenance can never drift. Pure;
 * callers may spread source-specific columns (e.g. previousTests, appointment
 * status) on top. Facility precedence: explicit provenance facility (already
 * resolved to canonical) wins over the draft's raw facility.
 */
export function buildScreeningInsertValues(
  draft: CanonicalPatientDraft,
  prov: {
    batchId: number;
    sourceType: PatientSourceType;
    clinicId?: number | null;
    facility?: string | null;
    importJobId?: number | null;
    importRowIndex?: number | null;
    isTest?: boolean;
    patientTypeDefault?: "visit" | "outreach";
  },
): Record<string, unknown> {
  return {
    batchId: prov.batchId,
    clinicId: prov.clinicId ?? undefined,
    name: draft.name,
    dob: draft.dob ?? undefined,
    gender: draft.gender ?? undefined,
    age: draft.age ?? undefined,
    phoneNumber: draft.phoneNumber ?? undefined,
    email: draft.email ?? undefined,
    mrn: draft.mrn ?? undefined,
    insurance: draft.insurance ?? undefined,
    facility: prov.facility ?? draft.facility ?? undefined,
    diagnoses: draft.diagnoses ?? undefined,
    medications: draft.medications ?? undefined,
    history: draft.history ?? undefined,
    notes: draft.notes ?? undefined,
    patientType: (draft.patientType ?? prov.patientTypeDefault ?? "visit") as "visit" | "outreach",
    status: "draft",
    commitStatus: "Draft",
    sourceType: prov.sourceType,
    importJobId: prov.importJobId ?? undefined,
    importRowIndex: prov.importRowIndex ?? undefined,
    isTest: prov.isTest ?? undefined,
  };
}

/** Normalize a raw/partial draft: trim strings, fold empties to null, combine
 *  first/last into name when name is absent. Never invents values. */
export function normalizePatientDraft(raw: Record<string, unknown>): CanonicalPatientDraft {
  let name = s(raw.name);
  if (!name) {
    const first = s(raw.firstName);
    const last = s(raw.lastName);
    if (first || last) name = [first, last].filter(Boolean).join(" ");
  }
  const ptRaw = (s(raw.patientType) ?? "").toLowerCase();
  const patientType: "visit" | "outreach" | null =
    ptRaw.includes("outreach") ? "outreach" : ptRaw.includes("visit") ? "visit" : null;
  return {
    name: name ?? "",
    dob: s(raw.dob),
    gender: s(raw.gender),
    age: typeof raw.age === "number" && Number.isFinite(raw.age) ? raw.age : null,
    phoneNumber: s(raw.phoneNumber),
    email: s(raw.email),
    address: s(raw.address),
    mrn: s(raw.mrn),
    patientId: s(raw.patientId),
    insurance: s(raw.insurance),
    memberId: s(raw.memberId),
    facility: s(raw.facility),
    provider: s(raw.provider),
    diagnoses: s(raw.diagnoses),
    medications: s(raw.medications),
    history: s(raw.history),
    allergies: s(raw.allergies),
    notes: s(raw.notes),
    patientType,
  };
}
