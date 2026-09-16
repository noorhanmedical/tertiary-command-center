// Chunked, idempotent DB writer for large-file patient ingestion.
//
// Writes classified rows into the canonical `patient_screenings` in bounded
// chunks (default 500), each chunk in its own transaction, so a 15k import is
// never one enormous transaction and never thousands of single-row round trips.
//
// IDEMPOTENCY: every inserted row is stamped with (import_job_id,
// import_row_index), which is UNIQUE (partial). Inserts use
// onConflictDoNothing, so re-running a chunk after a crash cannot create a
// duplicate patient for the same source row — a retry safely continues.
//
// Only NEW rows (and manager-confirmed POSSIBLE rows) are written. EXISTING
// matches are skipped entirely so we never create a duplicate patient, reset
// call history, or start a second engagement journey for someone already here.

import { db } from "../../db";
import { patientScreenings } from "@shared/schema";
import { featureFlags } from "../../lib/featureFlags";
import { resolveAndLinkPlexusIdentityForScreeningsBulk } from "../plexusIdentity/screeningIntegration";
import { buildScreeningInsertValues } from "@shared/canonicalPatientDraft";
import { isRowImportable, type ImportRowDecisionLike, type PreviewClassification } from "@shared/patientImportPreview";
import type { ClassifiedRow } from "./dedupClassifier";

export const DEFAULT_CHUNK_SIZE = 500;

export type WriteOptions = {
  importJobId: number;
  batchId: number;
  clinicId: number | null;
  chunkSize?: number;
  isTest?: boolean;
  // Manager resolutions for POSSIBLE_MATCH rows, keyed by source rowIndex.
  // NEW rows are always written. A POSSIBLE_MATCH row is written ONLY when its
  // decision is "import_as_new"; "use_existing"/"skip"/unresolved are excluded
  // (unresolved possible matches are NEVER auto-imported).
  decisions?: Map<number, { decision: string }>;
  // Resume cursor: skip rows whose source rowIndex is <= this (already done).
  fromRowIndex?: number;
  // Progress callback fired after each committed chunk.
  onChunk?: (progress: {
    processed: number;
    inserted: number;
    totalToWrite: number;
    lastRowIndex: number;
  }) => Promise<void> | void;
};

export type WriteResult = {
  attempted: number;
  inserted: number;
  skippedExisting: number;
  skippedInvalid: number;
  // Rows the manager explicitly removed from THIS preview (per-row "skip"
  // decision). Excluded regardless of classification — never written, never
  // deletes anything already in the DB.
  skippedRemoved: number;
  lastRowIndex: number;
};

// Bulk import builds its insert through the SAME shared core builder as manual /
// paste (buildScreeningInsertValues) so the core write semantics + provenance
// can never drift. Bulk-specific columns (previousTests, appointmentStatus,
// bulk patientType default) are layered on top — legitimate specialized
// orchestration, not a reimplementation of core insert semantics.
function toInsertValues(cr: ClassifiedRow, opts: WriteOptions) {
  const r = cr.row;
  const core = buildScreeningInsertValues(
    {
      name: r.name, dob: r.dob, gender: r.gender, age: r.age, phoneNumber: r.phone,
      email: r.email, mrn: r.mrn, insurance: r.insurance, facility: r.facility,
      diagnoses: r.diagnoses, medications: r.medications, history: r.history, notes: r.notes,
      patientType: r.patientType,
    },
    {
      batchId: opts.batchId,
      sourceType: "bulk_import",
      clinicId: opts.clinicId ?? null,
      importJobId: opts.importJobId,
      importRowIndex: r.rowIndex,
      isTest: opts.isTest ?? false,
      patientTypeDefault: "outreach",
    },
  );
  return { ...core, previousTests: r.previousTests ?? undefined, appointmentStatus: "pending" as const };
}

/**
 * Write the eligible classified rows in chunks. Returns aggregate counts. Each
 * chunk is committed independently; a thrown error leaves prior chunks durably
 * written and the caller's cursor advanced, so a retry resumes cleanly.
 */
export async function writeClassifiedRows(
  rows: ReadonlyArray<ClassifiedRow>,
  opts: WriteOptions,
): Promise<WriteResult> {
  const chunkSize = Math.max(1, Math.min(2000, opts.chunkSize ?? DEFAULT_CHUNK_SIZE));
  const fromRowIndex = opts.fromRowIndex ?? 0;

  const result: WriteResult = {
    attempted: 0,
    inserted: 0,
    skippedExisting: 0,
    skippedInvalid: 0,
    skippedRemoved: 0,
    lastRowIndex: fromRowIndex,
  };

  // Determine the eligible set (NEW + optionally POSSIBLE), excluding rows
  // already processed (<= cursor) and non-writable classifications.
  const eligible: ClassifiedRow[] = [];
  for (const cr of rows) {
    if (cr.row.rowIndex <= fromRowIndex) continue;
    const decision = (opts.decisions?.get(cr.row.rowIndex)?.decision ?? undefined) as ImportRowDecisionLike;
    // Manager removed this row from the preview (Remove Selected / Remove
    // Invalid). A persisted "skip" decision excludes the row REGARDLESS of
    // classification, so a removed NEW row is never written. This only affects
    // the current import — no existing patient/screening/identity is touched.
    if (decision === "skip") { result.skippedRemoved += 1; continue; }
    // Ready-only import semantics live in one shared predicate so the client
    // preview, the writer, and the tests can never disagree.
    if (!isRowImportable(cr.classification as PreviewClassification, decision)) {
      if (cr.classification === "INVALID") result.skippedInvalid += 1;
      else result.skippedExisting += 1;
      continue;
    }
    eligible.push(cr);
  }

  const totalToWrite = eligible.length;
  let processed = 0;

  for (let i = 0; i < eligible.length; i += chunkSize) {
    const slice = eligible.slice(i, i + chunkSize);
    const values = slice.map((cr) => toInsertValues(cr, opts));

    // One transaction per chunk. onConflictDoNothing on the partial unique
    // (import_job_id, import_row_index) makes re-processing a chunk a no-op.
    const insertedRows = await db.transaction(async (tx) => {
      return tx
        .insert(patientScreenings)
        .values(values as never)
        .onConflictDoNothing()
        .returning({ id: patientScreenings.id, importRowIndex: patientScreenings.importRowIndex });
    });

    // Converge on canonical identity: link each newly-inserted screening to the
    // global identity registry (reuse-or-create). Flag-gated inside the helper
    // (zero cost when FEATURE_PLEXUS_IDENTITY_WRITE is OFF, the default) — this
    // closes the one bulk path that previously never linked identity at all.
    if (featureFlags.plexusIdentityWrite && insertedRows.length > 0) {
      const byRow = new Map(slice.map((cr) => [cr.row.rowIndex, cr.row]));
      await resolveAndLinkPlexusIdentityForScreeningsBulk(
        insertedRows
          .filter((r) => r.importRowIndex != null && byRow.has(r.importRowIndex))
          .map((r) => {
            const row = byRow.get(r.importRowIndex as number)!;
            return {
              screeningId: r.id,
              clinicId: opts.clinicId ?? null,
              sourceSystem: "bulk_import",
              clinicMrn: row.mrn ?? null,
              // Distinct external Patient ID (NEVER the MRN) — persisted as a
              // canonical ehr_patient_id external identifier, and recorded as
              // the membership source identifier.
              externalPatientId: row.patientId ?? null,
              sourcePatientIdentifier: row.patientId ?? null,
              demographics: { displayName: row.name, dob: row.dob, phone: row.phone, email: row.email },
            };
          }),
      );
    }

    result.attempted += slice.length;
    result.inserted += insertedRows.length;
    processed += slice.length;
    const maxIdx = slice.reduce((m, cr) => Math.max(m, cr.row.rowIndex), result.lastRowIndex);
    result.lastRowIndex = maxIdx;

    if (opts.onChunk) {
      await opts.onChunk({ processed, inserted: result.inserted, totalToWrite, lastRowIndex: result.lastRowIndex });
    }
  }

  return result;
}
