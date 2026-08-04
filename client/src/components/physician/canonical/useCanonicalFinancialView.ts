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

export const CANONICAL_FINANCIAL_VIEW_QUERY_KEY = ["/api/canonical-financial-view"] as const;
const MIGRATION_MISSING_CODE = "ANCILLARY_DOCUMENT_MIGRATION_MISSING";

export function isFinancialMigrationMissing(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return msg.includes(MIGRATION_MISSING_CODE) || /^503:/.test(msg);
}

export function useCanonicalFinancialView(enabledOverride?: boolean) {
  const enabled = enabledOverride ?? isAnyCanonicalFinancialEnabled();
  const query = useQuery<CanonicalFinancialView>({
    queryKey: CANONICAL_FINANCIAL_VIEW_QUERY_KEY,
    enabled, // OFF ⇒ the query never runs (no network request)
  });
  return { enabled, ...query, isMigrationMissing: query.isError && isFinancialMigrationMissing(query.error) };
}
