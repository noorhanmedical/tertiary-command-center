// resolveAuthorizedClinicScope — the ONE authoritative server-side helper that
// answers "which clinics may this request read/write?" for tenant isolation.
//
// It is derived from the canonical AccessContextService scope (multi-clinic,
// DB-fresh, folds the legacy users.clinicId), never from a single nullable
// session value alone. The result FAILS CLOSED: a non-admin with no resolvable
// clinic scope gets an EMPTY clinicIds array, and callers must return nothing
// for an empty scope (never fall back to unscoped reads).
//
// Shape:
//   { admin: true,  clinicIds: null }      → global / cross-clinic (no filter)
//   { admin: false, clinicIds: number[] }  → scoped (possibly [] → fail closed)
//
// Admin/global is granted when EITHER the legacy session role is "admin"
// (preserves existing intended admin behavior) OR the canonical access context
// is platform-scoped (e.g. Platform Admin). Everyone else is clinic-scoped.

import type { Request } from "express";
import { resolveAccessContext } from "./accessContextService";

export type AuthorizedClinicScope =
  | { admin: true; clinicIds: null }
  | { admin: false; clinicIds: number[] };

export async function resolveAuthorizedClinicScope(req: Request): Promise<AuthorizedClinicScope> {
  const userId = (req.session as { userId?: string } | undefined)?.userId;
  if (!userId) return { admin: false, clinicIds: [] };

  const legacyRole = (req.session as { role?: string } | undefined)?.role ?? "";
  // Legacy admin short-circuit — preserves the existing cross-clinic admin
  // behavior even before the access context is consulted.
  if (legacyRole === "admin") return { admin: true, clinicIds: null };

  const ctx = await resolveAccessContext(userId);
  if (!ctx || !ctx.isActive) return { admin: false, clinicIds: [] };
  if (ctx.scope.platform) return { admin: true, clinicIds: null };

  const set = new Set<number>(ctx.scope.clinicIds);
  // Fold in the legacy session clinic (defense in depth; usually already in
  // ctx.scope.clinicIds via the AccessContextService legacy-clinic union).
  const legacyClinic = (req as { clinicId?: number | null }).clinicId ?? ctx.legacyClinicId ?? null;
  if (legacyClinic != null) set.add(legacyClinic);

  return { admin: false, clinicIds: [...set].sort((a, b) => a - b) };
}

/**
 * Convenience: does this scope permit the given clinic id? Admin permits any;
 * a scoped caller permits only clinics in its authorized set. A null target
 * clinic (unresolvable ownership) is NEVER permitted for a scoped caller
 * (fail closed) but IS permitted for admin.
 */
export function scopePermitsClinic(scope: AuthorizedClinicScope, clinicId: number | null | undefined): boolean {
  if (scope.admin) return true;
  if (clinicId == null) return false;
  return scope.clinicIds.includes(clinicId);
}
