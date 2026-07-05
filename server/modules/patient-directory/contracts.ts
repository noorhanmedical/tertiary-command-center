// Patient EHR — type contracts.
//
// "Patient EHR" is the future canonical source of truth for patient
// identity. Today identity is duplicated across ~15 tables, anchored by
// patient_screenings (which is a Plexus IQ episode, not a person).
//
// This batch (Batch 5) introduces READ-ONLY helpers that compute the
// canonical view from the existing patient_screenings rows, grouped by
// (lower(name), dob). It does NOT add a new database table, run a
// migration, or rename any existing column. Future batches (5a-5z) will
// stage the actual table introduction; for now, every caller that asks
// "who is this patient, canonically?" can resolve the question against
// the same helper, and switching the helper's backing store later is a
// one-line change.
//
// See server/modules/patient-directory/repo.ts for the canonical-key
// computation and docs/architecture/patient-directory-design.md for the
// rationale + future-table DDL + cutover plan.

/**
 * The canonical patient identifier.
 *
 * Computed deterministically from (lower(trim(name)), dob). The id is a
 * SHA-256 hex digest, NOT a database row id. Future batches will replace
 * this with a real `patient_directory.id` value once the table exists; the
 * deterministic derivation lets us decouple consumers from that change.
 */
export type CanonicalPatientId = string;

/**
 * The canonical view of a patient, computed from one or more
 * patient_screenings rows that share (lower(name), dob).
 *
 * `screeningIds` is the list of patient_screenings.id rows that contributed
 * to this canonical identity. The "primary" screening (the freshest)
 * carries the latest demographic snapshot used by `name`, `dob`, `email`,
 * `phone`, `facility`.
 */
export type CanonicalPatient = {
  // Deterministic hash of (lower(trim(name)), dob). Never a row id.
  id: CanonicalPatientId;
  // Primary screening row that fed the latest demographic snapshot.
  primaryScreeningId: number;
  // All patient_screenings.id rows currently mapped to this canonical
  // patient. Sorted descending by id (newest first).
  screeningIds: number[];
  // Demographics from the freshest screening row.
  name: string;
  dob: string | null;
  phoneNumber: string | null;
  email: string | null;
  facility: string | null;
  // Counts derived from the screenings.
  totalScreenings: number;
  // True iff at least one screening has been soft-deleted (`deletedAt` is
  // set on that row). Useful for the future merge-review UI.
  hasDeletedScreening: boolean;
};

/**
 * Filters for listing canonical patients.
 *
 * `facility`: matches `patient_screenings.facility` of the PRIMARY screening
 * row (the freshest one mapped to a given canonical identity). A patient
 * whose freshest screening is at clinic A but who also has older screenings
 * at clinic B will only match `facility: "A"`. This matches the rendering
 * convention used by routes/patientDatabase.ts for the existing roster.
 *
 * `limit` / `offset` are clamped server-side (default 100, max 500).
 */
export type ListCanonicalPatientsFilters = {
  facility?: string;
  limit?: number;
  offset?: number;
};
