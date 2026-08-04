// Phase 2J — deterministic fixed-precision money (shared server + client).
//
// The repo stores money as NUMERIC(12,2) decimal STRINGS. To avoid JavaScript
// floating-point drift on persisted totals, ALL canonical financial arithmetic is
// done in INTEGER CENTS (safe integers) and serialized back to a 2-decimal string.
// Never `parseFloat` + `+` on persisted totals; always go through cents here.

export type Currency = string; // e.g. "USD" — currencies must match to combine.

const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER; // ~9.007e15 cents — far beyond any real total

/** Parse a decimal money string/number to integer cents. Throws on NaN/Infinity or
 *  a non-2-decimal-representable value. Negative is allowed (caller decides policy). */
export function toCents(value: string | number | null | undefined): number {
  if (value == null || value === "") throw new MoneyError("money_empty");
  const s = typeof value === "number" ? (Number.isFinite(value) ? value.toString() : "NaN") : value.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new MoneyError("money_not_fixed_precision");
  const neg = s.startsWith("-");
  const [whole, frac = ""] = (neg ? s.slice(1) : s).split(".");
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > MAX_SAFE_CENTS) throw new MoneyError("money_out_of_range");
  return neg ? -cents : cents;
}

/** Serialize integer cents to a NUMERIC(12,2) decimal string. */
export function centsToString(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new MoneyError("money_out_of_range");
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

/** Exact sum of cents. */
export function sumCents(values: number[]): number {
  let total = 0;
  for (const v of values) {
    if (!Number.isSafeInteger(v)) throw new MoneyError("money_out_of_range");
    total += v;
    if (!Number.isSafeInteger(total)) throw new MoneyError("money_out_of_range");
  }
  return total;
}

/** A single money line for a claim/invoice, validated deterministically. */
export type MoneyLine = { lineId: string; description?: string; amount: string; source: string; unit?: number };

export type LineValidation = { ok: true; totalCents: number } | { ok: false; code: string };

/** Validate a line-item set and return the exact reconciled total in cents.
 *  Rejects duplicate line identity, NaN/Infinity, unsupported negatives (unless the
 *  line is an explicit adjustment), fractional-cent, and out-of-range totals. */
export function reconcileLines(lines: MoneyLine[], opts: { allowNegative?: boolean } = {}): LineValidation {
  if (!Array.isArray(lines)) return { ok: false, code: "lines_invalid" };
  const seen = new Set<string>();
  const centsList: number[] = [];
  for (const l of lines) {
    if (!l || typeof l.lineId !== "string" || l.lineId.length === 0) return { ok: false, code: "line_missing_id" };
    if (seen.has(l.lineId)) return { ok: false, code: "line_duplicate_identity" };
    seen.add(l.lineId);
    if (typeof l.source !== "string" || l.source.length === 0) return { ok: false, code: "line_missing_source" };
    if (l.unit != null && (!Number.isInteger(l.unit) || l.unit < 0)) return { ok: false, code: "line_negative_units" };
    let c: number;
    try { c = toCents(l.amount); } catch { return { ok: false, code: "line_amount_invalid" }; }
    if (c < 0 && !opts.allowNegative) return { ok: false, code: "line_negative_amount" };
    centsList.push(c);
  }
  try { return { ok: true, totalCents: sumCents(centsList) }; }
  catch { return { ok: false, code: "line_total_out_of_range" }; }
}

export class MoneyError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = "MoneyError"; }
}
