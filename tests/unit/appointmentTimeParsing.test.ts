// Unit test for parseAppointmentTimeMinutes — the appointment-time parser
// that backs the run-ordering sort used by PlexusIQWorkspace,
// PacketPatientSelectionDialog, RunComparisonSelector, and
// PdfPatientSelectDialog.
//
// Previous behaviour (`new Date("9:00 AM").getTime()`) returned Invalid
// Date (NaN) for the raw strings stored in patient_screenings.time —
// e.g. "9:00 AM", "13:30", "0900" — so compareByAppointmentTime
// silently collapsed every visit row to +Infinity and appointment-time
// ordering did not actually happen. This test locks the new parser and
// its supported formats.

import assert from "node:assert/strict";
import { parseAppointmentTimeMinutes } from "../../client/src/lib/qualificationRunOrdering";

let failures = 0;
function expect(actual: unknown, expected: unknown, label: string): void {
  try {
    assert.strictEqual(actual, expected);
  } catch (e) {
    failures++;
    console.error(`- ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─── §1: null / empty / whitespace → null ─────────────────────────
expect(parseAppointmentTimeMinutes(null), null, "§1 null → null");
expect(parseAppointmentTimeMinutes(undefined), null, "§1 undefined → null");
expect(parseAppointmentTimeMinutes(""), null, "§1 empty → null");
expect(parseAppointmentTimeMinutes("   "), null, "§1 whitespace → null");

// ─── §2: 12-hour with meridiem ────────────────────────────────────
expect(parseAppointmentTimeMinutes("9:00 AM"), 9 * 60, "§2 '9:00 AM' → 540");
expect(parseAppointmentTimeMinutes("9:00AM"), 9 * 60, "§2 '9:00AM' → 540");
expect(parseAppointmentTimeMinutes("9:05 am"), 9 * 60 + 5, "§2 '9:05 am' → 545");
expect(parseAppointmentTimeMinutes("9:00 P.M."), 21 * 60, "§2 '9:00 P.M.' → 1260");
expect(parseAppointmentTimeMinutes("11.15 pm"), 23 * 60 + 15, "§2 '11.15 pm' → 1395");
expect(parseAppointmentTimeMinutes("12:00 AM"), 0, "§2 '12:00 AM' → 0 (midnight)");
expect(parseAppointmentTimeMinutes("12:00 PM"), 12 * 60, "§2 '12:00 PM' → 720 (noon)");
expect(parseAppointmentTimeMinutes("12:30 AM"), 30, "§2 '12:30 AM' → 30");
expect(parseAppointmentTimeMinutes("12:30 PM"), 12 * 60 + 30, "§2 '12:30 PM' → 750");

// ─── §3: hour-only with meridiem ──────────────────────────────────
expect(parseAppointmentTimeMinutes("9 am"), 9 * 60, "§3 '9 am' → 540");
expect(parseAppointmentTimeMinutes("9am"), 9 * 60, "§3 '9am' → 540");
expect(parseAppointmentTimeMinutes("3PM"), 15 * 60, "§3 '3PM' → 900");
expect(parseAppointmentTimeMinutes("12 pm"), 12 * 60, "§3 '12 pm' → 720");
expect(parseAppointmentTimeMinutes("12 am"), 0, "§3 '12 am' → 0");

// ─── §4: 24-hour with colon or dot ────────────────────────────────
expect(parseAppointmentTimeMinutes("13:30"), 13 * 60 + 30, "§4 '13:30' → 810");
expect(parseAppointmentTimeMinutes("00:00"), 0, "§4 '00:00' → 0");
expect(parseAppointmentTimeMinutes("23:59"), 23 * 60 + 59, "§4 '23:59' → 1439");
expect(parseAppointmentTimeMinutes("9:00"), 9 * 60, "§4 bare '9:00' (no meridiem) → 540");

// ─── §5: military time "0900" ─────────────────────────────────────
expect(parseAppointmentTimeMinutes("0900"), 9 * 60, "§5 '0900' → 540");
expect(parseAppointmentTimeMinutes("1345"), 13 * 60 + 45, "§5 '1345' → 825");
expect(parseAppointmentTimeMinutes("0000"), 0, "§5 '0000' → 0");

// ─── §6: rejects impossible values ────────────────────────────────
expect(parseAppointmentTimeMinutes("25:00"), null, "§6 hour > 23 → null");
expect(parseAppointmentTimeMinutes("9:75 AM"), null, "§6 minute > 59 → null");
expect(parseAppointmentTimeMinutes("13:00 PM"), null, "§6 12-hour clock with hour > 12 + meridiem → null");
expect(parseAppointmentTimeMinutes("0:00 AM"), null, "§6 12-hour clock with hour < 1 + meridiem → null");
expect(parseAppointmentTimeMinutes("abc"), null, "§6 garbage → null");
expect(parseAppointmentTimeMinutes("N/A"), null, "§6 N/A → null");

// ─── §7: ISO datetime falls back to local time-of-day ─────────────
{
  const iso = "2026-06-12T10:15:00";
  const d = new Date(iso);
  const expected = d.getHours() * 60 + d.getMinutes();
  expect(
    parseAppointmentTimeMinutes(iso),
    expected,
    `§7 '${iso}' → local minutes ${expected}`,
  );
}

// ─── §8: appointmentMs sort orders visit rows correctly ───────────
// Regression for the original bug: previously all these collapsed to
// +Infinity via `new Date("9:00 AM")` = Invalid Date, so the sort was
// a no-op. With the new parser, order is deterministic by time.
{
  const rows = [
    { appointmentTime: "1:00 PM" }, // 780
    { appointmentTime: "9:00 AM" }, // 540
    { appointmentTime: "12:30 PM" }, // 750
    { appointmentTime: null }, // Infinity
    { appointmentTime: "0900" }, // 540
  ];
  const scored = rows
    .map((r) => parseAppointmentTimeMinutes(r.appointmentTime) ?? Number.POSITIVE_INFINITY)
    .slice()
    .sort((a, b) => a - b);
  expect(scored[0], 540, "§8 earliest = 9:00 AM (540)");
  expect(scored[1], 540, "§8 tie for earliest = 0900 (540)");
  expect(scored[2], 750, "§8 next = 12:30 PM (750)");
  expect(scored[3], 780, "§8 next = 1:00 PM (780)");
  expect(scored[4], Number.POSITIVE_INFINITY, "§8 null sorts to end");
}

if (failures > 0) {
  console.error(`appointmentTimeParsing.test.ts: ${failures} failure(s)`);
  process.exit(1);
}
console.log("appointmentTimeParsing.test.ts: all tests passed");
