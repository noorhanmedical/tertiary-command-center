// Qualification run ordering + comparison helpers (Batch B2).
//
// Pure module. Used by:
//   - PlexusIQWorkspace patient list / bars
//   - RunComparisonSelector
//   - duplicate-warning engine
//   - PDF/packet patient selection dialog
//
// Inputs are typed loosely so client+server callers can reuse without
// dragging Drizzle row types into the client bundle.

export type RunSourceRow = {
  batchId: number;
  batchCreatedAt: string; // ISO
  patientType?: "visit" | "outreach" | string | null;
  patientId: number;
  name: string;
  appointmentTime?: string | null;
};

export type QualificationRun = {
  runId: number;            // batch id
  runCreatedAt: string;     // batch createdAt ISO
  parentDateKey: string;    // YYYY-MM-DD (local) — also the bucket key
  runNumberWithinDate: number;
  runLabel: string;         // "Run 2 - June 11, 2026 11:17 AM"
  patientCount: number;
  visitCount: number;
  outreachCount: number;
};

export type QualificationDateGroup = {
  parentDateKey: string;
  parentDateLabel: string;  // "June 11, 2026"
  runs: ReadonlyArray<QualificationRun>;
};

function pad(n: number): string { return String(n).padStart(2, "0"); }

export function parentDateKeyOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parentDateLabelOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function runTimeLabelOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function makeRunLabel(runNumber: number, runCreatedAt: string): string {
  return `Run ${runNumber} - ${parentDateLabelOf(runCreatedAt)} ${runTimeLabelOf(runCreatedAt)}`;
}

// Patient ordering ---------------------------------------------------------

const VISIT = "visit";
const OUTREACH = "outreach";

function appointmentMs(row: RunSourceRow): number {
  const t = row.appointmentTime;
  if (!t) return Number.POSITIVE_INFINITY;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? Number.POSITIVE_INFINITY : d.getTime();
}

function compareByName(a: RunSourceRow, b: RunSourceRow): number {
  return (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" });
}

function compareByAppointmentTime(a: RunSourceRow, b: RunSourceRow): number {
  const am = appointmentMs(a);
  const bm = appointmentMs(b);
  if (am !== bm) return am - bm;
  return compareByName(a, b);
}

/**
 * Order patients within a run: outreach alphabetical, visit by
 * appointment time, mixed lists grouped by type (outreach first,
 * visit second) so the reader can scan each group cleanly.
 */
export function orderPatientsWithinRun(
  rows: ReadonlyArray<RunSourceRow>,
): ReadonlyArray<RunSourceRow> {
  const outreach = rows.filter((r) => (r.patientType ?? VISIT) === OUTREACH).slice().sort(compareByName);
  const visit = rows.filter((r) => (r.patientType ?? VISIT) !== OUTREACH).slice().sort(compareByAppointmentTime);
  return [...outreach, ...visit];
}

// Date / run grouping ------------------------------------------------------

export type RunOrderingOptions = {
  /** "desc" = most recent date first (default), "asc" = oldest first. */
  dateOrder?: "asc" | "desc";
  /** "desc" = newest run within a date first (default), "asc" = oldest first. */
  runOrder?: "asc" | "desc";
};

export function buildQualificationGroups(
  rows: ReadonlyArray<RunSourceRow>,
  options: RunOrderingOptions = {},
): ReadonlyArray<QualificationDateGroup> {
  const { dateOrder = "desc", runOrder = "desc" } = options;

  // Bucket by (parentDate, runId) so each batch becomes one run.
  type RunBucket = {
    runId: number;
    runCreatedAt: string;
    parentDateKey: string;
    rows: RunSourceRow[];
  };
  const bucketKey = (r: RunSourceRow) => `${parentDateKeyOf(r.batchCreatedAt)}::${r.batchId}`;
  const buckets = new Map<string, RunBucket>();
  for (const r of rows) {
    const k = bucketKey(r);
    let b = buckets.get(k);
    if (!b) {
      b = {
        runId: r.batchId,
        runCreatedAt: r.batchCreatedAt,
        parentDateKey: parentDateKeyOf(r.batchCreatedAt),
        rows: [],
      };
      buckets.set(k, b);
    }
    b.rows.push(r);
  }

  // Group buckets by parentDateKey.
  const byDate = new Map<string, RunBucket[]>();
  for (const b of buckets.values()) {
    const list = byDate.get(b.parentDateKey) ?? [];
    list.push(b);
    byDate.set(b.parentDateKey, list);
  }

  const groups: QualificationDateGroup[] = [];
  for (const [parentDateKey, list] of byDate.entries()) {
    // Sort runs chronologically ascending first so we can assign
    // stable run numbers, then re-order per runOrder for display.
    const sortedAsc = list.slice().sort((a, b) =>
      new Date(a.runCreatedAt).getTime() - new Date(b.runCreatedAt).getTime()
      || a.runId - b.runId
    );
    const runs: QualificationRun[] = sortedAsc.map((b, idx) => {
      const runNumber = idx + 1;
      const visitCount = b.rows.filter((r) => (r.patientType ?? VISIT) !== OUTREACH).length;
      const outreachCount = b.rows.length - visitCount;
      return {
        runId: b.runId,
        runCreatedAt: b.runCreatedAt,
        parentDateKey,
        runNumberWithinDate: runNumber,
        runLabel: makeRunLabel(runNumber, b.runCreatedAt),
        patientCount: b.rows.length,
        visitCount,
        outreachCount,
      };
    });
    const finalRuns = runOrder === "desc" ? runs.slice().reverse() : runs;
    groups.push({
      parentDateKey,
      parentDateLabel: parentDateLabelOf(sortedAsc[0].runCreatedAt),
      runs: finalRuns,
    });
  }

  groups.sort((a, b) => {
    const cmp = a.parentDateKey.localeCompare(b.parentDateKey);
    return dateOrder === "desc" ? -cmp : cmp;
  });

  return groups;
}

// Comparison set selection -------------------------------------------------

export type RunSelection =
  | { kind: "none" }
  | { kind: "all" }
  | { kind: "date"; parentDateKey: string }
  | { kind: "runs"; runIds: ReadonlyArray<number> };

export function selectAllRuns(): RunSelection { return { kind: "all" }; }
export function selectNoRuns(): RunSelection { return { kind: "none" }; }
export function selectByDate(parentDateKey: string): RunSelection {
  return { kind: "date", parentDateKey };
}
export function selectByRuns(runIds: ReadonlyArray<number>): RunSelection {
  return { kind: "runs", runIds: [...runIds] };
}

export function buildComparisonRunSet(
  groups: ReadonlyArray<QualificationDateGroup>,
  selection: RunSelection,
): ReadonlyArray<QualificationRun> {
  if (selection.kind === "none") return [];
  const flat = groups.flatMap((g) => g.runs);
  if (selection.kind === "all") return flat;
  if (selection.kind === "date") return flat.filter((r) => r.parentDateKey === selection.parentDateKey);
  const ids = new Set(selection.runIds);
  return flat.filter((r) => ids.has(r.runId));
}
