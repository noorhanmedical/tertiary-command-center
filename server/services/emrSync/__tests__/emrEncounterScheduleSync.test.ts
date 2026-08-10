// EMR Encounter schedule sync — pure-logic tests (no DB, no network, no PHI).
//
// Runnable via:
//   npx tsx server/services/emrSync/__tests__/emrEncounterScheduleSync.test.ts
//
// Exercises the two pure functions that govern what gets written:
//   - scopeEncounters()   — the planned+recent scope rule (safety rule #2)
//   - mapEncounterStatus() — FHIR Encounter.status → global_schedule_events.status
//
// These are the highest-risk pieces (they decide volume + status semantics)
// and are fully deterministic, so they test cleanly without a database.

import { scopeEncounters, type ParsedEncounter } from "../emrEncounterScheduleSync";
import { mapEncounterStatus } from "../../../repositories/emrEncounterSchedule.repo";

const failures: string[] = [];
function check(cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}
function eq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    failures.push(`${label}: expected ${String(expected)} got ${String(actual)}`);
  }
}

const TODAY = "2026-06-28";

function enc(over: Partial<ParsedEncounter> & { start?: string }): ParsedEncounter {
  const { start, ...rest } = over;
  return {
    id: "enc-1",
    status: "planned",
    period: { start: start ?? "2026-07-01T09:00:00-05:00" },
    ...rest,
  };
}

// ─── scopeEncounters ────────────────────────────────────────────────────────

// 1. A future planned encounter is in scope.
{
  const out = scopeEncounters([enc({ start: "2026-07-17T09:00:00-05:00" })], TODAY, 30);
  eq(out.length, 1, "§1 future planned in scope");
}

// 2. A planned encounter dated in the PAST is NOT in scope (planned must be >= today)
//    unless it falls in the recent window — 2026-06-01 is >29d before, so out.
{
  const out = scopeEncounters([enc({ status: "planned", start: "2026-05-01T09:00:00-05:00" })], TODAY, 30);
  eq(out.length, 0, "§2 old planned excluded");
}

// 3. A finished encounter inside the recent window (within 30d) IS in scope
//    (so show/no-show transitions land on the row).
{
  const out = scopeEncounters([enc({ status: "finished", start: "2026-06-10T09:00:00-05:00" })], TODAY, 30);
  eq(out.length, 1, "§3 recent finished in scope");
}

// 4. A finished encounter OUTSIDE the recent window (the deep history) is excluded.
{
  const out = scopeEncounters([enc({ status: "finished", start: "2025-01-10T09:00:00-05:00" })], TODAY, 30);
  eq(out.length, 0, "§4 deep finished history excluded");
}

// 5. An encounter with no start date is excluded.
{
  const out = scopeEncounters([{ id: "x", status: "planned", period: {} }], TODAY, 30);
  eq(out.length, 0, "§5 missing start excluded");
}

// 6. Mixed batch: only the in-scope ones survive, count is exact.
{
  const batch: ParsedEncounter[] = [
    enc({ id: "a", status: "planned", start: "2026-07-02T09:00:00-05:00" }),  // in
    enc({ id: "b", status: "finished", start: "2026-06-20T09:00:00-05:00" }), // in (recent)
    enc({ id: "c", status: "finished", start: "2024-03-01T09:00:00-05:00" }), // out (old)
    enc({ id: "d", status: "planned", start: "2026-04-01T09:00:00-05:00" }),  // out (old planned)
  ];
  const out = scopeEncounters(batch, TODAY, 30);
  eq(out.length, 2, "§6 mixed batch keeps 2");
  eq(out.map((e) => e.id).sort().join(","), "a,b", "§6 keeps a,b");
}

// ─── mapEncounterStatus ──────────────────────────────────────────────────────

eq(mapEncounterStatus("planned"), "scheduled", "§7 planned→scheduled");
eq(mapEncounterStatus("arrived"), "scheduled", "§7 arrived→scheduled");
eq(mapEncounterStatus("in-progress"), "scheduled", "§7 in-progress→scheduled");
eq(mapEncounterStatus("finished"), "completed", "§7 finished→completed");
eq(mapEncounterStatus("cancelled"), "cancelled", "§7 cancelled→cancelled");
eq(mapEncounterStatus("entered-in-error"), "cancelled", "§7 entered-in-error→cancelled");
eq(mapEncounterStatus("noshow"), "no_show", "§7 noshow→no_show");
eq(mapEncounterStatus("no-show"), "no_show", "§7 no-show→no_show");
eq(mapEncounterStatus("unknown"), "scheduled", "§7 unknown→scheduled (default)");
eq(mapEncounterStatus(null), "scheduled", "§7 null→scheduled (default)");
eq(mapEncounterStatus("PLANNED"), "scheduled", "§7 case-insensitive");

// ─── Report ──────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\n✓ emrEncounterScheduleSync tests passed (17 assertions).");
