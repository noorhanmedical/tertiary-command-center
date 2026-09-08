// Timezone helpers for the World Time row. IANA timezone names only; the
// timezone abbreviation and date are derived from Intl (never hard-coded, so
// DST is handled correctly by the platform's tz database).

export type ZonedTime = {
  hours: number;
  minutes: number;
  seconds: number;
  /** e.g. "5:14 PM" */
  digital: string;
  /** compact date, e.g. "Sep 4" */
  date: string;
  /** derived abbreviation, e.g. "CDT" */
  abbr: string;
};

export function getZonedTime(timeZone: string, now: Date): ZonedTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);

  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  let hours = pick("hour");
  if (hours === 24) hours = 0;
  const minutes = pick("minute");
  const seconds = pick("second");

  const digital = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: true,
    hour: "numeric",
    minute: "2-digit",
  }).format(now);

  const date = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
  }).format(now);

  const abbrParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
    hour: "2-digit",
  }).formatToParts(now);
  const abbr = abbrParts.find((p) => p.type === "timeZoneName")?.value ?? "";

  return { hours, minutes, seconds, digital, date, abbr };
}

/** Best-effort list of IANA zones for the editor combobox. */
export function getSupportedTimeZones(fallback: string[]): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (typeof fn === "function") return fn("timeZone");
  } catch {
    /* ignore */
  }
  return fallback;
}
