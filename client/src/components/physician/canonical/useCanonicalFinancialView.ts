// Phase 2J — canonical financial ledger query hook.
//
// Fetches ONE clinic-scoped read model (`GET /api/canonical-financial-view`) ONLY
// when a 2J flag is ON — zero requests when all are OFF. The server DTO is rendered
// as-is: the client NEVER recomputes claim/invoice status or derives balances, and
// NEVER shows a failed/unavailable section as a zero. A 503 migration failure is
// detected so the panel can show the dedicated migration state.

import { useQuery } from "@tanstack/react-query";
import { isAnyCanonicalFinancialEnabled } from "@/lib/canonicalFinancialEnabled";
import type { CanonicalFinancialView } from "@shared/canonicalFinancialView";

const BASE = "/api/canonical-financial-view";
export const CANONICAL_FINANCIAL_VIEW_QUERY_KEY = [BASE] as const;
const MIGRATION_MISSING_CODE = "ANCILLARY_DOCUMENT_MIGRATION_MISSING";

export function isFinancialMigrationMissing(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return msg.includes(MIGRATION_MISSING_CODE) || /^503:/.test(msg);
}

// Independent per-section cursors — claims/invoices/payments paginate separately so
// advancing one section NEVER skips records in the others. The query key includes
// all three so React Query refetches exactly once per cursor change.
export type FinancialCursors = { claims?: string | null; invoices?: string | null; payments?: string | null };

export function useCanonicalFinancialView(cursors?: FinancialCursors, enabledOverride?: boolean) {
  const enabled = enabledOverride ?? isAnyCanonicalFinancialEnabled();
  const c = cursors ?? {};
  const anyCursor = !!(c.claims || c.invoices || c.payments);
  const queryKey = anyCursor ? [BASE, c.claims ?? null, c.invoices ?? null, c.payments ?? null] : CANONICAL_FINANCIAL_VIEW_QUERY_KEY;
  const query = useQuery<CanonicalFinancialView>({
    queryKey,
    enabled, // OFF ⇒ the query never runs (no network request)
    queryFn: async () => {
      const p = new URLSearchParams();
      if (c.claims) p.set("claimsCursor", c.claims);
      if (c.invoices) p.set("invoicesCursor", c.invoices);
      if (c.payments) p.set("paymentsCursor", c.payments);
      const qs = p.toString();
      const res = await fetch(`${BASE}${qs ? `?${qs}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json() as Promise<CanonicalFinancialView>;
    },
  });
  return { enabled, ...query, isMigrationMissing: query.isError && isFinancialMigrationMissing(query.error) };
}
