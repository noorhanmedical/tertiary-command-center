// Canonical facility resolver for Plexus IQ batch/import flows.
//
// Admin Settings facilities (the `clinics` table) are the canonical usable
// facility source. This resolver normalizes a raw facility string (from an
// import row, a dropdown, or a legacy caller) to a canonical display name.
//
// Resolution order:
//   1. Exact / case-insensitive match against an ACTIVE clinics row name.
//   2. Case-insensitive substring match against an active clinics row name.
//   3. Fallback to the legacy hardcoded VALID_FACILITIES allowlist so
//      existing facilities/batches keep working even if they were never
//      migrated into the clinics table.
//
// The canonical name returned is the exact `clinics.name` (or the legacy
// VALID_FACILITIES entry) so batches store a stable, display-ready value.

import { facilityRepository } from "../repositories/clinicians.repo";
import { VALID_FACILITIES } from "@shared/plexus";

export type CanonicalFacility = {
  /** Canonical display name to store on the batch. */
  name: string;
  /** Owning clinics row id when the facility exists in Admin Settings. */
  clinicId: number | null;
  /** Where the canonical name came from. */
  source: "clinics" | "legacy";
};

/**
 * Build the set of resolvable facilities: active clinics rows unioned with
 * the legacy VALID_FACILITIES allowlist. Clinics rows win on name collisions
 * (they carry the clinicId). One DB read per call — callers that resolve many
 * rows should use `createFacilityResolver` to read once and resolve in-memory.
 */
export async function loadCanonicalFacilities(): Promise<CanonicalFacility[]> {
  const clinics = await facilityRepository.list(false); // active only
  const out: CanonicalFacility[] = clinics.map((c) => ({
    name: c.name,
    clinicId: c.id,
    source: "clinics" as const,
  }));
  const seen = new Set(out.map((f) => f.name.toLowerCase()));
  for (const legacy of VALID_FACILITIES) {
    if (!seen.has(legacy.toLowerCase())) {
      out.push({ name: legacy, clinicId: null, source: "legacy" });
      seen.add(legacy.toLowerCase());
    }
  }
  return out;
}

// Exported for unit testing (pure — no DB). Given a candidate facility set,
// resolve `raw` to a single canonical facility or null. See resolution rules
// in `createFacilityResolver`.
export function matchFacility(
  raw: string | null | undefined,
  facilities: CanonicalFacility[],
): CanonicalFacility | null {
  if (!raw) return null;
  const k = raw.trim().toLowerCase();
  if (!k) return null;
  // 1. Exact (case-insensitive) — always wins, never ambiguous.
  const exact = facilities.find((f) => f.name.toLowerCase() === k);
  if (exact) return exact;
  // 2. Substring (either direction). Ambiguity safeguard: resolve ONLY when
  //    exactly one canonical facility matches. If two or more match the same
  //    substring, treat it as ambiguous and return null rather than silently
  //    picking one — the caller then surfaces an "unknown facility" error and
  //    the operator must disambiguate (e.g. via the exact Admin Settings name).
  const partialMatches = facilities.filter(
    (f) => f.name.toLowerCase().includes(k) || k.includes(f.name.toLowerCase()),
  );
  return partialMatches.length === 1 ? partialMatches[0] : null;
}

/**
 * Read the canonical facility set once and return an in-memory resolver.
 * Use this when resolving many rows (e.g. a bulk import) to avoid a DB read
 * per row.
 */
export async function createFacilityResolver(): Promise<{
  resolve: (raw: string | null | undefined) => CanonicalFacility | null;
  facilities: CanonicalFacility[];
}> {
  const facilities = await loadCanonicalFacilities();
  return {
    facilities,
    resolve: (raw) => matchFacility(raw, facilities),
  };
}

/** Convenience single-shot resolve (one DB read). Returns the canonical name. */
export async function resolveCanonicalFacilityName(
  raw: string | null | undefined,
): Promise<string | null> {
  const { resolve } = await createFacilityResolver();
  return resolve(raw)?.name ?? null;
}
