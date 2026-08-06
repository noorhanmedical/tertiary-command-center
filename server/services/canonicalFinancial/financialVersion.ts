// Phase 2J — shared EXACT financial version selector (read model + stage vector).
//
// A claim/invoice has ONE active working slot plus zero-or-more IMMUTABLE historical
// versions. A submitted claim (or issued invoice) history coexisting with a
// correction draft is VALID and must not read as a duplicate-current conflict. A
// duplicate conflict arises ONLY when more than one row occupies the SAME active
// slot, or two non-superseded rows share the SAME immutable version identity.
// Selection is never first/newest/highest-id/most-advanced/rows[0].

export const CLAIM_ACTIVE_STATUSES = new Set(["not_ready", "ready", "draft", "queued"]);
export const CLAIM_HISTORICAL_STATUSES = new Set(["submitted", "accepted", "rejected", "denied", "partially_paid", "paid"]);
export const INVOICE_ACTIVE_STATUSES = new Set(["draft", "approved"]);
export const INVOICE_HISTORICAL_STATUSES = new Set(["issued", "delivered", "delivery_failed", "partially_paid", "paid"]);

export type VersionRow = {
  canonicalStatus: string; supersededAt: unknown;
  attemptNumber?: number | null; invoiceNumber?: string | null; id?: number;
};
export type ActivePick<R> = { kind: "missing" } | { kind: "one"; row: R } | { kind: "conflict" };

/** The ONE active working row (never rows[0]). 0 → missing, 1 → one, >1 → conflict. */
export function selectActive<R extends VersionRow>(rows: R[], active: Set<string>): ActivePick<R> {
  const a = rows.filter((r) => r.supersededAt == null && active.has(r.canonicalStatus));
  if (a.length === 0) return { kind: "missing" };
  if (a.length > 1) return { kind: "conflict" };
  return { kind: "one", row: a[0] };
}

/** True when non-superseded historical rows collide on the same immutable version
 *  identity (claims: attemptNumber; invoices: invoiceNumber) — a genuine conflict.
 *  Valid history (distinct versions) is NOT a conflict. */
export function historicalIdentityConflict<R extends VersionRow>(rows: R[], historical: Set<string>, keyOf: (r: R) => string | number | null): boolean {
  const hist = rows.filter((r) => r.supersededAt == null && historical.has(r.canonicalStatus));
  const seen = new Set<string>();
  for (const r of hist) {
    const k = keyOf(r);
    if (k == null) continue;               // unkeyed history cannot be proven a duplicate
    const s = String(k);
    if (seen.has(s)) return true;
    seen.add(s);
  }
  return false;
}

/** Integrity for a case's claim rows: conflict if the active slot has >1 OR historical
 *  identity collides; else resolved. */
export function claimCaseIntegrity<R extends VersionRow>(rows: R[]): "resolved" | "conflicting" {
  if (selectActive(rows, CLAIM_ACTIVE_STATUSES).kind === "conflict") return "conflicting";
  if (historicalIdentityConflict(rows, CLAIM_HISTORICAL_STATUSES, (r) => r.attemptNumber ?? null)) return "conflicting";
  return "resolved";
}
export function invoiceClaimIntegrity<R extends VersionRow>(rows: R[]): "resolved" | "conflicting" {
  if (selectActive(rows, INVOICE_ACTIVE_STATUSES).kind === "conflict") return "conflicting";
  if (historicalIdentityConflict(rows, INVOICE_HISTORICAL_STATUSES, (r) => r.invoiceNumber ?? null)) return "conflicting";
  return "resolved";
}

/** Select the ONE representative version for a stage: the active working row when
 *  present; otherwise the exact documented historical version. Submitted/issued
 *  history + a correction draft is fine (the draft wins as active). >1 active →
 *  conflict; a missing/duplicate historical version identity → conflict/missing —
 *  never silently accepted as unkeyed history. */
export function selectStageClaim<R extends VersionRow>(rows: R[]): ActivePick<R> {
  const active = selectActive(rows, CLAIM_ACTIVE_STATUSES);
  if (active.kind !== "missing") return active;                     // active draft (or >1 → conflict)
  const hist = rows.filter((r) => r.supersededAt == null && CLAIM_HISTORICAL_STATUSES.has(r.canonicalStatus));
  if (hist.length === 0) return { kind: "missing" };
  if (hist.some((r) => r.attemptNumber == null)) return { kind: "conflict" }; // unkeyed history → fail closed
  if (historicalIdentityConflict(hist, CLAIM_HISTORICAL_STATUSES, (r) => r.attemptNumber ?? null)) return { kind: "conflict" };
  // Explicit rule: the highest attemptNumber is the current historical version.
  const row = hist.reduce((a, b) => ((b.attemptNumber ?? 0) > (a.attemptNumber ?? 0) ? b : a));
  return { kind: "one", row };
}
export function selectStageInvoice<R extends VersionRow>(rows: R[]): ActivePick<R> {
  const active = selectActive(rows, INVOICE_ACTIVE_STATUSES);
  if (active.kind !== "missing") return active;
  const hist = rows.filter((r) => r.supersededAt == null && INVOICE_HISTORICAL_STATUSES.has(r.canonicalStatus));
  if (hist.length === 0) return { kind: "missing" };
  if (hist.length > 1) return { kind: "conflict" };                // >1 non-superseded issued version → conflict
  if (hist[0].invoiceNumber == null) return { kind: "conflict" };  // missing required version identity → fail closed
  return { kind: "one", row: hist[0] };
}
