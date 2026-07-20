/**
 * Deterministic value normalization for matching signals.
 *
 * These helpers convert raw demographic values into the canonical form
 * stored in `patient_external_identifiers.normalized_or_hashed_match_value`
 * and used inside the resolver's signal-count logic.
 *
 * All helpers are pure and safe for browser bundling if ever needed;
 * no side effects, no environment lookups.
 */

/** Strip diacritics, collapse whitespace, drop punctuation, uppercase. */
export function normalizeName(input: string | null | undefined): string {
  if (!input) return "";
  const stripped = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
  return stripped
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** ISO-like `YYYY-MM-DD` or empty. Rejects malformed input rather than guessing. */
export function normalizeDob(input: string | null | undefined): string {
  if (!input) return "";
  const trimmed = String(input).trim();
  const m = trimmed.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (m) {
    const y = m[1];
    const mo = m[2].padStart(2, "0");
    const d = m[3].padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  const m2 = trimmed.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m2) {
    const mo = m2[1].padStart(2, "0");
    const d = m2[2].padStart(2, "0");
    return `${m2[3]}-${mo}-${d}`;
  }
  return "";
}

/** Drop all non-digits, take rightmost 10 (US NANP). */
export function normalizePhone(input: string | null | undefined): string {
  if (!input) return "";
  const digits = String(input).replace(/\D+/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/** Lowercase + trim. */
export function normalizeEmail(input: string | null | undefined): string {
  if (!input) return "";
  return String(input).trim().toLowerCase();
}

/** Trim, collapse whitespace, uppercase. Suitable for clinic MRN comparison. */
export function normalizeMrn(input: string | null | undefined): string {
  if (!input) return "";
  return String(input).replace(/\s+/g, " ").trim().toUpperCase();
}
