// Physician Portal — reports/metrics pure rules.
//
// Zero I/O, zero DB imports. Bounds the caller-supplied window params so
// the aggregate SQL can't be run over an unbounded range. Unit-testable
// without DATABASE_URL.

/** Default window: last `days` days ending at 'now'. Bounded window prevents
 *  the aggregate queries from ever scanning the full procedure_events
 *  table. */
export function defaultAncillaryMetricsWindow(
  now: Date = new Date(),
  days = 30,
): { startsAt: Date; endsAt: Date } {
  const endsAt = new Date(now.getTime());
  const startsAt = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { startsAt, endsAt };
}

/** Bounds the caller-supplied `days` to a safe range [1, 365]. NaN /
 *  non-numeric input falls back to `fallback`. */
export function clampDaysWindow(daysRaw: unknown, fallback = 30): number {
  const n = typeof daysRaw === "number" ? daysRaw : parseInt(String(daysRaw ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(1, Math.round(n)), 365);
}
