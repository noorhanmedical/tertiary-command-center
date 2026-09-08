// Outreach business-day calendar (Phase 2). PURE, deterministic, and
// timezone-agnostic: it operates on YYYY-MM-DD calendar-date strings. The
// clinic-timezone layer (server/lib/clinicTime.ts) derives the LOCAL calendar
// date for an instant; this module answers business-day questions about that
// date and does the day arithmetic.
//
// SCOPE — this is the EMPLOYEE OUTREACH business-day calendar (the days staff
// make calls). It is DELIBERATELY SEPARATE from the equipment operating-day
// calendar in shared/scheduling/availabilityEngine.ts (isOperatingDay /
// facility_resource_capacity.operating_days), which answers "is a specific
// MACHINE POOL run on this weekday" (e.g. ultrasound Tue/Thu). Reusing that
// here would wrongly couple call-retry timing to equipment schedules — an
// ultrasound-only-Tue/Thu clinic would push every outreach retry to Tue/Thu.
//
// HOLIDAYS / CLOSURES — the platform has no clinic holiday/closure source
// today (there is no holiday table; temporary_capacity_overrides is an
// equipment-outage construct, not a clinic closure). The DEFAULT calendar is
// therefore Mon–Fri. A future clinic-specific closure/holiday source plugs in
// via the optional `isClosed` predicate WITHOUT changing any caller, so retry
// timing is never PERMANENTLY hard-coded to Mon–Fri once configuration exists.

/** Business weekdays 0=Sun … 6=Sat. Mon–Fri. Mirrors WEEKDAYS_MON_FRI in
 *  shared/scheduling/capacityDefaults.ts (kept as an independent constant so
 *  the outreach calendar never imports the equipment-scheduling module). */
export const BUSINESS_WEEKDAYS_MON_FRI = [1, 2, 3, 4, 5] as const;

export type BusinessDayOptions = {
  /** Weekdays considered business days (0=Sun … 6=Sat). Defaults to Mon–Fri. */
  businessWeekdays?: readonly number[];
  /**
   * Optional closure/holiday predicate: returns true when the clinic is CLOSED
   * on that calendar date (a holiday or temporary closure). Default = "never
   * closed" — the documented fallback until a real closure source exists. This
   * is the single plug-in point for future clinic-specific holiday config.
   */
  isClosed?: (isoDate: string) => boolean;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a YYYY-MM-DD at UTC-noon. Using noon (not midnight) and UTC makes the
 * weekday/step math DETERMINISTIC regardless of the server's local timezone —
 * the date STRING already encodes the intended calendar day, so we must not
 * let the process TZ shift it. (availabilityEngine.weekdayOf uses server-local
 * `T00:00:00`, which is TZ-dependent; this module intentionally does not.)
 */
function isoToUtcNoon(isoDate: string): Date {
  if (!ISO_DATE_RE.test(isoDate)) {
    throw new Error(`businessDay: invalid ISO date "${String(isoDate)}" (expected YYYY-MM-DD)`);
  }
  const d = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`businessDay: invalid ISO date "${String(isoDate)}"`);
  }
  return d;
}

function toIso(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Weekday (0=Sun … 6=Sat) for a YYYY-MM-DD — deterministic (UTC-based). */
export function weekdayOfIso(isoDate: string): number {
  return isoToUtcNoon(isoDate).getUTCDay();
}

/** Add n CALENDAR days (may be negative) to a YYYY-MM-DD, returning YYYY-MM-DD. */
export function addCalendarDays(isoDate: string, n: number): string {
  const d = isoToUtcNoon(isoDate);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

/** Is this calendar date an eligible outreach business day (weekday + open)? */
export function isBusinessDay(isoDate: string, opts: BusinessDayOptions = {}): boolean {
  const weekdays = opts.businessWeekdays ?? BUSINESS_WEEKDAYS_MON_FRI;
  if (!weekdays.includes(weekdayOfIso(isoDate))) return false;
  if (opts.isClosed?.(isoDate) === true) return false;
  return true;
}

/** The next business day STRICTLY AFTER isoDate. Friday → Monday. */
export function nextBusinessDay(isoDate: string, opts: BusinessDayOptions = {}): string {
  let cur = addCalendarDays(isoDate, 1);
  // ~10-year guard so a pathological all-closed config can never infinite-loop.
  for (let i = 0; i < 3660; i++) {
    if (isBusinessDay(cur, opts)) return cur;
    cur = addCalendarDays(cur, 1);
  }
  throw new Error(`businessDay: no business day found within horizon after "${isoDate}"`);
}

/** isoDate itself when it is a business day, else the next business day. */
export function nextBusinessDayOnOrAfter(isoDate: string, opts: BusinessDayOptions = {}): string {
  return isBusinessDay(isoDate, opts) ? isoDate : nextBusinessDay(isoDate, opts);
}

/**
 * Add n BUSINESS days to a YYYY-MM-DD. addBusinessDays("<Friday>", 1) = Monday;
 * addBusinessDays("<Friday>", 3) = the following Wednesday. n <= 0 resolves to
 * the next business day on-or-after (never returns a non-business day).
 */
export function addBusinessDays(isoDate: string, n: number, opts: BusinessDayOptions = {}): string {
  if (n <= 0) return nextBusinessDayOnOrAfter(isoDate, opts);
  let cur = isoDate;
  for (let remaining = n; remaining > 0; remaining--) {
    cur = nextBusinessDay(cur, opts);
  }
  return cur;
}
