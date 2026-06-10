// Patient Directory shadow-read parity fixture (Bundle 48).
//
// Data-only fixture. NOT wired to any runtime path. Pins the
// canonical-vs-legacy parity envelope a future Patient Directory
// shadow-read endpoint (per
// docs/architecture/patient-directory-shadow-read-contract.md, Bundle 20)
// MUST satisfy when both sides agree.
//
// SCOPE / SAFETY
//   - No PHI. Synthetic names (Greek-letter convention), synthetic
//     DOBs, 555- phone prefixes, @example.test emails, synthetic MRNs
//     prefixed `MRN-`.
//   - No DB, no app boot, no network.
//   - No Patient Directory runtime change.
//   - The fixture does NOT auto-merge canonical patients; it
//     enumerates the parity outcomes (match / drift / conflict /
//     not-resolvable) the future shadow-read MUST surface for human
//     review.
//
// CROSS-REFERENCES
//   patient-directory-design.md (Bundle 5 / PR #65)
//   patient-directory-shadow-read-contract.md (Bundle 20)
//   tests/fixtures/patientDirectoryEmrSourceLink.fixture.ts (Bundle 42)
//   server/modules/patient-directory/contracts.ts

import crypto from "node:crypto";

/**
 * Mirror of computeCanonicalPatientId from
 * server/modules/patient-directory/repo.ts. Inlined so the fixture
 * stays free of any Drizzle runtime dependency.
 */
function computeCanonicalPatientId(
  name: string | null | undefined,
  dob: string | null | undefined,
): string {
  const normalizedName = String(name ?? "").trim().toLowerCase();
  const normalizedDob = String(dob ?? "").trim();
  return crypto
    .createHash("sha256")
    .update(`${normalizedName}|${normalizedDob}`)
    .digest("hex");
}

/**
 * Slice of a patient_screenings row the shadow-read compares.
 * Synthetic-only. No real PHI fields.
 */
export type LegacyScreeningSliceFixture = {
  screeningId: number;
  name: string;
  dob: string | null;
  phoneNumber: string | null;
  email: string | null;
  facility: string | null;
  mrn: string | null;
  /** Optional external id from the EMR adapter when present. */
  externalPatientId: string | null;
  /** Whether the row is soft-deleted in the legacy table. */
  deletedAt: Date | null;
};

/**
 * Canonical patient view a future shadow-read would compute
 * from `getCanonicalPatientByScreeningId(id)`. Mirrors the
 * CanonicalPatient shape from
 * server/modules/patient-directory/contracts.ts.
 */
export type CanonicalPatientFixtureView = {
  id: string; // SHA-256 hex
  primaryScreeningId: number;
  screeningIds: number[];
  name: string;
  dob: string | null;
  phoneNumber: string | null;
  email: string | null;
  facility: string | null;
  totalScreenings: number;
  hasDeletedScreening: boolean;
};

/**
 * Parity verdict the shadow-read MUST emit per
 * Bundle 20 §4 / §5.
 */
export const SHADOW_READ_PARITY_VERDICTS = [
  "match",
  "drift_minor",
  "drift_major",
  "conflict",
  "not_resolvable",
] as const;
export type ShadowReadParityVerdict =
  (typeof SHADOW_READ_PARITY_VERDICTS)[number];

/**
 * A single shadow-read comparison row.
 */
export type ShadowReadParityFixtureRow = {
  caseId: string;
  legacy: LegacyScreeningSliceFixture;
  canonical: CanonicalPatientFixtureView;
  parityMatch: boolean;
  fieldsCompared: number;
  fieldsDivergent: number;
  verdict: ShadowReadParityVerdict;
  manualReviewRequired: boolean;
  conflictFlag: boolean;
};

// ─── Synthetic source rows ────────────────────────────────────────
const LEGACY_A: LegacyScreeningSliceFixture = {
  screeningId: 5001,
  name: "Alpha One",
  dob: "1980-01-15",
  phoneNumber: "555-0101",
  email: "alpha.one@example.test",
  facility: "Clinic A",
  mrn: "MRN-ALPHA-001",
  externalPatientId: "epic-ext-a-1",
  deletedAt: null,
};
const LEGACY_B: LegacyScreeningSliceFixture = {
  screeningId: 5010,
  name: "Beta Two",
  dob: "1985-06-21",
  phoneNumber: "555-0202",
  email: null,
  facility: "Clinic B",
  mrn: "MRN-BETA-010",
  externalPatientId: "athena-ext-b-1",
  deletedAt: null,
};
const LEGACY_C: LegacyScreeningSliceFixture = {
  screeningId: 5020,
  name: "Gamma Three",
  dob: null,
  phoneNumber: null,
  email: null,
  facility: null,
  mrn: null,
  externalPatientId: null,
  deletedAt: null,
};
const LEGACY_D: LegacyScreeningSliceFixture = {
  screeningId: 5030,
  name: "Delta Four",
  dob: "1990-12-01",
  phoneNumber: "555-0404",
  email: null,
  facility: "Clinic D",
  mrn: "MRN-DELTA-030",
  externalPatientId: "ecw-ext-d-1",
  deletedAt: new Date("2026-05-01T12:00:00Z"),
};
const LEGACY_E: LegacyScreeningSliceFixture = {
  screeningId: 5040,
  name: "Epsilon Five",
  dob: "1975-04-12",
  phoneNumber: "555-0505",
  email: null,
  facility: "Clinic E",
  mrn: "MRN-EPSILON-040",
  externalPatientId: "nextgen-ext-e-1",
  deletedAt: null,
};

function canonicalOf(legacy: LegacyScreeningSliceFixture): CanonicalPatientFixtureView {
  const id = computeCanonicalPatientId(legacy.name, legacy.dob);
  return {
    id,
    primaryScreeningId: legacy.screeningId,
    screeningIds: [legacy.screeningId],
    name: legacy.name,
    dob: legacy.dob,
    phoneNumber: legacy.phoneNumber,
    email: legacy.email,
    facility: legacy.facility,
    totalScreenings: 1,
    hasDeletedScreening: legacy.deletedAt !== null,
  };
}

// ─── Canned parity rows ───────────────────────────────────────────

/** Case 1 — Clean match. Both sides agree on every compared field. */
export const FIXTURE_CASE_MATCH: ShadowReadParityFixtureRow = {
  caseId: "case-match-1",
  legacy: LEGACY_A,
  canonical: canonicalOf(LEGACY_A),
  parityMatch: true,
  fieldsCompared: 5, // name, dob, phone, email, facility
  fieldsDivergent: 0,
  verdict: "match",
  manualReviewRequired: false,
  conflictFlag: false,
};

/**
 * Case 2 — Minor drift. The canonical row has a freshened
 * demographic (e.g. updated phone) that the legacy row lags
 * on. Shadow-read emits a `drift_minor` verdict; no manual
 * review required because the drift is in a non-identity field.
 */
export const FIXTURE_CASE_DRIFT_MINOR: ShadowReadParityFixtureRow = {
  caseId: "case-drift-minor-1",
  legacy: LEGACY_B,
  canonical: {
    ...canonicalOf(LEGACY_B),
    phoneNumber: "555-0299", // freshened phone
  },
  parityMatch: false,
  fieldsCompared: 5,
  fieldsDivergent: 1, // phone differs
  verdict: "drift_minor",
  manualReviewRequired: false,
  conflictFlag: false,
};

/**
 * Case 3 — Major drift. Facility differs. The shadow-read
 * MUST surface this for manual review because routing /
 * scheduling consequences depend on facility.
 */
export const FIXTURE_CASE_DRIFT_MAJOR: ShadowReadParityFixtureRow = {
  caseId: "case-drift-major-1",
  legacy: LEGACY_E,
  canonical: {
    ...canonicalOf(LEGACY_E),
    facility: "Clinic E Annex",
  },
  parityMatch: false,
  fieldsCompared: 5,
  fieldsDivergent: 1,
  verdict: "drift_major",
  manualReviewRequired: true,
  conflictFlag: false,
};

/**
 * Case 4 — Conflict. Canonical resolves to a DIFFERENT
 * canonical id (e.g. the canonical grouping merged this row
 * with another patient that shares lower(name) + dob, but the
 * downstream identity is contested). MUST flag for manual
 * reconciliation; NEVER auto-merge.
 */
export const FIXTURE_CASE_CONFLICT: ShadowReadParityFixtureRow = {
  caseId: "case-conflict-1",
  legacy: LEGACY_C,
  // Canonical view points to a different primary screening id
  // (5021) reflecting a possible merge candidate that disagrees.
  canonical: {
    ...canonicalOf(LEGACY_C),
    primaryScreeningId: 5021,
    screeningIds: [5021, 5020],
    totalScreenings: 2,
    hasDeletedScreening: false,
  },
  parityMatch: false,
  fieldsCompared: 5,
  fieldsDivergent: 0, // fields agree, but identity grouping differs
  verdict: "conflict",
  manualReviewRequired: true,
  conflictFlag: true,
};

/**
 * Case 5 — Not resolvable. The legacy row has been soft-deleted,
 * so the shadow-read cannot trust the comparison. Surfaces for
 * review but does NOT auto-merge.
 */
export const FIXTURE_CASE_NOT_RESOLVABLE: ShadowReadParityFixtureRow = {
  caseId: "case-not-resolvable-1",
  legacy: LEGACY_D,
  canonical: canonicalOf(LEGACY_D),
  parityMatch: false,
  fieldsCompared: 0, // skipped: legacy is soft-deleted
  fieldsDivergent: 0,
  verdict: "not_resolvable",
  manualReviewRequired: true,
  conflictFlag: false,
};

export const PATIENT_DIRECTORY_SHADOW_READ_FIXTURE_ROWS = [
  FIXTURE_CASE_MATCH,
  FIXTURE_CASE_DRIFT_MINOR,
  FIXTURE_CASE_DRIFT_MAJOR,
  FIXTURE_CASE_CONFLICT,
  FIXTURE_CASE_NOT_RESOLVABLE,
] as const;

// ─── Import-time sanity checks ────────────────────────────────────
{
  for (const row of PATIENT_DIRECTORY_SHADOW_READ_FIXTURE_ROWS) {
    if (
      !(SHADOW_READ_PARITY_VERDICTS as ReadonlyArray<string>).includes(row.verdict)
    ) {
      throw new Error(
        `[patient-directory shadow-read fixture] row ${row.caseId} unknown verdict "${row.verdict}"`,
      );
    }
    if (row.conflictFlag && !row.manualReviewRequired) {
      throw new Error(
        `[patient-directory shadow-read fixture] row ${row.caseId} has conflictFlag without manualReviewRequired`,
      );
    }
    // parityMatch must agree with fieldsDivergent === 0 AND verdict === match
    // for the "match" verdict. Other verdicts may have parityMatch=false.
    if (row.verdict === "match" && (!row.parityMatch || row.fieldsDivergent !== 0)) {
      throw new Error(
        `[patient-directory shadow-read fixture] row ${row.caseId} match-verdict must have parityMatch=true and fieldsDivergent=0`,
      );
    }
  }
}

/**
 * Pure verdict derivation for the shadow-read. Encodes the
 * decision rules a future engine MUST implement to map a
 * comparison output to the verdict enum.
 *
 * - identityIdMismatch → conflict (always manualReviewRequired).
 * - legacyDeleted → not_resolvable.
 * - fieldsDivergent === 0 AND ids agree → match.
 * - facility differs → drift_major (manualReviewRequired).
 * - otherwise → drift_minor (no manualReviewRequired by default).
 */
export type DeriveVerdictInput = {
  legacyDeleted: boolean;
  identityIdMismatch: boolean;
  facilityChanged: boolean;
  fieldsDivergent: number;
};
export type DeriveVerdictOutput = {
  verdict: ShadowReadParityVerdict;
  manualReviewRequired: boolean;
  conflictFlag: boolean;
};

export function deriveShadowReadVerdict_REFERENCE(
  input: DeriveVerdictInput,
): DeriveVerdictOutput {
  if (input.identityIdMismatch) {
    return { verdict: "conflict", manualReviewRequired: true, conflictFlag: true };
  }
  if (input.legacyDeleted) {
    return {
      verdict: "not_resolvable",
      manualReviewRequired: true,
      conflictFlag: false,
    };
  }
  if (input.fieldsDivergent === 0) {
    return { verdict: "match", manualReviewRequired: false, conflictFlag: false };
  }
  if (input.facilityChanged) {
    return {
      verdict: "drift_major",
      manualReviewRequired: true,
      conflictFlag: false,
    };
  }
  return {
    verdict: "drift_minor",
    manualReviewRequired: false,
    conflictFlag: false,
  };
}
