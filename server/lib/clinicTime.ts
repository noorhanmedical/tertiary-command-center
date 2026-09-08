// Clinic-local time helpers (Phase 2). Timezone-correct and DST-safe via IANA
// semantics (Intl.DateTimeFormat) — NO hard-coded UTC offsets, NO server-local
// assumptions. Pure (no DB).
//
// "5:00 AM" for a clinic means 5:00 AM in the CLINIC'S OWN IANA timezone
// (e.g. America/Chicago, America/Phoenix, America/New_York, America/Los_Angeles).
// These helpers derive a clinic's local operational date / local hour from a
// UTC instant, and convert a clinic-local wall-clock date+time back to a UTC
// instant — the two directions the 5 AM reconciliation trigger and the
// business-day retry roll need.

import {
  isBusinessDay,
  nextBusinessDayOnOrAfter,
  type BusinessDayOptions,
} from "@shared/businessDay";

/** The schema default (clinics.timezone DEFAULT 'America/Chicago'). Used as the
 *  OBSERVABLE fallback when a clinic has no valid configured timezone — never
 *  the server's local timezone. */
export const DEFAULT_CLINIC_TIME_ZONE = "America/Chicago";

/** True when `tz` is a valid IANA timezone identifier the runtime understands. */
export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    // Throws RangeError for an unknown/invalid IANA zone.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** The local wall-clock parts of an instant, as seen in `timeZone`. */
function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = fmt.formatToParts(instant);
  const get = (t: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === t)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Clinic operational date (YYYY-MM-DD) for an instant, in the clinic's tz. */
export function operationalDateInTimeZone(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Local hour (0–23) for an instant, in the clinic's tz. */
export function hourInTimeZone(instant: Date, timeZone: string): number {
  return zonedParts(instant, timeZone).hour;
}

/** Minutes since local midnight (0–1439) for an instant, in the clinic's tz. */
export function localMinutesInTimeZone(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  return p.hour * 60 + p.minute;
}

/** Local weekday (0=Sun … 6=Sat) for an instant, in the clinic's tz. */
export function weekdayInTimeZone(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  // Construct a UTC date from the local wall-clock parts and read its weekday
  // (weekday is independent of the offset once the calendar date is fixed).
  return new Date(Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0)).getUTCDay();
}

/**
 * UTC offset (minutes) of `timeZone` at `instant`, e.g. -300 for America/Chicago
 * during CDT, -360 during CST. Computed by re-interpreting the zone's wall clock
 * as UTC and diffing — DST-correct because the wall clock reflects the active
 * offset at that instant.
 */
function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((wallAsUtc - instant.getTime()) / 60000);
}

/**
 * Convert a clinic-local wall clock (YYYY-MM-DD + minutes-past-midnight) to the
 * UTC instant it represents in `timeZone`. DST-correct: the initial guess uses
 * the offset at the naive instant, then one refinement pins the true offset
 * (stable for all non-transition times; the second read resolves the rare
 * spring-forward / fall-back boundary).
 */
export function zonedWallClockToUtc(
  isoDate: string,
  minutesOfDay: number,
  timeZone: string,
): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  const hour = Math.floor(minutesOfDay / 60);
  const minute = ((minutesOfDay % 60) + 60) % 60;
  const wallAsUtcMs = Date.UTC(y, m - 1, d, hour, minute, 0);
  // UTC = wall − offset (offset is negative for zones west of UTC).
  let utc = new Date(wallAsUtcMs - tzOffsetMinutes(new Date(wallAsUtcMs), timeZone) * 60000);
  utc = new Date(wallAsUtcMs - tzOffsetMinutes(utc, timeZone) * 60000);
  return utc;
}

/**
 * If `instant` falls on a clinic-local business day, return it unchanged.
 * Otherwise roll it FORWARD to the next business day, PRESERVING the local
 * time-of-day (a Saturday 14:32 retry becomes Monday 14:32 local, converted
 * back to UTC). This fixes weekend/holiday callbacks without inventing new
 * cadence numbers or intra-day contact-hour windows (none exist in the
 * platform today; a future contact-hours policy can extend this helper).
 */
export function rollInstantToBusinessDay(
  instant: Date,
  timeZone: string,
  opts: BusinessDayOptions = {},
): Date {
  const isoDate = operationalDateInTimeZone(instant, timeZone);
  if (isBusinessDay(isoDate, opts)) return instant;
  const targetDate = nextBusinessDayOnOrAfter(isoDate, opts);
  const p = zonedParts(instant, timeZone);
  const minutesOfDay = p.hour * 60 + p.minute;
  return zonedWallClockToUtc(targetDate, minutesOfDay, timeZone);
}
