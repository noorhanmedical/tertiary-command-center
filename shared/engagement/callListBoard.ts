// PURE helpers for the Engagement "Call Lists" command-center board.
//
// The board itself renders LIVE canonical data (the same /api/scheduler-portal
// /cases feed the Team Portals use, plus call_list_packages for PDFs). These
// helpers are the small, deterministic derivations the board depends on —
// extracted here so they are unit-testable without a DB or a browser:
//   • friendly call-result labels from the canonical lastCallOutcome string
//   • per-column progress metrics (called / remaining / rollover / handoff)
//   • PDF-ready gating + latest-package matching per member/date
//
// No imports, no side effects, no presentation classes (the component maps the
// semantic `tone` token → Tailwind classes).

// ─── Call result display ─────────────────────────────────────────────────────

export type ResultTone = "muted" | "neutral" | "info" | "warning" | "positive" | "danger";

export type CallResultDisplay = { label: string; tone: ResultTone };

/** Map the canonical `lastCallOutcome` (outreach_calls.outcome) to a friendly
 *  label + semantic tone. `null`/empty → "Not Called". Never inferred from
 *  client-only state — the caller passes the canonical value. */
export function resultDisplay(outcome: string | null | undefined): CallResultDisplay {
  const o = (outcome ?? "").trim().toLowerCase();
  switch (o) {
    case "":
      return { label: "Not Called", tone: "muted" };
    case "reached":
      return { label: "Reached", tone: "positive" };
    case "scheduled":
    case "completed":
      return { label: "Scheduled", tone: "positive" };
    case "voicemail":
      return { label: "LVM", tone: "warning" };
    case "no_answer":
      return { label: "No Answer", tone: "neutral" };
    case "callback":
      return { label: "Callback", tone: "info" };
    case "refused_dnc":
    case "declined":
    case "not_interested":
    case "dnc":
    case "do_not_contact":
      return { label: "Refused", tone: "danger" };
    case "wrong_number":
      return { label: "Wrong Number", tone: "neutral" };
    default:
      // Title-case the raw canonical value as a safe fallback.
      return {
        label: o
          .split(/[_\s]+/)
          .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
          .join(" "),
        tone: "neutral",
      };
  }
}

/** True when this outcome counts the patient as "called/worked" for progress. */
export function isCalledOutcome(outcome: string | null | undefined): boolean {
  return (outcome ?? "").trim() !== "";
}

// ─── Per-column progress metrics ─────────────────────────────────────────────

export type BoardCaseLike = {
  lastCallOutcome?: string | null;
  isCarryover?: boolean;
  isHandoff?: boolean;
  /** Set on the historical (past-date) snapshot rows. */
  completed?: boolean;
};

export type ColumnMetrics = {
  total: number;
  called: number;
  remaining: number;
  rollover: number;
  handoff: number;
};

/** Derive a member column's progress from LIVE canonical rows. A patient is
 *  "called" when they have a lastCallOutcome (or the historical row is marked
 *  completed). Rollover/handoff come from the canonical isCarryover/isHandoff
 *  annotations — never recomputed here. */
export function deriveColumnMetrics(rows: ReadonlyArray<BoardCaseLike>): ColumnMetrics {
  let called = 0;
  let rollover = 0;
  let handoff = 0;
  for (const r of rows) {
    if (isCalledOutcome(r.lastCallOutcome) || r.completed === true) called += 1;
    if (r.isCarryover === true) rollover += 1;
    if (r.isHandoff === true) handoff += 1;
  }
  const total = rows.length;
  return { total, called, remaining: Math.max(0, total - called), rollover, handoff };
}

// ─── PDF / package matching per member+date ──────────────────────────────────

export type PackageLike = {
  id: number;
  teamMemberId: number;
  serviceDate: string | null;
  generationStatus: string;
  pdfAvailable: boolean;
  createdAt: string;
};

/** PDF is openable iff the frozen package finished rendering and a blob exists.
 *  A failed/pending package (or one with no blob) is NOT openable. */
export function isPackagePdfReady(
  p: Pick<PackageLike, "generationStatus" | "pdfAvailable"> | null | undefined,
): boolean {
  return !!p && p.generationStatus === "ready" && p.pdfAvailable === true;
}

export type PackageMatch<T extends PackageLike> = {
  /** The LATEST package for this member+date (max createdAt), or null. */
  latest: T | null;
  /** How many packages exist for this member+date (never hide issued ones). */
  count: number;
  /** Whether the latest package's PDF is openable right now. */
  pdfReady: boolean;
};

/** Match packages to a member+date. When multiple exist, the LATEST (max
 *  createdAt) wins and `count` surfaces the rest — issued packages are never
 *  hidden. serviceDate is compared exactly (YYYY-MM-DD). */
export function pickLatestPackage<T extends PackageLike>(
  packages: ReadonlyArray<T>,
  teamMemberId: number,
  serviceDate: string,
): PackageMatch<T> {
  const matches = packages.filter(
    (p) => p.teamMemberId === teamMemberId && (p.serviceDate ?? "") === serviceDate,
  );
  if (matches.length === 0) return { latest: null, count: 0, pdfReady: false };
  const latest = matches.reduce((a, b) =>
    new Date(b.createdAt).getTime() >= new Date(a.createdAt).getTime() ? b : a,
  );
  return { latest, count: matches.length, pdfReady: isPackagePdfReady(latest) };
}
