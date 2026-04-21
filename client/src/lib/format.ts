// Canonical formatters for dates, times, currency, and names.
// New components should import from here; existing components will be migrated
// in a follow-up task (Phase 6 of the architecture canonicalization).
//
// All date helpers accept either a Date, a string, or null/undefined and
// return a stable string ("—" when input is missing) so callers can drop them
// into JSX without conditional logic.

const MISSING = "—";

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Apr 21, 2026" — short, locale-independent display for table cells. */
export function formatDate(value: Date | string | null | undefined): string {
  const d = asDate(value);
  if (!d) return MISSING;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** "04/21/2026" — compact numeric form for dense rows. */
export function formatDateNumeric(value: Date | string | null | undefined): string {
  const d = asDate(value);
  if (!d) return MISSING;
  return d.toLocaleDateString("en-US");
}

/** "Tuesday, April 21" — page/header presentation, no year. */
export function formatDateHeader(value: Date | string | null | undefined): string {
  const d = asDate(value);
  if (!d) return MISSING;
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

/** "3:45 PM" — 12-hour clock for call-list rows and audit logs. */
export function formatTime12(value: Date | string | null | undefined): string {
  const d = asDate(value);
  if (!d) return MISSING;
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "Apr 21, 2026 at 3:45 PM" — combined date and time. */
export function formatDateTime(value: Date | string | null | undefined): string {
  const d = asDate(value);
  if (!d) return MISSING;
  return `${formatDate(d)} at ${formatTime12(d)}`;
}

/** USD currency formatter. Accepts numbers or numeric strings; "—" on null. */
export function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return MISSING;
  const n = typeof value === "number" ? value : parseFloat(value);
  if (Number.isNaN(n)) return MISSING;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** "Smith, J." style. Falls back to the input if no comma is present. */
export function formatPatientNameShort(name: string | null | undefined): string {
  if (!name) return MISSING;
  const parts = name.split(",").map((s) => s.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) return name;
  const initial = parts[1].charAt(0).toUpperCase();
  return `${parts[0]}, ${initial}.`;
}

/** Initials for avatars. "Jane Doe" → "JD". */
export function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.replace(",", " ").trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
