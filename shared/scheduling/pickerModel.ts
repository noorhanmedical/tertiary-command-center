// PURE presentation model for the shared iOS/Zocdoc-like SchedulingPicker.
//
// The scheduling MATH (capacity, tech resources, service duration, double-book
// rules, clinic hours, existing appointments) stays entirely server-side in the
// canonical availability engine (server/services/scheduling/availabilityService
// → @shared/scheduling/availabilityEngine, exposed at POST
// /api/scheduling/availability). This module ONLY reshapes that engine's slot
// output into the simple, large-target time buttons the picker renders, and
// formats the selected-date header. No imports, no side effects, no DB — so the
// picker's presentation rules are unit-testable without a browser.

/** Minimal shape the picker needs from the engine's SlotAvailability. */
export type EngineSlot = {
  /** "HH:MM" 24h wall-clock. */
  time: string;
  startMinutes: number;
  /** Remaining capacity at this slot. */
  available: number;
  total: number;
  /** Service block fits the remaining day. */
  fits: boolean;
  /** Capacity fits (a machine is free). */
  capacityFits: boolean;
  /** Soft constraint, when present ("full" | "off_day" | "outage"). */
  constraint?: "full" | "off_day" | "outage";
};

export type PickerTimeSlot = {
  time: string;
  label: string; // "9:00 AM"
  startMinutes: number;
  /** Bookable without an override (capacity + duration both fit, not full/outage). */
  bookable: boolean;
  partOfDay: PartOfDay;
};

export type PartOfDay = "morning" | "afternoon" | "evening";

/** "09:00" / minutes → "9:00 AM". Deterministic, tz-agnostic. */
export function formatMinutes(minutes: number): string {
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}

export function partOfDayFor(startMinutes: number): PartOfDay {
  if (startMinutes < 12 * 60) return "morning";
  if (startMinutes < 17 * 60) return "afternoon";
  return "evening";
}

/**
 * Map engine slots → picker time slots. A slot is `bookable` when the service
 * fits AND capacity fits AND it is not a hard capacity constraint (full /
 * outage). `off_day` is a SOFT constraint and remains selectable (the server
 * still owns the override path), matching the engine's own semantics.
 */
export function toPickerTimeSlots(slots: ReadonlyArray<EngineSlot>): PickerTimeSlot[] {
  return slots.map((s) => {
    const hardBlocked = s.constraint === "full" || s.constraint === "outage";
    return {
      time: s.time,
      label: formatMinutes(s.startMinutes),
      startMinutes: s.startMinutes,
      bookable: s.fits && s.capacityFits && !hardBlocked,
      partOfDay: partOfDayFor(s.startMinutes),
    };
  });
}

/** Only the slots a patient can actually pick (bookable), sorted by time. */
export function bookableSlots(slots: ReadonlyArray<EngineSlot>): PickerTimeSlot[] {
  return toPickerTimeSlots(slots)
    .filter((s) => s.bookable)
    .sort((a, b) => a.startMinutes - b.startMinutes);
}

export type PickerSection = { partOfDay: PartOfDay; label: string; slots: PickerTimeSlot[] };

const PART_LABEL: Record<PartOfDay, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

/** Group bookable slots into Morning / Afternoon / Evening sections (empty
 *  sections omitted). Keeps the right panel scannable without clutter. */
export function groupBookableSlots(slots: ReadonlyArray<EngineSlot>): PickerSection[] {
  const bookable = bookableSlots(slots);
  const order: PartOfDay[] = ["morning", "afternoon", "evening"];
  return order
    .map((p) => ({
      partOfDay: p,
      label: PART_LABEL[p],
      slots: bookable.filter((s) => s.partOfDay === p),
    }))
    .filter((sec) => sec.slots.length > 0);
}

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type SelectedDateParts = {
  /** "Tuesday" */
  weekday: string;
  /** "September 15" */
  monthDay: string;
  /** "Tuesday, September 15" */
  full: string;
} | null;

/**
 * Format a YYYY-MM-DD into the picker's date header parts. Parsed as a plain
 * calendar date (no timezone shift) so "2026-09-15" always renders Sept 15.
 * Returns null for missing/invalid input.
 */
export function formatSelectedDate(iso: string | null | undefined): SelectedDateParts {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Construct a UTC date purely to derive the weekday; no local tz drift.
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (Number.isNaN(dt.getTime())) return null;
  const weekday = WEEKDAYS[dt.getUTCDay()];
  const monthDay = `${MONTHS[mo - 1]} ${d}`;
  return { weekday, monthDay, full: `${weekday}, ${monthDay}` };
}
