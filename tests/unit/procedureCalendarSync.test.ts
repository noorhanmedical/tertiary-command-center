// Unit test for shouldClearProcedureCompleteMirror — the pure decision
// rule that drives whether a procedure_complete calendar mirror row
// should be deleted when a procedure event is updated.
//
// The mirror exists so the calendar's procedureCompleted filter (a
// default filter on 11 calendar profiles in calendarProfiles.ts) has
// events to render. When a completed procedure is reopened /
// cancelled / no-shown / rolled back, the ✓ badge must disappear.

import assert from "node:assert/strict";
import { shouldClearProcedureCompleteMirror } from "../../server/services/procedureEvents/procedureCalendarSyncRules";

let failures = 0;
function expect(actual: unknown, expected: unknown, label: string): void {
  try {
    assert.strictEqual(actual, expected);
  } catch {
    failures++;
    console.error(`- ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─── §1: updates that do not touch procedureStatus → do NOT clear ─
expect(
  shouldClearProcedureCompleteMirror({}),
  false,
  "§1 empty updates → do not clear",
);
expect(
  shouldClearProcedureCompleteMirror({ note: "revised note" }),
  false,
  "§1 note-only update → do not clear",
);
expect(
  shouldClearProcedureCompleteMirror({ completedByUserId: "user-1" }),
  false,
  "§1 completedByUserId-only update → do not clear",
);

// ─── §2: procedureStatus explicitly undefined → do NOT clear ──────
// Partial<InsertProcedureEvent> allows explicit undefined; treat that as
// "not touched" so a caller that spreads a super-set object doesn't
// accidentally clear the mirror.
expect(
  shouldClearProcedureCompleteMirror({ procedureStatus: undefined }),
  false,
  "§2 explicit undefined → do not clear",
);

// ─── §3: procedureStatus === "complete" → do NOT clear ────────────
// The complete-path is (re)upserted by markProcedureComplete, not
// cleared. Guards against a re-complete accidentally deleting the row.
expect(
  shouldClearProcedureCompleteMirror({ procedureStatus: "complete" }),
  false,
  "§3 status → complete: do not clear (upsert path handles it)",
);

// ─── §4: procedureStatus transitions AWAY from complete → CLEAR ───
for (const status of [
  "not_started",
  "in_progress",
  "no_show",
  "cancelled",
  "reopened",
  "on_hold",
  "",
]) {
  expect(
    shouldClearProcedureCompleteMirror({ procedureStatus: status }),
    true,
    `§4 status → ${JSON.stringify(status)}: clear`,
  );
}

// ─── §5: procedureStatus === null → CLEAR ─────────────────────────
// null indicates "no status" — the mirror should be removed rather than
// stale. Explicit null differs from "unset" (§2).
expect(
  shouldClearProcedureCompleteMirror({ procedureStatus: null }),
  true,
  "§5 explicit null → clear",
);

// ─── §6: extra unrelated fields do not affect decision ────────────
expect(
  shouldClearProcedureCompleteMirror({
    procedureStatus: "cancelled",
    note: "x",
    completedByUserId: "u",
  }),
  true,
  "§6 extra fields ignored, decision follows procedureStatus",
);

if (failures > 0) {
  console.error(`procedureCalendarSync.test.ts: ${failures} failure(s)`);
  process.exit(1);
}
console.log("procedureCalendarSync.test.ts: all tests passed");
