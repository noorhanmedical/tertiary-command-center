// Plexus IQ clinical-import — canned parity fixture (Bundle 6).
//
// Data-only fixture. NOT wired to any test runner in this bundle.
// Purpose: capture the exact 3-groups × 5-rows × 2-skips scenario
// described in docs/architecture/plexus-iq-route-parity-inventory.md §1
// so a future PIQ-3b.1 wrapper PR can assert byte-parity against
// concrete numbers (importedCount, skippedCount, batchIds.length,
// errors.length).
//
// IMPORTANT — protected scope:
//   - This file contains synthetic patient data ONLY. No real PHI.
//   - The names + DOBs are deterministic test sentinels; treating
//     them as PHI would be wrong (and would prevent the fixture from
//     being committed).
//   - The fixture exercises the row-parse path + the skip envelope
//     shape; it does NOT exercise qualification logic, AI calls,
//     batch resolution, MRN stamping, or DB writes. That stays the
//     wrapper PR's responsibility.
//
// Cross-reference:
//   - server/routes/plexusIqClinicalImport.ts (clinicalImportRowSchema
//     at ~line 71; bulk insert + reconciliation guard at ~lines 349-356)
//   - docs/architecture/plexus-iq-route-parity-inventory.md §1
//   - docs/architecture/canonical-workflow-wiring-map.md §1

/**
 * Synthetic clinical-import row matching the Zod-validated shape at
 * server/routes/plexusIqClinicalImport.ts:71.
 */
export type ClinicalImportFixtureRow = {
  facility?: string;
  scheduleDate?: string;
  patientType?: "visit" | "outreach";
  name: string;
  time?: string;
  dob?: string;
  age?: string;
  sex?: string;
  mrn?: string;
  phone?: string;
  email?: string;
  clinician?: string;
  dateAdded?: string;
  diagnoses?: string;
  history?: string;
  medications?: string;
  previousAncillaries?: string;
  insurance?: string;
  raw?: string;
  rowIndex?: number;
};

/**
 * The canned 3-groups × 5-rows × 2-skips fixture.
 *
 * Groups:
 *   - Group A: facility = "Bay Pavilion",       scheduleDate = "2026-06-15", 5 rows, 0 skips
 *   - Group B: facility = "Harbor Medical",     scheduleDate = "2026-06-16", 5 rows, 1 skip (row #3 — empty name)
 *   - Group C: facility = "Sandy Bay Center",   scheduleDate = "2026-06-17", 5 rows, 1 skip (row #4 — invalid scheduleDate)
 *
 * Each row carries a synthetic MRN, a synthetic name, and a synthetic
 * DOB. No real patient identifiers anywhere.
 */
export const CLINICAL_IMPORT_FIXTURE_ROWS: ClinicalImportFixtureRow[] = [
  // ── Group A — Bay Pavilion, 2026-06-15 (5 rows, 0 skips) ──────────
  { name: "Test Patient A1", dob: "1955-01-01", mrn: "MRN-A-001", facility: "Bay Pavilion",     scheduleDate: "2026-06-15", patientType: "visit", rowIndex: 0 },
  { name: "Test Patient A2", dob: "1956-02-02", mrn: "MRN-A-002", facility: "Bay Pavilion",     scheduleDate: "2026-06-15", patientType: "visit", rowIndex: 1 },
  { name: "Test Patient A3", dob: "1957-03-03", mrn: "MRN-A-003", facility: "Bay Pavilion",     scheduleDate: "2026-06-15", patientType: "visit", rowIndex: 2 },
  { name: "Test Patient A4", dob: "1958-04-04", mrn: "MRN-A-004", facility: "Bay Pavilion",     scheduleDate: "2026-06-15", patientType: "visit", rowIndex: 3 },
  { name: "Test Patient A5", dob: "1959-05-05", mrn: "MRN-A-005", facility: "Bay Pavilion",     scheduleDate: "2026-06-15", patientType: "visit", rowIndex: 4 },

  // ── Group B — Harbor Medical, 2026-06-16 (5 rows, 1 skip at idx 7) ─
  { name: "Test Patient B1", dob: "1960-06-06", mrn: "MRN-B-001", facility: "Harbor Medical",   scheduleDate: "2026-06-16", patientType: "visit", rowIndex: 5 },
  { name: "Test Patient B2", dob: "1961-07-07", mrn: "MRN-B-002", facility: "Harbor Medical",   scheduleDate: "2026-06-16", patientType: "visit", rowIndex: 6 },
  // Skip: empty name fails clinicalImportRowSchema (name.min(1)).
  { name: "",                 dob: "1962-08-08", mrn: "MRN-B-003", facility: "Harbor Medical",   scheduleDate: "2026-06-16", patientType: "visit", rowIndex: 7 },
  { name: "Test Patient B4", dob: "1963-09-09", mrn: "MRN-B-004", facility: "Harbor Medical",   scheduleDate: "2026-06-16", patientType: "visit", rowIndex: 8 },
  { name: "Test Patient B5", dob: "1964-10-10", mrn: "MRN-B-005", facility: "Harbor Medical",   scheduleDate: "2026-06-16", patientType: "visit", rowIndex: 9 },

  // ── Group C — Sandy Bay Center, 2026-06-17 (5 rows, 1 skip at idx 13) ─
  { name: "Test Patient C1", dob: "1965-11-11", mrn: "MRN-C-001", facility: "Sandy Bay Center", scheduleDate: "2026-06-17", patientType: "visit", rowIndex: 10 },
  { name: "Test Patient C2", dob: "1966-12-12", mrn: "MRN-C-002", facility: "Sandy Bay Center", scheduleDate: "2026-06-17", patientType: "visit", rowIndex: 11 },
  { name: "Test Patient C3", dob: "1967-01-13", mrn: "MRN-C-003", facility: "Sandy Bay Center", scheduleDate: "2026-06-17", patientType: "visit", rowIndex: 12 },
  // Skip: scheduleDate fails the YYYY-MM-DD regex (uses MM/DD/YYYY).
  { name: "Test Patient C4", dob: "1968-02-14", mrn: "MRN-C-004", facility: "Sandy Bay Center", scheduleDate: "06/17/2026",  patientType: "visit", rowIndex: 13 },
  { name: "Test Patient C5", dob: "1969-03-15", mrn: "MRN-C-005", facility: "Sandy Bay Center", scheduleDate: "2026-06-17", patientType: "visit", rowIndex: 14 },
];

/**
 * Expected outcome counts when the fixture is replayed against the
 * legacy POST /api/plexus-iq/clinical-import endpoint. A future
 * wrapper PR (PIQ-3b.1) asserts the new service produces the same
 * numbers.
 */
export const CLINICAL_IMPORT_FIXTURE_EXPECTED = {
  /** Rows that should reach the bulk-insert path. */
  importedCount: 13,
  /** Rows that should fail the row-level Zod validation or schema
   *  contract (empty name; bad scheduleDate). */
  skippedCount: 2,
  /** Number of (facility, scheduleDate) batch groups created or
   *  resolved. */
  batchIdsLength: 3,
  /** Per-row error envelopes returned to the client. */
  errorsLength: 2,
  /** The two rowIndex values that are expected to land in errors[]. */
  skipRowIndexes: [7, 13] as const,
} as const;

/**
 * Sanity-check the fixture itself at import time so a future edit
 * that breaks the totals fails loud at the test runner.
 */
{
  const totalRows = CLINICAL_IMPORT_FIXTURE_ROWS.length;
  const expectedTotal =
    CLINICAL_IMPORT_FIXTURE_EXPECTED.importedCount +
    CLINICAL_IMPORT_FIXTURE_EXPECTED.skippedCount;
  if (totalRows !== expectedTotal) {
    throw new Error(
      `[clinicalImport fixture] row count mismatch: ${totalRows} rows vs ${expectedTotal} expected ` +
        `(importedCount + skippedCount).`,
    );
  }
}
