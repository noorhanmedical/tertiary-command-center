// PURE allocation helpers for the PERMANENT Manual Call List builder.
//
// These power the manager's manual-override distribution UI (All/Custom patient
// count, per-member editable counts, Add/Remove member, allocation summary, and
// Auto-Balance) WITHOUT introducing any new data model. The output is an
// ordered mapping of executionCaseId → teamMemberId that is handed VERBATIM to
// the EXISTING canonical `confirmCallListDistribution` seam (which already
// accepts an arbitrary reviewed mapping, revalidates callable cases, excludes
// conflicts, assigns patient_execution_cases.assignedTeamMemberId, and freezes
// one call_list_package per member).
//
// No imports, no side effects, no DB — so every rule here is unit-testable in
// isolation and the manual mode stays a thin deterministic layer over the
// canonical spine.

export type ManualAllocationMember = {
  teamMemberId: number;
  name: string;
  /** Admin-entered target patient count for THIS distribution operation only.
   *  Never mutates the member's global capacity/settings. */
  count: number;
};

export type AllocationSummary = {
  /** Patients selected for distribution (all-eligible or the custom count). */
  selected: number;
  /** Sum of every member's entered count. */
  allocated: number;
  /** Patients still unassigned: max(0, selected − allocated). Underallocation
   *  is allowed (the remainder simply stays in the pool). */
  remaining: number;
  /** Patients assigned beyond the selected pool: max(0, allocated − selected).
   *  Confirmation MUST be blocked while this is > 0. */
  overallocated: number;
  /** True when the operation may be confirmed: at least one patient allocated
   *  AND not overallocated. Underallocation is permitted. */
  canConfirm: boolean;
};

/** Clamp a raw integer into [min, max]; non-finite / negative collapses to min. */
function clampInt(n: number, min: number, max: number): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return min;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/**
 * Resolve how many patients the operation targets.
 *   • "all"    → the full eligible cohort total.
 *   • "custom" → the admin's custom count, clamped to [0, eligibleTotal] so a
 *                pasted/garbage value can never exceed the real pool.
 * The UI may only show a preview/sample, but the COUNT drives distribution.
 */
export function resolveSelectedCount(
  mode: "all" | "custom",
  eligibleTotal: number,
  customCount: number | null | undefined,
): number {
  const total = Math.max(0, Math.floor(eligibleTotal) || 0);
  if (mode === "all") return total;
  return clampInt(customCount ?? 0, 0, total);
}

/**
 * Compute the live allocation summary shown above the team-allocation UI.
 * Overallocation blocks confirm; underallocation is allowed.
 */
export function computeAllocationSummary(
  selected: number,
  members: ReadonlyArray<Pick<ManualAllocationMember, "count">>,
): AllocationSummary {
  const sel = Math.max(0, Math.floor(selected) || 0);
  const allocated = members.reduce(
    (sum, m) => sum + Math.max(0, Math.floor(m.count) || 0),
    0,
  );
  const remaining = Math.max(0, sel - allocated);
  const overallocated = Math.max(0, allocated - sel);
  return {
    selected: sel,
    allocated,
    remaining,
    overallocated,
    canConfirm: allocated > 0 && overallocated === 0,
  };
}

/**
 * AUTO-BALANCE: split `selected` patients as evenly as possible across the
 * given members, preserving order for the remainder (earliest members get the
 * extra +1). This OVERWRITES the members' counts and is only ever called when
 * the admin explicitly clicks "Auto Balance" — manual entries are otherwise
 * left untouched. Returns NEW member objects (pure; inputs unmutated).
 */
export function autoBalance(
  selected: number,
  members: ReadonlyArray<ManualAllocationMember>,
): ManualAllocationMember[] {
  const sel = Math.max(0, Math.floor(selected) || 0);
  const n = members.length;
  if (n === 0) return [];
  const base = Math.floor(sel / n);
  const remainder = sel - base * n;
  return members.map((m, i) => ({
    ...m,
    count: base + (i < remainder ? 1 : 0),
  }));
}

/**
 * Build the ordered executionCaseId → teamMemberId mapping the canonical
 * Confirm consumes. Cases are consumed IN ORDER from `pool`, slicing each
 * member's `count` off the front. When members over-request beyond the pool,
 * assignment simply stops (defensive; the summary should already block this).
 * When members under-request, the tail of the pool is left unassigned
 * (underallocation is allowed). Members with count ≤ 0 are skipped.
 *
 * @param pool ordered executionCaseIds (e.g. the cohort's stable ordering)
 * @param members per-member target counts (allocation order === member order)
 */
export function buildManualMapping(
  pool: ReadonlyArray<number>,
  members: ReadonlyArray<Pick<ManualAllocationMember, "teamMemberId" | "count">>,
): Array<{ executionCaseId: number; teamMemberId: number }> {
  const mapping: Array<{ executionCaseId: number; teamMemberId: number }> = [];
  let cursor = 0;
  for (const m of members) {
    const count = Math.max(0, Math.floor(m.count) || 0);
    for (let i = 0; i < count && cursor < pool.length; i += 1) {
      mapping.push({ executionCaseId: pool[cursor], teamMemberId: m.teamMemberId });
      cursor += 1;
    }
  }
  return mapping;
}
