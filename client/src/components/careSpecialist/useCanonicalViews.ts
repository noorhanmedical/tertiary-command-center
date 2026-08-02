// Phase 2I — PCS/ACS canonical view query hooks.
//
// Each fetches ONE bounded page from its canonical endpoint ONLY when its client
// flag is ON (zero requests when OFF). The server DTO is rendered as-is; the
// client never recomputes canonical stage truth. A 503 migration-missing failure
// is surfaced as a dedicated state (never canonical zero counts under an error).

import { useQuery } from "@tanstack/react-query";
import { isPcsCanonicalViewEnabled } from "@/lib/pcsCanonicalViewFlag";
import { isAcsCanonicalViewEnabled } from "@/lib/acsCanonicalViewFlag";
import type { PcsCanonicalView } from "@shared/pcsCanonicalView";
import type { AcsCanonicalView } from "@shared/acsCanonicalView";

const MIGRATION_MISSING_CODE = "ANCILLARY_DOCUMENT_MIGRATION_MISSING";

export function isMigrationMissingError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return msg.includes(MIGRATION_MISSING_CODE) || /^503:/.test(msg);
}

/** Fetch one bounded page. Non-2xx throws `"<status>: <body>"` so the migration
 *  banner can be distinguished from a generic error (both are non-zero states). */
async function fetchPage<T>(base: string, cursor?: string | null): Promise<T> {
  const url = cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()) || res.statusText}`);
  return (await res.json()) as T;
}

export function usePcsCanonicalView(cursor?: string | null) {
  const enabled = isPcsCanonicalViewEnabled();
  const query = useQuery<PcsCanonicalView>({
    queryKey: ["/api/pcs/canonical-view", cursor ?? ""] as const,
    queryFn: () => fetchPage<PcsCanonicalView>("/api/pcs/canonical-view", cursor),
    enabled,
  });
  return { enabled, ...query, isMigrationMissing: query.isError && isMigrationMissingError(query.error) };
}

export function useAcsCanonicalView(cursor?: string | null) {
  const enabled = isAcsCanonicalViewEnabled();
  const query = useQuery<AcsCanonicalView>({
    queryKey: ["/api/acs/canonical-view", cursor ?? ""] as const,
    queryFn: () => fetchPage<AcsCanonicalView>("/api/acs/canonical-view", cursor),
    enabled,
  });
  return { enabled, ...query, isMigrationMissing: query.isError && isMigrationMissingError(query.error) };
}
