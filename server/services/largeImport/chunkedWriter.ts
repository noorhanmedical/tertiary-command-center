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
  lastRowIndex: number;
};

function toInsertValues(cr: ClassifiedRow, opts: WriteOptions) {
  const r = cr.row;
  return {
    batchId: opts.batchId,
    clinicId: opts.clinicId ?? undefined,
    name: r.name,
    dob: r.dob ?? undefined,
    gender: r.gender ?? undefined,
    age: r.age ?? undefined,
    phoneNumber: r.phone ?? undefined,
    email: r.email ?? undefined,
    mrn: r.mrn ?? undefined,
    insurance: r.insurance ?? undefined,
    facility: r.facility ?? undefined,
    diagnoses: r.diagnoses ?? undefined,
    history: r.history ?? undefined,
    medications: r.medications ?? undefined,
    previousTests: r.previousTests ?? undefined,
    notes: r.notes ?? undefined,
    patientType: (r.patientType ?? "outreach") as "visit" | "outreach",
    status: "draft" as const,
    appointmentStatus: "pending" as const,
    importJobId: opts.importJobId,
    importRowIndex: r.rowIndex,
    isTest: opts.isTest ?? false,
  };
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
    lastRowIndex: fromRowIndex,
  };

  // Determine the eligible set (NEW + optionally POSSIBLE), excluding rows
  // already processed (<= cursor) and non-writable classifications.
  const eligible: ClassifiedRow[] = [];
  for (const cr of rows) {
    if (cr.row.rowIndex <= fromRowIndex) continue;
    if (cr.classification === "INVALID") { result.skippedInvalid += 1; continue; }
    if (cr.classification === "EXISTING_MATCH") { result.skippedExisting += 1; continue; }
    if (cr.classification === "POSSIBLE_MATCH") {
      // Only import when the manager explicitly resolved this row to
      // "import_as_new". Unresolved / use_existing / skip are NEVER written.
      const decision = opts.decisions?.get(cr.row.rowIndex)?.decision;
      if (decision !== "import_as_new") { result.skippedExisting += 1; continue; }
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
        .returning({ id: patientScreenings.id });
    });

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
