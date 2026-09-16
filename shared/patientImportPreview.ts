// Pure helpers for the structured bulk-import PREVIEW surface.
//
// These are deliberately dependency-free and side-effect-free so they can be
// shared by the client dialog, the server routes, and the unit tests without a
// DB. They cover three concerns:
//
//   1. Row-count RECONCILIATION for the preview strip. The invariant the UI
//      must always satisfy is:
//        parsed = ready + existing + possible + invalid + removed
//      where each visible bucket is its classification count MINUS the rows the
//      user removed from that bucket, and `removed` is the total removed.
//
//   2. Removal EXCLUSION-SET math (Remove Selected / Remove Invalid). Removal
//      only ever excludes rows from THIS preview/job — it never deletes an
//      existing patient. A removed row is persisted as a per-row "skip"
//      decision, so the importer skips it regardless of its classification.
//
//   3. Post-import Plexus IQ PROGRESS counts. A FAILED analysis (provider/AI
//      error) is counted as Failed — NEVER as Not Qualified.

// Classification vocabulary shared with the server's RowClassification and the
// client's Classification. "NEW" surfaces in the UI as "Ready".
export type PreviewClassification = "NEW" | "EXISTING_MATCH" | "POSSIBLE_MATCH" | "INVALID";

export type PreviewCounts = {
  total: number;
  new: number; // "ready"
  existing: number;
  possible: number;
  invalid: number;
};

// How many removed rows fell into each classification bucket (captured at the
// moment the user removed them, from the row they were looking at).
export type RemovedByClass = Partial<Record<PreviewClassification, number>>;

export type ReconciledCounts = {
  parsed: number;
  ready: number;
  existing: number;
  possible: number;
  invalid: number;
  removed: number;
  /** True when parsed === ready + existing + possible + invalid + removed. */
  balanced: boolean;
};

const nz = (n: number | null | undefined): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);

/**
 * Reconcile the classification counts against the set of removed rows so the
 * preview strip always balances. Each bucket is reduced by the rows removed
 * from it; `removed` is the grand total removed. Never returns negatives.
 */
export function reconcileImportCounts(
  counts: PreviewCounts,
  removedByClass: RemovedByClass = {},
): ReconciledCounts {
  const rNew = nz(removedByClass.NEW);
  const rExisting = nz(removedByClass.EXISTING_MATCH);
  const rPossible = nz(removedByClass.POSSIBLE_MATCH);
  const rInvalid = nz(removedByClass.INVALID);

  const ready = Math.max(0, nz(counts.new) - rNew);
  const existing = Math.max(0, nz(counts.existing) - rExisting);
  const possible = Math.max(0, nz(counts.possible) - rPossible);
  const invalid = Math.max(0, nz(counts.invalid) - rInvalid);
  const removed = rNew + rExisting + rPossible + rInvalid;
  const parsed = nz(counts.total);

  return {
    parsed,
    ready,
    existing,
    possible,
    invalid,
    removed,
    balanced: parsed === ready + existing + possible + invalid + removed,
  };
}

// ── Import eligibility (ready-only semantics) ────────────────────────────────

// The per-row decisions the resolve endpoint accepts. "skip" is also used to
// REMOVE a row of any classification from this import.
export type ImportRowDecisionLike = "use_existing" | "import_as_new" | "skip" | undefined | null;

/**
 * The single source of truth for "does this row get written on confirm?".
 * Ready-only semantics:
 *   - A removed row (decision "skip") NEVER imports, whatever its class.
 *   - INVALID and EXISTING_MATCH never import.
 *   - POSSIBLE_MATCH imports ONLY when explicitly resolved to "import_as_new"
 *     (unresolved / use_existing / skip are excluded).
 *   - NEW ("ready") imports.
 */
export function isRowImportable(
  classification: PreviewClassification,
  decision: ImportRowDecisionLike,
): boolean {
  if (decision === "skip") return false;
  if (classification === "INVALID") return false;
  if (classification === "EXISTING_MATCH") return false;
  if (classification === "POSSIBLE_MATCH") return decision === "import_as_new";
  return classification === "NEW";
}

// ── Removal exclusion-set math ───────────────────────────────────────────────

export type PreviewRowRef = { rowIndex: number; classification: PreviewClassification };

/** Row indexes of every INVALID row in the given set. */
export function invalidRowIndexes(rows: ReadonlyArray<PreviewRowRef>): number[] {
  return rows.filter((r) => r.classification === "INVALID").map((r) => r.rowIndex);
}

/**
 * Merge `toRemove` into the current excluded set, returning a NEW set (pure).
 * Idempotent — removing an already-removed row is a no-op.
 */
export function addToExcluded(current: ReadonlySet<number>, toRemove: Iterable<number>): Set<number> {
  const next = new Set<number>(current);
  for (const idx of toRemove) next.add(idx);
  return next;
}

/** Drop `toRestore` from the excluded set, returning a NEW set (pure). */
export function removeFromExcluded(current: ReadonlySet<number>, toRestore: Iterable<number>): Set<number> {
  const next = new Set<number>(current);
  for (const idx of toRestore) next.delete(idx);
  return next;
}

/**
 * Tally removed rows by classification given the excluded set and a lookup of
 * rowIndex → classification (only the rows the client has observed need be
 * present; an unknown index is ignored so the strip never double-counts).
 */
export function tallyRemovedByClass(
  excluded: ReadonlySet<number>,
  classOf: ReadonlyMap<number, PreviewClassification>,
): RemovedByClass {
  const out: RemovedByClass = {};
  for (const idx of excluded) {
    const c = classOf.get(idx);
    if (!c) continue;
    out[c] = (out[c] ?? 0) + 1;
  }
  return out;
}

// ── Plexus IQ progress counts ────────────────────────────────────────────────

// Minimal shape of a patient_screenings row needed to derive its IQ outcome.
export type IqScreeningLike = {
  status?: string | null;
  qualifyingTests?: unknown;
  reasoning?: unknown;
};

// Failure sentinels this repo writes into `reasoning` for a failed analysis.
const ANALYSIS_FAILURE_KEYS = ["__analysisFailure", "__analysisError"] as const;

/**
 * A screening is a FAILED analysis (provider/AI/technical) when its status is
 * "error" OR its reasoning carries an analysis-failure sentinel. This is
 * DISTINCT from "not qualified" (a completed analysis with no qualifying
 * tests). A failure must never be counted as Not Qualified.
 */
export function isAnalysisFailure(row: IqScreeningLike): boolean {
  if ((row.status ?? "") === "error") return true;
  const reasoning = row.reasoning;
  if (reasoning && typeof reasoning === "object") {
    for (const k of ANALYSIS_FAILURE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(reasoning, k)) return true;
    }
  }
  return false;
}

function hasQualifyingTests(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

export type IqProgressCounts = {
  total: number;
  qualified: number;
  notQualified: number;
  failed: number;
  /** Not yet resolved (draft / processing). */
  pending: number;
};

/**
 * Summarize a batch's patient screenings into IQ progress counts. A failed
 * analysis is bucketed as `failed`, never `notQualified`. Qualified = completed
 * with a non-empty qualifyingTests array; Not Qualified = completed with none.
 */
export function summarizeIqScreenings(rows: ReadonlyArray<IqScreeningLike>): IqProgressCounts {
  const out: IqProgressCounts = { total: 0, qualified: 0, notQualified: 0, failed: 0, pending: 0 };
  for (const r of rows) {
    out.total += 1;
    if (isAnalysisFailure(r)) {
      out.failed += 1;
      continue;
    }
    if ((r.status ?? "") === "completed") {
      if (hasQualifyingTests(r.qualifyingTests)) out.qualified += 1;
      else out.notQualified += 1;
      continue;
    }
    out.pending += 1;
  }
  return out;
}

export type IqPhase = "not_started" | "queued" | "running" | "complete" | "failed";

/**
 * Map an analysis-job row to a coarse phase for the progress view. `null`
 * (no job yet) is "not_started"; a running job that has completed no patients
 * is "queued"; otherwise it mirrors the job status.
 */
export function iqPhaseFromJob(
  job: { status?: string | null; completedPatients?: number | null; totalPatients?: number | null } | null | undefined,
): IqPhase {
  if (!job || !job.status || job.status === "not_started") return "not_started";
  if (job.status === "failed") return "failed";
  if (job.status === "completed") return "complete";
  if (job.status === "running") {
    return nz(job.completedPatients) === 0 ? "queued" : "running";
  }
  return "not_started";
}
