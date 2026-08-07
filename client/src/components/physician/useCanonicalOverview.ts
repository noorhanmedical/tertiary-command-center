// Phase 2H — canonical Clinician Portal overview query hook.
//
// Fetches ONE batched read model (`GET /api/clinician-portal/canonical-overview`)
// ONLY when the client flag is ON — zero requests when OFF. The server DTO is
// rendered as-is; the client never recomputes canonical status from raw rows.

import { useQuery } from "@tanstack/react-query";
import { isClinicianPortalCanonicalDataEnabled } from "@/lib/clinicianPortalCanonicalFlag";
import { ApiError } from "@/lib/queryClient";
import type { ClinicianPortalCanonicalOverview } from "@shared/clinicianPortalOverview";

export const CANONICAL_OVERVIEW_QUERY_KEY = ["/api/clinician-portal/canonical-overview"] as const;

const MIGRATION_MISSING_CODE = "ANCILLARY_DOCUMENT_MIGRATION_MISSING";

/** K16: a 503 migration-missing failure is detected from the STRUCTURED `ApiError`
 *  (HTTP status + stable server `code`) rather than by parsing the error message; the
 *  message fallback is retained only for non-ApiError inputs. The tiles render the
 *  dedicated migration state (never canonical zero counts under an error). */
export function isMigrationMissingError(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 503 || error.code === MIGRATION_MISSING_CODE;
  const msg = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return msg.includes(MIGRATION_MISSING_CODE) || /^503:/.test(msg);
}

export function useCanonicalOverview() {
  const enabled = isClinicianPortalCanonicalDataEnabled();
  const query = useQuery<ClinicianPortalCanonicalOverview>({
    queryKey: CANONICAL_OVERVIEW_QUERY_KEY,
    enabled, // OFF ⇒ the query never runs (no network request)
  });
  return {
    enabled,
    ...query,
    isMigrationMissing: query.isError && isMigrationMissingError(query.error),
  };
}
