// Phase 2 — business-day calendar + clinic-local timezone helpers.
// DB-free, deterministic. Run: npx tsx tests/unit/businessDayAndClinicTime.test.ts

import assert from "node:assert/strict";
import {
  weekdayOfIso,
  addCalendarDays,
  isBusinessDay,
  nextBusinessDay,
  nextBusinessDayOnOrAfter,
  addBusinessDays,
} from "../../shared/businessDay";
import {
  DEFAULT_CLINIC_TIME_ZONE,
  isValidTimeZone,
  operationalDateInTimeZone,
  hourInTimeZone,
  zonedWallClockToUtc,
  rollInstantToBusinessDay,
} from "../../server/lib/clinicTime";

function firstIsoWithWeekday(target: number): string {
  let d = "2026-06-01";
  for (let i = 0; i < 8; i++) {
    if (weekdayOfIso(d) === target) return d;
    d = addCalendarDays(d, 1);
  }
  throw new Error(`no date found for weekday ${target}`);
}

async function main() {
  // ── Business-day math (weekday semantics, deterministic) ──────────────────
  const friday = firstIsoWithWeekday(5);
  const saturday = addCalendarDays(friday, 1);
  const sunday = addCalendarDays(friday, 2);
  const monday = addCalendarDays(friday, 3);

  assert.equal(weekdayOfIso(friday), 5, "friday premise");
  assert.equal(isBusinessDay(friday), true, "Friday IS a business day");
  assert.equal(isBusinessDay(saturday), false, "Saturday is NOT a business day");
  assert.equal(isBusinessDay(sunday), false, "Sunday is NOT a business day");

  // Friday + next business day → Monday
  assert.equal(nextBusinessDay(friday), monday, "Friday next business day → Monday");
  assert.equal(weekdayOfIso(nextBusinessDay(friday)), 1, "→ Monday weekday");

  // Weekend starting timestamp → next eligible business date (Monday)
  assert.equal(nextBusinessDayOnOrAfter(saturday), monday, "Saturday → Monday");
  assert.equal(nextBusinessDayOnOrAfter(sunday), monday, "Sunday → Monday");
  assert.equal(nextBusinessDayOnOrAfter(friday), friday, "Friday on-or-after → Friday (unchanged)");

  // Friday + 3 business days → the following Wednesday
  const wed = addBusinessDays(friday, 3);
  assert.equal(weekdayOfIso(wed), 3, "Friday + 3 business days → Wednesday");
  assert.equal(wed, addCalendarDays(friday, 5), "Friday + 3 business days = +5 calendar days (skips weekend)");

  // Pluggable closure hook: mark Monday closed → Friday rolls to Tuesday.
  const closedMonday = { isClosed: (iso: string) => iso === monday };
  assert.equal(nextBusinessDay(friday, closedMonday), addCalendarDays(friday, 4), "closed Monday → Tuesday");
  assert.equal(isBusinessDay(monday, closedMonday), false, "closed Monday not a business day");

  // ── Timezone helpers ──────────────────────────────────────────────────────
  assert.equal(DEFAULT_CLINIC_TIME_ZONE, "America/Chicago");
  assert.equal(isValidTimeZone("America/Chicago"), true);
  assert.equal(isValidTimeZone("America/Phoenix"), true);
  assert.equal(isValidTimeZone("Not/AZone"), false);
  assert.equal(isValidTimeZone(""), false);
  assert.equal(isValidTimeZone(null), false);

  // Operational date + local hour derived from a UTC instant (summer/DST-on).
  const instant = new Date("2026-06-15T02:00:00Z");
  assert.equal(operationalDateInTimeZone(instant, "America/Chicago"), "2026-06-14", "02:00Z → 21:00 CDT prev day");
  assert.equal(hourInTimeZone(instant, "America/Chicago"), 21);
  assert.equal(operationalDateInTimeZone(instant, "America/New_York"), "2026-06-14");
  assert.equal(hourInTimeZone(instant, "America/New_York"), 22);
  assert.equal(hourInTimeZone(instant, "America/Phoenix"), 19); // MST, no DST

  // Different clinic timezones → different UTC instants for the SAME local 5 AM.
  const chi5 = zonedWallClockToUtc("2026-06-15", 5 * 60, "America/Chicago"); // CDT -5 → 10:00Z
  const ny5 = zonedWallClockToUtc("2026-06-15", 5 * 60, "America/New_York"); // EDT -4 → 09:00Z
  const phx5 = zonedWallClockToUtc("2026-06-15", 5 * 60, "America/Phoenix"); // MST -7 → 12:00Z
  assert.equal(chi5.toISOString(), "2026-06-15T10:00:00.000Z", "Chicago 5AM CDT → 10:00Z");
  assert.equal(ny5.toISOString(), "2026-06-15T09:00:00.000Z", "New York 5AM EDT → 09:00Z");
  assert.equal(phx5.toISOString(), "2026-06-15T12:00:00.000Z", "Phoenix 5AM MST → 12:00Z");
  assert.ok(chi5.getTime() !== ny5.getTime() && ny5.getTime() !== phx5.getTime(), "distinct UTC instants");

  // Round-trip: the UTC instant reads back as 5 AM local, same date.
  assert.equal(hourInTimeZone(chi5, "America/Chicago"), 5);
  assert.equal(operationalDateInTimeZone(chi5, "America/Chicago"), "2026-06-15");

  // DST correctness: SAME local 5 AM maps to DIFFERENT UTC across CST↔CDT.
  const chiWinter5 = zonedWallClockToUtc("2026-01-15", 5 * 60, "America/Chicago"); // CST -6 → 11:00Z
  assert.equal(chiWinter5.toISOString(), "2026-01-15T11:00:00.000Z", "Chicago 5AM CST → 11:00Z");
  assert.equal(hourInTimeZone(chiWinter5, "America/Chicago"), 5, "winter reads back as 5 AM local");
  assert.notEqual(chi5.getUTCHours(), chiWinter5.getUTCHours(), "CDT vs CST differ by an hour in UTC");

  // ── rollInstantToBusinessDay ──────────────────────────────────────────────
  // A business-day instant passes through UNCHANGED.
  const fridayNoon = zonedWallClockToUtc(friday, 12 * 60, "America/Chicago");
  assert.equal(rollInstantToBusinessDay(fridayNoon, "America/Chicago").getTime(), fridayNoon.getTime(), "business-day instant unchanged");

  // A Saturday-local retry rolls to Monday, PRESERVING local time-of-day.
  const satAfternoon = zonedWallClockToUtc(saturday, 14 * 60 + 32, "America/Chicago");
  const rolled = rollInstantToBusinessDay(satAfternoon, "America/Chicago");
  assert.equal(operationalDateInTimeZone(rolled, "America/Chicago"), monday, "Saturday retry → Monday local date");
  assert.equal(hourInTimeZone(rolled, "America/Chicago"), 14, "local hour-of-day preserved (14)");
  assert.ok(rolled.getTime() > satAfternoon.getTime(), "rolled forward");

  console.log("business-day + clinic-time helpers: all checks passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
