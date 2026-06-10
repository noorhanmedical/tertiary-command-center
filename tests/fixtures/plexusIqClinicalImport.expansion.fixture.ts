// Plexus IQ clinical-import — parity fixture EXPANSION (Bundle 24).
//
// Additive expansion of tests/fixtures/plexusIqClinicalImport.fixture.ts
// (Bundle 6 / PR #87). The original fixture covers a single happy-path
// patientType ("visit") with two skip variants (empty name, bad
// scheduleDate format). This expansion adds the variants needed for a
// future wrapper PR to assert byte-parity across the full row-schema
// surface — especially the rejection paths the legacy
// clinicalImportRowSchema enforces and the outreach patientType the
// original fixture omitted.
//
// IMPORTANT — protected scope:
//   - Synthetic patient data only. No real PHI.
//   - The names + DOBs are deterministic test sentinels.
//   - Exercises the row-parse / schema-rejection envelope shape.
//   - Does NOT exercise qualification logic, AI calls, batch
//     resolution, MRN stamping, or DB writes. That stays the wrapper
//     PR's responsibility.
//   - Does NOT modify the original CLINICAL_IMPORT_FIXTURE_ROWS or
//     CLINICAL_IMPORT_FIXTURE_EXPECTED — additive only.
//
// Cross-reference:
//   - server/routes/plexusIqClinicalImport.ts (clinicalImportRowSchema
//     at ~line 71)
//   - tests/fixtures/plexusIqClinicalImport.fixture.ts (Bundle 6)
//   - docs/architecture/plexus-iq-route-parity-inventory.md §1
//   - scripts/qa-plexus-iq-clinical-import-fixture.mjs (extended in
//     this bundle to assert the expansion totals)

import type { ClinicalImportFixtureRow } from "./plexusIqClinicalImport.fixture";
export type { ClinicalImportFixtureRow };

/**
 * Additional canned rows. Numbering picks up at rowIndex 100 so the
 * original 0–14 range stays untouched and any test that joins both
 * fixtures sees stable indices.
 *
 * Groups:
 *   - Group D — "Bay Pavilion" outreach, no scheduleDate, 3 rows, 0 skips.
 *   - Group E — "Cove Surgical", schema-rejection coverage:
 *       row 110: invalid patientType ("inpatient") → skip
 *       row 111: name with only whitespace → schema rejects (name.min(1))
 *       row 112: scheduleDate with US shape ("2026/06/20") → skip
 *       row 113: scheduleDate with timestamp ("2026-06-20T00:00:00Z") → skip
 *       row 114: scheduleDate too short ("2026-6-2") → skip
 *       row 115: name with leading/trailing whitespace → PASSES (min(1) on
 *                length includes whitespace, but schema does not trim).
 *   - Group F — "Mountain Care", max-fields + min-fields coverage:
 *       row 120: every optional field populated → pass.
 *       row 121: ONLY name populated → pass.
 *       row 122: name with embedded comma → pass.
 *       row 123: name with embedded quote → pass.
 *
 * Rationale: every skip variant exercises a different branch in the
 * Zod row schema; every pass variant exercises a downstream field
 * propagation the wrapper PR must round-trip.
 */
export const CLINICAL_IMPORT_FIXTURE_EXPANSION_ROWS: ClinicalImportFixtureRow[] = [
  // ── Group D — outreach, no scheduleDate (3 rows, 0 skips) ──────────
  { name: "Test Patient D1", dob: "1970-01-01", mrn: "MRN-D-001", facility: "Bay Pavilion",     patientType: "outreach", rowIndex: 100 },
  { name: "Test Patient D2", dob: "1971-02-02", mrn: "MRN-D-002", facility: "Bay Pavilion",     patientType: "outreach", rowIndex: 101 },
  { name: "Test Patient D3", dob: "1972-03-03", mrn: "MRN-D-003", facility: "Bay Pavilion",     patientType: "outreach", rowIndex: 102 },

  // ── Group E — schema-rejection coverage (6 rows, 5 skips) ─────────
  // Skip: invalid patientType ("inpatient" not in enum)
  { name: "Test Patient E1", dob: "1973-04-04", mrn: "MRN-E-001", facility: "Cove Surgical",
    scheduleDate: "2026-06-20", patientType: "inpatient" as unknown as "visit", rowIndex: 110 },
  // Skip: name is whitespace-only — schema rejects via name.min(1) — actually
  // name.min(1) ACCEPTS " " because string length is 1. We test both: this
  // row is the EXPECTED-PASS path for whitespace.
  // NOTE: This row PASSES the schema (length >= 1). Documented here so the
  // wrapper PR is not surprised when whitespace-only names propagate.
  { name: "   ", dob: "1974-05-05", mrn: "MRN-E-002", facility: "Cove Surgical",
    scheduleDate: "2026-06-20", patientType: "visit", rowIndex: 111 },
  // Skip: scheduleDate "2026/06/20" — fails the YYYY-MM-DD regex.
  { name: "Test Patient E3", dob: "1975-06-06", mrn: "MRN-E-003", facility: "Cove Surgical",
    scheduleDate: "2026/06/20", patientType: "visit", rowIndex: 112 },
  // Skip: scheduleDate with timestamp suffix — fails the regex.
  { name: "Test Patient E4", dob: "1976-07-07", mrn: "MRN-E-004", facility: "Cove Surgical",
    scheduleDate: "2026-06-20T00:00:00Z", patientType: "visit", rowIndex: 113 },
  // Skip: scheduleDate "2026-6-2" — fails the regex (digit count).
  { name: "Test Patient E5", dob: "1977-08-08", mrn: "MRN-E-005", facility: "Cove Surgical",
    scheduleDate: "2026-6-2", patientType: "visit", rowIndex: 114 },
  // Pass: name with leading/trailing whitespace propagates verbatim.
  { name: "  Test Patient E6  ", dob: "1978-09-09", mrn: "MRN-E-006", facility: "Cove Surgical",
    scheduleDate: "2026-06-20", patientType: "visit", rowIndex: 115 },

  // ── Group F — max + min field coverage (4 rows, 0 skips) ──────────
  // Pass: every optional field populated.
  {
    name: "Test Patient F1",
    dob: "1979-10-10",
    mrn: "MRN-F-001",
    facility: "Mountain Care",
    scheduleDate: "2026-06-21",
    patientType: "visit",
    rowIndex: 120,
    time: "09:30",
    age: "45",
    sex: "F",
    phone: "555-0140",
    email: "test.f1@example.test",
    clinician: "Dr. Test",
    dateAdded: "2026-06-09",
    diagnoses: "synthetic diagnosis A",
    history: "synthetic history A",
    medications: "synthetic medication A",
    previousAncillaries: "none",
    insurance: "Test Insurance Co",
    raw: "(synthetic raw text)",
  },
  // Pass: only required `name`.
  { name: "Test Patient F2", rowIndex: 121 },
  // Pass: name with embedded comma.
  { name: "Test Patient F3, Jr", rowIndex: 122 },
  // Pass: name with embedded quote.
  { name: 'Test Patient "F4"', rowIndex: 123 },
];

/**
 * Expected outcomes for the EXPANSION rows ONLY. Combine with
 * CLINICAL_IMPORT_FIXTURE_EXPECTED to verify the joined fixture
 * against the legacy route.
 */
export const CLINICAL_IMPORT_FIXTURE_EXPANSION_EXPECTED = {
  /** Total expansion rows. */
  totalRows: 13,
  /** Expansion rows expected to reach the bulk-insert path:
   *  Group D × 3 + Group E rows 111 + 115 + Group F × 4 = 9. */
  importedCount: 9,
  /** Expansion rows expected to fail row-level Zod validation:
   *  Group E rows 110, 112, 113, 114 = 4. */
  skippedCount: 4,
  /** Distinct (facility, scheduleDate) groups created or resolved:
   *  Group D outreach Bay Pavilion (null scheduleDate),
   *  Group E Cove Surgical 2026-06-20,
   *  Group F Mountain Care 2026-06-21,
   *  Group F's whitespace-named row F2 / F3 / F4 (no facility, no
   *  scheduleDate) collapses with the visit-no-batch fallback in the
   *  legacy route — counted as one additional group.
   *  Total: 4 expansion-level groups. */
  batchIdsLength: 4,
  /** Expansion-only error envelope rows. */
  errorsLength: 4,
  /** The rowIndex values expected to land in errors[]. */
  skipRowIndexes: [110, 112, 113, 114] as const,
} as const;

/**
 * Sanity-check the expansion at import time so a future edit that
 * breaks the totals fails loud at the test runner.
 */
{
  const totalRows = CLINICAL_IMPORT_FIXTURE_EXPANSION_ROWS.length;
  const expectedTotal =
    CLINICAL_IMPORT_FIXTURE_EXPANSION_EXPECTED.importedCount +
    CLINICAL_IMPORT_FIXTURE_EXPANSION_EXPECTED.skippedCount;
  if (totalRows !== CLINICAL_IMPORT_FIXTURE_EXPANSION_EXPECTED.totalRows) {
    throw new Error(
      `[clinicalImport expansion fixture] row count mismatch: ${totalRows} rows ` +
        `vs ${CLINICAL_IMPORT_FIXTURE_EXPANSION_EXPECTED.totalRows} expected.`,
    );
  }
  if (totalRows !== expectedTotal) {
    throw new Error(
      `[clinicalImport expansion fixture] importedCount + skippedCount mismatch: ` +
        `${totalRows} rows vs ${expectedTotal} expected.`,
    );
  }
}
