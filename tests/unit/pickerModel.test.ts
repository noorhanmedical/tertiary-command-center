// Unit tests for the PURE SchedulingPicker presentation model.
// Run: npx tsx tests/unit/pickerModel.test.ts

import assert from "node:assert/strict";
import {
  formatMinutes,
  partOfDayFor,
  toPickerTimeSlots,
  bookableSlots,
  groupBookableSlots,
  formatSelectedDate,
  type EngineSlot,
} from "../../shared/scheduling/pickerModel";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function slot(o: Partial<EngineSlot> & { startMinutes: number }): EngineSlot {
  const h = Math.floor(o.startMinutes / 60);
  const mm = o.startMinutes % 60;
  return {
    time: `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
    startMinutes: o.startMinutes,
    available: o.available ?? 1,
    total: o.total ?? 1,
    fits: o.fits ?? true,
    capacityFits: o.capacityFits ?? true,
    constraint: o.constraint,
  };
}

check("formatMinutes: 12h AM/PM formatting", () => {
  assert.equal(formatMinutes(0), "12:00 AM");
  assert.equal(formatMinutes(8 * 60), "8:00 AM");
  assert.equal(formatMinutes(8 * 60 + 30), "8:30 AM");
  assert.equal(formatMinutes(12 * 60), "12:00 PM");
  assert.equal(formatMinutes(13 * 60), "1:00 PM");
});

check("partOfDayFor: morning/afternoon/evening boundaries", () => {
  assert.equal(partOfDayFor(8 * 60), "morning");
  assert.equal(partOfDayFor(12 * 60), "afternoon");
  assert.equal(partOfDayFor(17 * 60), "evening");
});

check("toPickerTimeSlots: labels + bookable flags", () => {
  const out = toPickerTimeSlots([
    slot({ startMinutes: 8 * 60 }),
    slot({ startMinutes: 9 * 60, capacityFits: false }),
    slot({ startMinutes: 10 * 60, constraint: "full" }),
    slot({ startMinutes: 11 * 60, constraint: "off_day" }), // soft → still bookable
  ]);
  assert.equal(out[0].label, "8:00 AM");
  assert.equal(out[0].bookable, true);
  assert.equal(out[1].bookable, false); // capacity does not fit
  assert.equal(out[2].bookable, false); // full = hard block
  assert.equal(out[3].bookable, true); // off_day soft
});

check("bookableSlots: filters to bookable + sorts by time", () => {
  const out = bookableSlots([
    slot({ startMinutes: 10 * 60 }),
    slot({ startMinutes: 8 * 60 }),
    slot({ startMinutes: 9 * 60, constraint: "outage" }),
  ]);
  assert.deepEqual(out.map((s) => s.startMinutes), [8 * 60, 10 * 60]);
});

check("groupBookableSlots: sections, empty omitted", () => {
  const sections = groupBookableSlots([
    slot({ startMinutes: 8 * 60 }),
    slot({ startMinutes: 9 * 60 }),
    slot({ startMinutes: 13 * 60 }),
  ]);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].partOfDay, "morning");
  assert.equal(sections[0].slots.length, 2);
  assert.equal(sections[1].partOfDay, "afternoon");
  assert.equal(sections[1].slots.length, 1);
});

check("formatSelectedDate: no timezone drift", () => {
  assert.deepEqual(formatSelectedDate("2026-09-15"), {
    weekday: "Tuesday",
    monthDay: "September 15",
    full: "Tuesday, September 15",
  });
});
check("formatSelectedDate: invalid/empty → null", () => {
  assert.equal(formatSelectedDate(""), null);
  assert.equal(formatSelectedDate("not-a-date"), null);
  assert.equal(formatSelectedDate("2026-13-40"), null);
});

console.log(`\npickerModel.test.ts — ${passed} assertions passed`);
