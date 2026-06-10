// Engagement Center board — dormant pure-helpers service (Bundle 23).
//
// READ-ONLY, DORMANT module. NOT wired to any route in this batch.
// Future v2 PRs may adopt these helpers via the
// scripts/qa-engagement-board-dormant-service.mjs gate; the
// dormancy invariant fails CI immediately if any non-test file
// imports from here.
//
// Lifts the pure (DB-free) helpers out of the legacy
// server/routes/engagementAssignmentBoard.ts handler so a future v2
// read endpoint can reuse them without re-implementing the rules.
// The legacy handler is INTENTIONALLY not edited by this bundle.
//
// SAFETY INVARIANTS
//   - No DB import. No schema import. No drizzle import.
//   - No writes. Pure transformations.
//   - Behavior is byte-equivalent to the legacy route's inline logic
//     at the line ranges cited in each helper's JSDoc.
//   - Input arrays are not mutated.
//
// CROSS-REFERENCES
//   server/routes/engagementAssignmentBoard.ts:151-161 (computeMissingInfo)
//   server/routes/engagementAssignmentBoard.ts:322-358 (filter chain)
//   server/routes/engagementAssignmentBoard.ts:362-376 (default sort)
//   server/routes/engagementAssignmentBoard.ts:378-415 (summary aggregation)
//   shared/contracts/engagementBoard.ts (EngagementBoardRow)
//   docs/architecture/team-portal-playground-wiring-contract.md §13 (wiring)
//   docs/architecture/portal-cutover-readiness-checklist.md (gate pattern)

import type { EngagementBoardRow } from "@shared/contracts/engagementBoard";
import type {
  EngagementBoardFilters,
  EngagementBoardSummary,
} from "./contracts";

/**
 * Compute the `missingInfo` array from a screening row slice.
 *
 * Mirrors the legacy `computeMissingInfo` helper at
 * server/routes/engagementAssignmentBoard.ts:151-161. Returns
 * `["patient_record"]` when the screening is absent.
 */
export type ScreeningInfoSlice = {
  name?: string | null;
  dob?: string | null;
  phoneNumber?: string | null;
  facility?: string | null;
};
export function computeMissingInfoFromScreening(
  screening: ScreeningInfoSlice | null | undefined,
): string[] {
  if (!screening) return ["patient_record"];
  const out: string[] = [];
  if (!screening.name?.trim()) out.push("name");
  if (!screening.dob?.trim()) out.push("DOB");
  if (!screening.phoneNumber?.trim()) out.push("phone");
  if (!screening.facility?.trim()) out.push("facility");
  return out;
}

/**
 * Apply the legacy filter chain to a list of rows. Pure: no I/O,
 * no DB, no mutation of the input array. Mirrors
 * server/routes/engagementAssignmentBoard.ts:322-358.
 *
 * Filter precedence and case rules follow the legacy handler:
 *   - `q` (search) is case-folded and matched against patientName,
 *     patientDob, and facility.
 *   - `facility`, `engagementStatus`, `engagementBucket`,
 *     `patientType` are exact-string matches.
 *   - `assignedTeamMemberId`: when present, matches the numeric id.
 *   - `unassignedOnly`: requires assignedTeamMemberId === null.
 *   - `missingInfoOnly`: requires missingInfo.length > 0.
 */
export function applyEngagementBoardFilters(
  rows: ReadonlyArray<EngagementBoardRow>,
  filters: EngagementBoardFilters,
): EngagementBoardRow[] {
  let filtered: EngagementBoardRow[] = rows.slice();
  const q = (filters.q ?? "").trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(
      (r) =>
        r.patientName.toLowerCase().includes(q) ||
        (r.patientDob ?? "").toLowerCase().includes(q) ||
        (r.facility ?? "").toLowerCase().includes(q),
    );
  }
  if (filters.facility) {
    filtered = filtered.filter((r) => (r.facility ?? "") === filters.facility);
  }
  if (filters.assignedTeamMemberId != null) {
    filtered = filtered.filter(
      (r) => r.assignedTeamMemberId === filters.assignedTeamMemberId,
    );
  }
  if (filters.engagementStatus) {
    filtered = filtered.filter(
      (r) => (r.engagementStatus ?? "") === filters.engagementStatus,
    );
  }
  if (filters.engagementBucket) {
    filtered = filtered.filter(
      (r) => (r.engagementBucket ?? "") === filters.engagementBucket,
    );
  }
  if (filters.patientType) {
    filtered = filtered.filter((r) => (r.patientType ?? "") === filters.patientType);
  }
  if (filters.unassignedOnly) {
    filtered = filtered.filter((r) => r.assignedTeamMemberId == null);
  }
  if (filters.missingInfoOnly) {
    filtered = filtered.filter((r) => r.missingInfo.length > 0);
  }
  return filtered;
}

/**
 * Apply the legacy default sort to a list of rows. Pure: returns a
 * NEW sorted array; never mutates the input. Mirrors
 * server/routes/engagementAssignmentBoard.ts:362-376.
 *
 * Sort order: unassigned first, then ascending nextActionAt
 * (nulls last), then descending lastActivityAt (nulls last).
 */
export function sortEngagementBoardRows(
  rows: ReadonlyArray<EngagementBoardRow>,
): EngagementBoardRow[] {
  const out = rows.slice();
  out.sort((a, b) => {
    const aAssigned = a.assignedTeamMemberId != null ? 1 : 0;
    const bAssigned = b.assignedTeamMemberId != null ? 1 : 0;
    if (aAssigned !== bAssigned) return aAssigned - bAssigned;
    const aNext = a.nextActionAt ?? "";
    const bNext = b.nextActionAt ?? "";
    if (aNext !== bNext) {
      if (!aNext) return 1;
      if (!bNext) return -1;
      return aNext.localeCompare(bNext);
    }
    const aLast = a.lastActivityAt ?? "";
    const bLast = b.lastActivityAt ?? "";
    return bLast.localeCompare(aLast);
  });
  return out;
}

/**
 * Compute the legacy `EngagementBoardSummary` from a list of rows.
 * Pure: no I/O, no mutation. Mirrors
 * server/routes/engagementAssignmentBoard.ts:378-415.
 */
export function computeEngagementBoardSummary(
  rows: ReadonlyArray<EngagementBoardRow>,
): EngagementBoardSummary {
  const byFacilityMap = new Map<string, number>();
  const byAssignedMap = new Map<string, number>();
  const byStatusMap = new Map<string, number>();
  let assigned = 0;
  let unassigned = 0;
  let needsInfo = 0;
  for (const r of rows) {
    const fac = r.facility ?? "(no facility)";
    byFacilityMap.set(fac, (byFacilityMap.get(fac) ?? 0) + 1);
    const ass = r.assignedName ?? "(unassigned)";
    byAssignedMap.set(ass, (byAssignedMap.get(ass) ?? 0) + 1);
    const st = r.engagementStatus ?? "(unknown)";
    byStatusMap.set(st, (byStatusMap.get(st) ?? 0) + 1);
    if (r.assignedTeamMemberId != null) assigned += 1;
    else unassigned += 1;
    if (r.missingInfo.length > 0) needsInfo += 1;
  }
  return {
    total: rows.length,
    assigned,
    unassigned,
    needsInfo,
    byFacility: Array.from(byFacilityMap, ([facility, count]) => ({ facility, count })),
    byAssignedTeamMember: Array.from(byAssignedMap, ([name, count]) => ({ name, count })),
    byEngagementStatus: Array.from(byStatusMap, ([status, count]) => ({ status, count })),
  };
}

// ────────────────────────────────────────────────────────────────────────
// V2 read-model composition (Bundle 51 — DORMANT)
//
// composeEngagementBoardV2Response composes the four pure helpers
// above into the v2 response envelope (EngagementBoardResponse from
// ./contracts) WITHOUT touching the legacy route. It also encodes
// the offset-based cursor a future v2 endpoint will use.
//
// SAFETY INVARIANTS:
//   - Pure. No DB, no schema, no drizzle.
//   - No writes; row arrays not mutated.
//   - The legacy `BoardResponse` shape from the route is
//     intentionally NOT modified by this function — the v2
//     envelope ADDS `nextCursor` but the existing `rows` and
//     `summary` fields stay byte-equivalent.
// ────────────────────────────────────────────────────────────────────────

import type { EngagementBoardResponse } from "./contracts";

/**
 * Encode a numeric offset as the v2 opaque cursor string.
 * Format: base64url-encoded JSON `{ "offset": <n> }`. The cursor is
 * opaque from the caller's perspective; only this module's
 * `decodeV2Cursor` may parse it.
 */
export function encodeV2Cursor(offset: number): string {
  if (!Number.isFinite(offset) || offset < 0 || !Number.isInteger(offset)) {
    throw new Error(`encodeV2Cursor: offset must be a non-negative integer, got ${offset}`);
  }
  const json = JSON.stringify({ offset });
  return Buffer.from(json, "utf8").toString("base64url");
}

/**
 * Decode a v2 cursor. Returns null when the input cannot be parsed
 * (the future endpoint treats null as "start from offset 0").
 */
export function decodeV2Cursor(raw: string | null | undefined): { offset: number } | null {
  if (raw == null || raw === "") return null;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as { offset?: unknown };
    if (typeof parsed?.offset !== "number" || !Number.isInteger(parsed.offset) || parsed.offset < 0) {
      return null;
    }
    return { offset: parsed.offset };
  } catch {
    return null;
  }
}

/**
 * Compose the v2 read-model response from an already-fetched row
 * snapshot. Caller is responsible for the DB read; this function is
 * pure.
 *
 * Steps:
 *   1. Apply the legacy filter chain (same as the route's lines 322-358).
 *   2. Apply the legacy default sort (lines 362-376).
 *   3. Slice by cursor offset + limit.
 *   4. Compute the summary aggregates over the post-filter / pre-slice
 *      rows so per-page summaries do not lie about totals.
 *   5. Compute `nextCursor` only when more rows remain after the slice.
 *
 * Notes:
 *   - The function takes an opaque cursor string and a numeric limit;
 *     when limit is unset, returns ALL filtered+sorted rows in one page.
 *   - The legacy route's response shape carries no cursor; this
 *     function returns the v2 envelope (`EngagementBoardResponse`)
 *     which DOES, with `nextCursor: null` on the last page.
 */
export function composeEngagementBoardV2Response(
  rows: ReadonlyArray<EngagementBoardRow>,
  filters: EngagementBoardFilters,
): EngagementBoardResponse {
  const filtered = applyEngagementBoardFilters(rows, filters);
  const sorted = sortEngagementBoardRows(filtered);
  // Summary is over the full filtered+sorted set, NOT the page slice.
  // Mirrors the legacy route, which computes the summary over the
  // filtered list and not over the rendered page.
  const summary = computeEngagementBoardSummary(sorted);

  // Cursor handling.
  const cursor = decodeV2Cursor(filters.cursor ?? null);
  const offset = cursor?.offset ?? 0;
  const limit = typeof filters.limit === "number" && filters.limit > 0 ? filters.limit : sorted.length;
  const pageEnd = Math.min(offset + limit, sorted.length);
  const pageRows = sorted.slice(offset, pageEnd);
  const nextCursor = pageEnd < sorted.length ? encodeV2Cursor(pageEnd) : null;

  return {
    rows: pageRows,
    summary,
    nextCursor,
  };
}
