// Pure authorization decision — no DB, no Express, no side effects.
//
// This is the single source of truth for an allow/deny given an ALREADY
// resolved access context plus resolved scope ids. Kept dependency-free so it
// can be unit-tested directly and reused by the Express middleware.
//
// Capability first, then scope. Deny-wins is already baked into
// ctx.permissions by AccessContextService. Platform scope means "not limited
// to one org/clinic for the capabilities this user has" — it never grants a
// capability the user lacks.

import type { AccessContext } from "../services/access/accessContextService";

export type PermissionMode = "any" | "all";

export interface AccessDecisionInput {
  /** Required permission keys. */
  permissions: string[];
  /** "all" = must hold every key; "any" = at least one. */
  mode: PermissionMode;
  /** Require platform scope. */
  platform?: boolean;
  /** Resolved target clinic id (undefined = route is not clinic-scoped). */
  clinicId?: number | null;
  /** Resolved target organization id (undefined = route is not org-scoped). */
  organizationId?: number | null;
}

export type AccessDecision = { ok: true } | { ok: false; status: 401 | 403; reason: string };

/** Pure clinic-scope check. Platform scope passes any clinic. */
export function clinicInScope(ctx: AccessContext, clinicId: number | null): boolean {
  if (ctx.scope.platform) return true;
  if (clinicId == null) return false;
  return ctx.scope.clinicIds.includes(clinicId);
}

/** Pure organization-scope check. Platform scope passes any organization. */
export function organizationInScope(ctx: AccessContext, organizationId: number | null): boolean {
  if (ctx.scope.platform) return true;
  if (organizationId == null) return false;
  return ctx.scope.organizationIds.includes(organizationId);
}

export function decideAccess(ctx: AccessContext | null, input: AccessDecisionInput): AccessDecision {
  if (!ctx) return { ok: false, status: 401, reason: "unauthenticated" };
  if (!ctx.isActive) return { ok: false, status: 401, reason: "inactive" };

  const hasCapability =
    input.mode === "all"
      ? input.permissions.every((k) => ctx.permissions.includes(k))
      : input.permissions.some((k) => ctx.permissions.includes(k));
  if (!hasCapability) return { ok: false, status: 403, reason: "missing_permission" };

  if (input.platform && !ctx.scope.platform) {
    return { ok: false, status: 403, reason: "requires_platform_scope" };
  }
  if (input.clinicId !== undefined && !clinicInScope(ctx, input.clinicId ?? null)) {
    return { ok: false, status: 403, reason: "clinic_out_of_scope" };
  }
  if (input.organizationId !== undefined && !organizationInScope(ctx, input.organizationId ?? null)) {
    return { ok: false, status: 403, reason: "organization_out_of_scope" };
  }
  return { ok: true };
}
