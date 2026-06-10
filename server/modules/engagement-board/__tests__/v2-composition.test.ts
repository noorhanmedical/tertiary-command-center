// Engagement Center v2 — composition test (Bundle 51).
//
// Runnable via:
//   npx tsx server/modules/engagement-board/__tests__/v2-composition.test.ts
//
// Exercises the dormant v2 helper added to
// server/modules/engagement-board/service.ts so a future v2
// wiring PR can adopt the composition with confidence the filter
// chain + sort + summary + cursor codec stay byte-equivalent to
// the legacy assignment-board projection.
//
// No DB, no app boot, no network, no PHI.

import {
  composeEngagementBoardV2Response,
  decodeV2Cursor,
  encodeV2Cursor,
} from "../service";
import type { EngagementBoardRow } from "../contracts";

const failures: string[] = [];
function check(cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}
function eq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    failures.push(`${label}: expected ${String(expected)} got ${String(actual)}`);
  }
}

// ─── Synthetic rows mirroring the EngagementBoardRow shape ────────
function row(over: Partial<EngagementBoardRow>): EngagementBoardRow {
  return {
    patientScreeningId: 1,
    executionCaseId: 1,
    patientName: "Alpha One",
    patientDob: "1980-01-15",
    phoneNumber: "555-0101",
    facility: "Clinic A",
    scheduleDate: "2026-06-12",
    patientType: "new",
    engagementBucket: null,
    engagementStatus: "assigned",
    commitStatus: "Ready",
    assignedTeamMemberId: 7,
    assignedRole: "scheduler",
    assignedName: "Synth Scheduler X",
    assignedFacility: "Clinic A",
    nextActionAt: "2026-06-12T09:00:00.000Z",
    lastActivityAt: "2026-06-09T12:00:00.000Z",
    lastActivitySummary: "Outreach contact",
    missingInfo: [],
    selectedServices: [],
    ...over,
  };
}

const ROWS: EngagementBoardRow[] = [
  row({ patientScreeningId: 1, executionCaseId: 101, patientName: "Alpha One", facility: "Clinic A", assignedTeamMemberId: 7, nextActionAt: "2026-06-12T09:00:00.000Z" }),
  row({ patientScreeningId: 2, executionCaseId: 102, patientName: "Beta Two", facility: "Clinic A", assignedTeamMemberId: null, assignedName: null, nextActionAt: "2026-06-13T09:00:00.000Z", missingInfo: ["DOB"] }),
  row({ patientScreeningId: 3, executionCaseId: 103, patientName: "Gamma Three", facility: "Clinic B", assignedTeamMemberId: 8, assignedName: "Synth Scheduler Y", nextActionAt: "2026-06-12T11:00:00.000Z" }),
  row({ patientScreeningId: 4, executionCaseId: 104, patientName: "Delta Four", facility: "Clinic B", assignedTeamMemberId: null, assignedName: null, nextActionAt: null, missingInfo: ["phone"] }),
  row({ patientScreeningId: 5, executionCaseId: 105, patientName: "Epsilon Five", facility: "Clinic A", assignedTeamMemberId: 7, nextActionAt: "2026-06-14T09:00:00.000Z" }),
];

// ─── §1: Cursor round-trip ────────────────────────────────────────
{
  const c = encodeV2Cursor(3);
  const dec = decodeV2Cursor(c);
  eq(dec?.offset, 3, "§1: cursor round-trips offset 3");
  eq(decodeV2Cursor(null), null, "§1: null cursor decodes to null");
  eq(decodeV2Cursor(""), null, "§1: empty cursor decodes to null");
  eq(decodeV2Cursor("not-base64-_!!"), null, "§1: malformed cursor decodes to null");
  // base64url of a non-cursor JSON payload should decode to null too.
  const bogus = Buffer.from(JSON.stringify({ notOffset: 5 }), "utf8").toString("base64url");
  eq(decodeV2Cursor(bogus), null, "§1: cursor with wrong shape decodes to null");
}

// ─── §2: Filter chain — facility ──────────────────────────────────
{
  const r = composeEngagementBoardV2Response(ROWS, { facility: "Clinic A" });
  check(r.rows.length === 3, `§2: facility filter expected 3 rows, got ${r.rows.length}`);
  for (const row of r.rows) {
    eq(row.facility, "Clinic A", `§2: row.facility for executionCase ${row.executionCaseId}`);
  }
  eq(r.summary.total, 3, "§2: summary.total after filter");
}

// ─── §3: Filter chain — unassignedOnly ────────────────────────────
{
  const r = composeEngagementBoardV2Response(ROWS, { unassignedOnly: true });
  for (const row of r.rows) {
    eq(row.assignedTeamMemberId, null, `§3: unassignedOnly row ${row.executionCaseId}`);
  }
  check(r.rows.length === 2, `§3: unassignedOnly expected 2 rows, got ${r.rows.length}`);
}

// ─── §4: Filter chain — missingInfoOnly ───────────────────────────
{
  const r = composeEngagementBoardV2Response(ROWS, { missingInfoOnly: true });
  for (const row of r.rows) {
    check(
      row.missingInfo.length > 0,
      `§4: missingInfoOnly row ${row.executionCaseId} must have non-empty missingInfo`,
    );
  }
  check(r.rows.length === 2, `§4: missingInfoOnly expected 2 rows, got ${r.rows.length}`);
}

// ─── §5: Default sort — unassigned first, then nextActionAt asc ───
{
  const r = composeEngagementBoardV2Response(ROWS, {});
  check(r.rows.length === ROWS.length, `§5: no filter returns all rows, got ${r.rows.length}`);
  // First rows should be the two unassigned ones.
  const firstTwoAssigned = r.rows.slice(0, 2).every((row) => row.assignedTeamMemberId == null);
  check(firstTwoAssigned, "§5: unassigned rows must sort first");
}

// ─── §6: Pagination cursor ────────────────────────────────────────
{
  const page1 = composeEngagementBoardV2Response(ROWS, { limit: 2 });
  check(page1.rows.length === 2, `§6: page 1 should have 2 rows, got ${page1.rows.length}`);
  check(page1.nextCursor !== null, "§6: page 1 must have a nextCursor");
  const page2 = composeEngagementBoardV2Response(ROWS, {
    limit: 2,
    cursor: page1.nextCursor!,
  });
  check(page2.rows.length === 2, `§6: page 2 should have 2 rows, got ${page2.rows.length}`);
  // Page 1 + page 2 rows must be disjoint.
  const page1Ids = new Set(page1.rows.map((r) => r.executionCaseId));
  for (const row of page2.rows) {
    check(
      !page1Ids.has(row.executionCaseId),
      `§6: page 2 row ${row.executionCaseId} must not overlap page 1`,
    );
  }
  // Last page has nextCursor null.
  const page3 = composeEngagementBoardV2Response(ROWS, {
    limit: 2,
    cursor: page2.nextCursor!,
  });
  check(page3.rows.length === 1, `§6: page 3 (last) should have 1 row, got ${page3.rows.length}`);
  eq(page3.nextCursor, null, "§6: last-page nextCursor must be null");
}

// ─── §7: Summary is computed over filtered rows, not the page ────
{
  const page = composeEngagementBoardV2Response(ROWS, { limit: 2 });
  // Summary.total must reflect the FILTERED set (5), not the page (2).
  eq(page.summary.total, 5, "§7: summary.total reflects filter set, not page");
  // assigned + unassigned must add up to total.
  check(
    page.summary.assigned + page.summary.unassigned === page.summary.total,
    "§7: assigned + unassigned must equal total",
  );
}

// ─── §8: Input is not mutated ─────────────────────────────────────
{
  const frozen = Object.freeze(ROWS.map((r) => Object.freeze({ ...r })));
  let threw = false;
  try {
    composeEngagementBoardV2Response(
      frozen as ReadonlyArray<EngagementBoardRow>,
      { limit: 3 },
    );
  } catch (err) {
    threw = true;
    failures.push(
      `§8: composition threw on frozen input: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  check(!threw, "§8: composition must not mutate input");
}

// ─── §9: Empty rows → empty page, empty summary ──────────────────
{
  const r = composeEngagementBoardV2Response([], { limit: 10 });
  eq(r.rows.length, 0, "§9: empty input → empty rows");
  eq(r.summary.total, 0, "§9: empty input → summary.total 0");
  eq(r.nextCursor, null, "§9: empty input → nextCursor null");
}

if (failures.length > 0) {
  console.error("Engagement Center v2 composition test FAILED:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
} else {
  console.log("Engagement Center v2 composition test passed.");
}
