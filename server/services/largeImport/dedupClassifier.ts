// Dedup / identity classification for large-file patient ingestion.
//
// Before Plexus writes any imported patient it must know whether that person
// already exists in the canonical current identity model — otherwise a bulk
// import silently creates duplicate patients and (once approved) duplicate
// engagement journeys. This module reuses the SINGLE canonical matcher in
// shared/patientIdentity.ts (facility+MRN+DOB > MRN+DOB > name+DOB+phone). It
// does NOT invent a new identity system.
//
// Classification per incoming row:
//   INVALID        — fails validateRow (no usable name / provider line)
//   EXISTING_MATCH — deterministic match to an existing patient (facility+MRN+
//                    DOB or MRN+DOB). Safe to reuse; do NOT create a duplicate.
//   POSSIBLE_MATCH — weaker overlap (name+DOB+phone) OR an intra-file duplicate.
//                    Surface for review; never auto-merge.
//   NEW            — no match anywhere.

// PURE module — no DB imports, so classification logic is unit-testable in
// isolation. The DB-backed existing-patient index loader lives in
// ./existingIdentityIndex.ts.
import {
  buildPatientIdentityKeys,
  lookupPatientInIndex,
  type PatientIdentityIndex,
  type PatientIdentityInput,
  type PatientMatchTier,
} from "@shared/patientIdentity";
import { validateRow, type NormalizedImportRow } from "@shared/patientImportRow";

export type RowClassification = "NEW" | "EXISTING_MATCH" | "POSSIBLE_MATCH" | "INVALID";

export type ClassifiedRow = {
  row: NormalizedImportRow;
  classification: RowClassification;
  matchTier: PatientMatchTier | null;
  matchedScreeningId: number | null;
  reasons: string[];
};

export type ExistingPatientRef = {
  id: number;
  name: string;
  dob: string | null;
  mrn: string | null;
  facility: string | null;
  phone: string | null;
};

export const identityInputOfExisting = (p: ExistingPatientRef): PatientIdentityInput => ({
  name: p.name,
  dob: p.dob,
  mrn: p.mrn,
  facility: p.facility,
  phoneNumber: p.phone,
});

const identityInputOfRow = (r: NormalizedImportRow): PatientIdentityInput => ({
  name: r.name,
  dob: r.dob,
  mrn: r.mrn,
  facility: r.facility,
  phoneNumber: r.phone,
});

/**
 * Classify a batch of normalized rows against the existing index AND against
 * each other (intra-file duplicates → POSSIBLE_MATCH so the manager sees them,
 * and the writer collapses them). Pure aside from the injected index; no I/O.
 */
export function classifyRows(
  rows: ReadonlyArray<NormalizedImportRow>,
  existingIndex: PatientIdentityIndex<ExistingPatientRef>,
): ClassifiedRow[] {
  // Track keys seen earlier in THIS file to flag intra-file duplicates.
  const seen = new Set<string>();
  const out: ClassifiedRow[] = [];

  for (const row of rows) {
    const validation = validateRow(row);
    if (!validation.valid) {
      out.push({
        row,
        classification: "INVALID",
        matchTier: null,
        matchedScreeningId: null,
        reasons: validation.reasons,
      });
      continue;
    }

    const input = identityInputOfRow(row);
    const hit = lookupPatientInIndex(existingIndex, input);
    if (hit) {
      const deterministic = hit.tier === "facility_mrn_dob" || hit.tier === "mrn_dob";
      out.push({
        row,
        classification: deterministic ? "EXISTING_MATCH" : "POSSIBLE_MATCH",
        matchTier: hit.tier,
        matchedScreeningId: hit.row.id,
        reasons: deterministic ? ["existing_patient"] : ["weak_match_review"],
      });
      continue;
    }

    // Intra-file duplicate detection (strongest available key for the row).
    const keys = buildPatientIdentityKeys(input);
    const dupKey = keys.facilityMrnDob ?? keys.mrnDob ?? keys.nameDobPhone;
    if (dupKey && seen.has(dupKey)) {
      out.push({
        row,
        classification: "POSSIBLE_MATCH",
        matchTier: null,
        matchedScreeningId: null,
        reasons: ["duplicate_within_file"],
      });
      continue;
    }
    if (dupKey) seen.add(dupKey);

    out.push({
      row,
      classification: "NEW",
      matchTier: null,
      matchedScreeningId: null,
      reasons: validation.reasons, // may carry missing_dob_warning
    });
  }

  return out;
}

// Wire shape of a preview row. `patientId` (external/source id) is ALWAYS
// carried distinctly from `mrn` — never folded together (see patientColumnMap).
export type PreviewRowShape = {
  rowIndex: number;
  name: string;
  dob: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  mrn: string | null;
  patientId: string | null;
  facility: string | null;
  provider: string | null;
  insurance: string | null;
  diagnoses: string | null;
  medications: string | null;
  history: string | null;
  classification: ClassifiedRow["classification"];
  matchTier: ClassifiedRow["matchTier"];
  reasons: string[];
};

/**
 * Map a classified row to the preview wire shape. Pure (no DB) so it is shared
 * by the analyze-phase preview builder, the paginated preview route, and the
 * unit tests. Preserves BOTH mrn and the distinct external patientId.
 */
export function toPreviewRow(cr: ClassifiedRow): PreviewRowShape {
  return {
    rowIndex: cr.row.rowIndex,
    name: cr.row.name,
    dob: cr.row.dob,
    gender: cr.row.gender,
    phone: cr.row.phone,
    email: cr.row.email,
    mrn: cr.row.mrn,
    // External/source Patient ID — ALWAYS distinct from MRN.
    patientId: cr.row.patientId ?? null,
    facility: cr.row.facility,
    provider: cr.row.provider,
    insurance: cr.row.insurance,
    diagnoses: cr.row.diagnoses,
    medications: cr.row.medications,
    history: cr.row.history,
    classification: cr.classification,
    matchTier: cr.matchTier,
    reasons: cr.reasons,
  };
}

export type ClassificationCounts = {
  total: number;
  valid: number;
  invalid: number;
  duplicate: number;
  new: number;
  existing: number;
  possible: number;
};

export function tallyClassifications(rows: ReadonlyArray<ClassifiedRow>): ClassificationCounts {
  const c: ClassificationCounts = { total: 0, valid: 0, invalid: 0, duplicate: 0, new: 0, existing: 0, possible: 0 };
  for (const r of rows) {
    c.total += 1;
    if (r.classification === "INVALID") { c.invalid += 1; continue; }
    c.valid += 1;
    if (r.classification === "NEW") c.new += 1;
    else if (r.classification === "EXISTING_MATCH") c.existing += 1;
    else if (r.classification === "POSSIBLE_MATCH") {
      c.possible += 1;
      if (r.reasons.includes("duplicate_within_file")) c.duplicate += 1;
    }
  }
  return c;
}
