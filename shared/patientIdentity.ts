// Patient identity helper — single source of truth for matching across
// Patient Directory, duplicate-warning engine, import preview, run
// comparison, engagement handoff, and audit lookup. Pure module, no
// runtime deps beyond standard JS. Lives in `shared/` so the same
// matcher runs on both client and server.

export type PatientIdentityInput = {
  name?: string | null;
  facility?: string | null;
  mrn?: string | null;
  dob?: string | null;
  phoneNumber?: string | null;
  phone?: string | null;
};

export type PatientIdentityKey = string;

export type PatientIdentityKeys = {
  facilityMrnDob: PatientIdentityKey | null;
  mrnDob: PatientIdentityKey | null;
  nameDobPhone: PatientIdentityKey | null;
};

export type PatientMatchTier =
  | "facility_mrn_dob"
  | "mrn_dob"
  | "name_dob_phone";

export type PatientMatchResult = {
  matched: boolean;
  tier: PatientMatchTier | null;
  score: number;
  matchedFields: ReadonlyArray<string>;
  reason: string;
};

export const PATIENT_MATCH_TIER_LABEL: Record<PatientMatchTier, string> = {
  facility_mrn_dob: "Facility + MRN + DOB",
  mrn_dob: "MRN + DOB",
  name_dob_phone: "Name + DOB + phone",
};

export const PATIENT_MATCH_TIER_SCORE: Record<PatientMatchTier, number> = {
  facility_mrn_dob: 100,
  mrn_dob: 80,
  name_dob_phone: 60,
};

export function normalizeName(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePhone(value: string | null | undefined): string {
  if (!value) return "";
  const digits = value.replace(/\D+/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export function normalizeDob(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  // Already ISO YYYY-MM-DD?
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // MM/DD/YYYY or M/D/YYYY?
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    let yyyy = us[3];
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    const mm = us[1].padStart(2, "0");
    const dd = us[2].padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime())) {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return "";
}

export function normalizeMrn(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/[\s\-_/.]+/g, "").toUpperCase();
}

export function normalizeFacility(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickPhone(input: PatientIdentityInput): string {
  return normalizePhone(input.phoneNumber ?? input.phone ?? null);
}

export function buildPatientIdentityKeys(input: PatientIdentityInput): PatientIdentityKeys {
  const facility = normalizeFacility(input.facility);
  const mrn = normalizeMrn(input.mrn);
  const dob = normalizeDob(input.dob);
  const name = normalizeName(input.name);
  const phone = pickPhone(input);

  return {
    facilityMrnDob: facility && mrn && dob ? `${facility}|${mrn}|${dob}` : null,
    mrnDob: mrn && dob ? `${mrn}|${dob}` : null,
    nameDobPhone: name && dob && phone ? `${name}|${dob}|${phone}` : null,
  };
}

export function matchPatientIdentity(
  left: PatientIdentityInput,
  right: PatientIdentityInput,
): PatientMatchResult {
  const lk = buildPatientIdentityKeys(left);
  const rk = buildPatientIdentityKeys(right);
  if (lk.facilityMrnDob && lk.facilityMrnDob === rk.facilityMrnDob) {
    return {
      matched: true,
      tier: "facility_mrn_dob",
      score: PATIENT_MATCH_TIER_SCORE.facility_mrn_dob,
      matchedFields: ["facility", "mrn", "dob"],
      reason: "Same facility, MRN, and DOB",
    };
  }
  if (lk.mrnDob && lk.mrnDob === rk.mrnDob) {
    return {
      matched: true,
      tier: "mrn_dob",
      score: PATIENT_MATCH_TIER_SCORE.mrn_dob,
      matchedFields: ["mrn", "dob"],
      reason: "Same MRN and DOB",
    };
  }
  if (lk.nameDobPhone && lk.nameDobPhone === rk.nameDobPhone) {
    return {
      matched: true,
      tier: "name_dob_phone",
      score: PATIENT_MATCH_TIER_SCORE.name_dob_phone,
      matchedFields: ["name", "dob", "phone"],
      reason: "Same name, DOB, and phone",
    };
  }
  return {
    matched: false,
    tier: null,
    score: 0,
    matchedFields: [],
    reason: "No identity overlap on facility+MRN+DOB, MRN+DOB, or name+DOB+phone",
  };
}

export function explainPatientMatch(result: PatientMatchResult): string {
  if (!result.matched || !result.tier) return result.reason;
  return `${PATIENT_MATCH_TIER_LABEL[result.tier]} — ${result.reason} (score ${result.score})`;
}

// Build an index keyed by every available identity key for a roster.
// Returns three maps so callers can probe by tier without re-walking.
export type PatientIdentityIndex<T> = {
  byFacilityMrnDob: Map<string, T>;
  byMrnDob: Map<string, T>;
  byNameDobPhone: Map<string, T>;
};

export function buildPatientIdentityIndex<T>(
  rows: ReadonlyArray<T>,
  inputOf: (row: T) => PatientIdentityInput,
): PatientIdentityIndex<T> {
  const idx: PatientIdentityIndex<T> = {
    byFacilityMrnDob: new Map(),
    byMrnDob: new Map(),
    byNameDobPhone: new Map(),
  };
  for (const row of rows) {
    const keys = buildPatientIdentityKeys(inputOf(row));
    if (keys.facilityMrnDob && !idx.byFacilityMrnDob.has(keys.facilityMrnDob)) {
      idx.byFacilityMrnDob.set(keys.facilityMrnDob, row);
    }
    if (keys.mrnDob && !idx.byMrnDob.has(keys.mrnDob)) {
      idx.byMrnDob.set(keys.mrnDob, row);
    }
    if (keys.nameDobPhone && !idx.byNameDobPhone.has(keys.nameDobPhone)) {
      idx.byNameDobPhone.set(keys.nameDobPhone, row);
    }
  }
  return idx;
}

export function lookupPatientInIndex<T>(
  index: PatientIdentityIndex<T>,
  input: PatientIdentityInput,
): { row: T; tier: PatientMatchTier } | null {
  const k = buildPatientIdentityKeys(input);
  if (k.facilityMrnDob) {
    const r = index.byFacilityMrnDob.get(k.facilityMrnDob);
    if (r) return { row: r, tier: "facility_mrn_dob" };
  }
  if (k.mrnDob) {
    const r = index.byMrnDob.get(k.mrnDob);
    if (r) return { row: r, tier: "mrn_dob" };
  }
  if (k.nameDobPhone) {
    const r = index.byNameDobPhone.get(k.nameDobPhone);
    if (r) return { row: r, tier: "name_dob_phone" };
  }
  return null;
}
