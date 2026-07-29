// Phase 2H — canonical Clinician Portal overview query hook.
//
// Fetches ONE batched read model (`GET /api/clinician-portal/canonical-overview`)
// ONLY when the client flag is ON — zero requests when OFF. The server DTO is
// rendered as-is; the client never recomputes canonical status from raw rows.

import { useQuery } from "@tanstack/react-query";
import { isClinicianPortalCanonicalDataEnabled } from "@/lib/clinicianPortalCanonicalFlag";
import type { ClinicianPortalCanonicalOverview } from "@shared/clinicianPortalOverview";

export const CANONICAL_OVERVIEW_QUERY_KEY = ["/api/clinician-portal/canonical-overview"] as const;

export function useCanonicalOverview() {
  const enabled = isClinicianPortalCanonicalDataEnabled();
  const query = useQuery<ClinicianPortalCanonicalOverview>({
    queryKey: CANONICAL_OVERVIEW_QUERY_KEY,
    enabled, // OFF ⇒ the query never runs (no network request)
  });
  return { enabled, ...query };
}
