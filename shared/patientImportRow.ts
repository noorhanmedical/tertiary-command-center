// Canonical normalized patient import row — the ONE shape every intake path
// (large-file bulk AND small interactive paste) converges on before dedup and
// DB write. Keeping this in shared/ guarantees quick-import and bulk-import
// produce identical patient semantics. Field set mirrors the existing
// clinical-import wire schema so downstream mapping to `patient_screenings`
// is unchanged.

import type { CanonicalPatientField } from "./patientColumnMap";

export type NormalizedImportRow = {
  rowIndex: number;
  name: string;
  dob: string | null;
  gender: string | null;
  age: number | null;
  phone: string | null;
  email: string | null;
  insurance: string | null;
  mrn: string | null;
  facility: string | null;
  provider: string | null;
  diagnoses: string | null;
  medications: string | null;
  history: string | null;
  previousTests: string | null;
  notes: string | null;
  time: string | null;
  scheduleDate: string | null;
  patientType: "visit" | "outreach" | null;
  // Verbatim source row for traceability (bounded by the caller).
  raw: string | null;
};

export type RowValidation = {
  valid: boolean;
  reasons: string[];
};

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
};

/**
 * Build a canonical row from a raw cell array + a deterministic column mapping
 * (headerIndex → field). Combines firstName/lastName into `name`. Any field
 * not present in the mapping is left null. Pure + synchronous — no AI.
 */
export function buildNormalizedRow(
  cells: ReadonlyArray<unknown>,
  mapping: Record<number, CanonicalPatientField>,
  rowIndex: number,
  opts: { rawLine?: string | null; defaultFacility?: string | null } = {},
): NormalizedImportRow {
  const get = (field: CanonicalPatientField): string | null => {
    for (const [idxStr, f] of Object.entries(mapping)) {
      if (f === field) return str(cells[Number(idxStr)]);
    }
    return null;
  };

  let name = get("name");
  if (!name) {
    const first = get("firstName");
    const last = get("lastName");
    if (first || last) name = [first, last].filter(Boolean).join(" ").trim();
  }

  const ageRaw = get("age");
  const ageNum = ageRaw && /^\d{1,3}$/.test(ageRaw) ? parseInt(ageRaw, 10) : null;

  const ptRaw = (get("patientType") ?? "").toLowerCase();
  const patientType: "visit" | "outreach" | null =
    ptRaw.includes("outreach") ? "outreach" : ptRaw.includes("visit") ? "visit" : null;

  return {
    rowIndex,
    name: name ?? "",
    dob: get("dob"),
    gender: get("gender"),
    age: ageNum,
    phone: get("phone"),
    email: get("email"),
    insurance: get("insurance"),
    mrn: get("mrn"),
    facility: get("facility") ?? opts.defaultFacility ?? null,
    provider: get("provider"),
    diagnoses: get("diagnoses"),
    medications: get("medications"),
    history: get("history"),
    previousTests: get("previousTests"),
    notes: get("notes"),
    time: get("time"),
    scheduleDate: get("scheduleDate"),
    patientType,
    raw: opts.rawLine ?? null,
  };
}

const PROVIDER_CREDENTIAL_RE =
  /\b(D\.O\.|M\.D\.|NP-BC|NP-C|APRN|ARNP|PA-C|PA\b|RN\b|DO\b|MD\b|NP\b|Ph\.D\.)/i;

/**
 * Validate a normalized row for import eligibility. A row is INVALID when it
 * has no usable name, or the "name" is clearly a provider credential line
 * (not a patient). DOB is strongly encouraged (drives dedup) but not required
 * — its absence is surfaced as a warning reason, not a hard reject, matching
 * the existing lenient intake behavior.
 */
export function validateRow(row: NormalizedImportRow): RowValidation {
  const reasons: string[] = [];
  if (!row.name || row.name.trim().length < 2) {
    reasons.push("missing_name");
  } else if (PROVIDER_CREDENTIAL_RE.test(row.name)) {
    reasons.push("provider_name_not_patient");
  }
  const valid = reasons.length === 0;
  if (valid && !row.dob) reasons.push("missing_dob_warning");
  return { valid, reasons };
}
