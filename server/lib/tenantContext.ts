// ADR-002 — fail-closed tenant scope (Stage A: foundation).
//
// Replaces the ambiguous `req.clinicId: number | null` model (where `null` meant
// BOTH "admin, see everything" AND "non-admin with no clinic" — a fail-OPEN
// overloading) with an explicit discriminated union so the "no valid scope"
// case is DENIED rather than silently widened.
//
//   { kind: "clinic",   clinicId }   → scope every query to this clinic
//   { kind: "platform" }             → explicit all-clinic admin scope
//   { kind: "denied",   reason }     → no valid scope; access MUST be refused
//
// HARD RULES:
//   - Tenant scope is resolved ONLY from the authenticated server-side session.
//     A clinic_id supplied by the client (body/query/param/header) is NEVER
//     trusted for scope resolution.
//   - `null`/`undefined` clinic for a non-platform user resolves to `denied`,
//     NEVER to "all clinics".
//   - Only an authenticated platform/admin identity may resolve to `platform`
//     (the only scope permitted to omit a clinic predicate).
//
// Stage A introduces the type, resolver, request wiring, and tests. Repositories
// migrate onto req.tenant incrementally in Stage B (patients, documents, orders,
// procedures, billing first) — the legacy req.clinicId remains populated until
// each path is migrated, so nothing breaks in this stage.

import type { Request, Response, NextFunction } from "express";

export type TenantDenyReason =
  | "unauthenticated" // no session user
  | "no_clinic_assigned"; // authenticated non-platform user without a clinic

export type TenantContext =
  | { kind: "clinic"; clinicId: number }
  | { kind: "platform" }
  | { kind: "denied"; reason: TenantDenyReason };

/** Minimal server-side identity shape the resolver trusts. Sourced from the
 *  authenticated session ONLY — never from client-supplied fields. */
export interface SessionIdentity {
  userId?: string | null;
  role?: string | null;
  clinicId?: number | null;
}

/** Roles that are permitted the explicit all-clinic `platform` scope. */
const PLATFORM_ROLES = new Set(["admin", "platform_admin", "technical_admin"]);

/**
 * Resolve tenant scope from the authenticated session identity. Pure + testable.
 * Fail-closed: anything without a concrete, legitimate scope → denied.
 */
export function resolveTenantContext(
  identity: SessionIdentity | null | undefined,
): TenantContext {
  if (!identity || !identity.userId) {
    return { kind: "denied", reason: "unauthenticated" };
  }
  if (identity.role && PLATFORM_ROLES.has(identity.role)) {
    return { kind: "platform" };
  }
  // Non-platform user: a concrete clinic is REQUIRED. null/undefined => denied.
  if (typeof identity.clinicId === "number" && Number.isInteger(identity.clinicId)) {
    return { kind: "clinic", clinicId: identity.clinicId };
  }
  return { kind: "denied", reason: "no_clinic_assigned" };
}

/** True when the context permits reading data for `targetClinicId`.
 *  platform → any; clinic → only its own; denied → never. */
export function tenantAllowsClinic(
  ctx: TenantContext,
  targetClinicId: number | null | undefined,
): boolean {
  if (ctx.kind === "platform") return true;
  if (ctx.kind === "denied") return false;
  return typeof targetClinicId === "number" && targetClinicId === ctx.clinicId;
}

declare global {
  namespace Express {
    interface Request {
      /** ADR-002 authoritative tenant scope (resolved from session only). */
      tenant: TenantContext;
    }
  }
}

/**
 * Populate req.tenant from the session. Register AFTER session middleware and
 * (for now) alongside the legacy clinicContext. This does NOT itself refuse
 * requests — enforcement happens at the migrated read paths (Stage B) and via
 * requireTenantScope() for routes that opt in now.
 */
export function tenantContext(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const session = (req as unknown as { session?: SessionIdentity }).session;
  req.tenant = resolveTenantContext(
    session
      ? { userId: session.userId, role: session.role, clinicId: session.clinicId }
      : null,
  );
  next();
}

/**
 * Opt-in guard for routes ready to enforce fail-closed scope now: refuses the
 * request when the resolved scope is `denied`. Generic 403 — no scope internals
 * leaked to the client.
 */
export function requireTenantScope(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.tenant?.kind === "denied") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

/** Result of a per-resource tenant access check (ADR-002 Stage B). */
export type TenantAccessResult =
  | { ok: true }
  | { ok: false; httpStatus: 403 | 404; error: string };

/**
 * Per-resource ownership check (Stage B). Call AFTER loading a resource to
 * confirm the caller's tenant scope permits it. This must be part of the
 * authorization path — never "load PHI, return, then check".
 *
 * Policy:
 *   - denied scope        → 403 (never reached if requireTenantScope ran first)
 *   - platform scope      → allowed
 *   - clinic scope + same → allowed
 *   - clinic scope + other/none → 404 (do NOT reveal that a resource exists in
 *     another clinic — return the same "not found" a non-existent id would).
 *
 * Returning 404 (not 403) for cross-clinic avoids leaking resource existence.
 * The caller must NOT have sent PHI before invoking this.
 */
export function checkTenantResourceAccess(
  ctx: TenantContext,
  resourceClinicId: number | null | undefined,
): TenantAccessResult {
  if (ctx.kind === "denied") {
    return { ok: false, httpStatus: 403, error: "Forbidden" };
  }
  if (ctx.kind === "platform") return { ok: true };
  if (typeof resourceClinicId === "number" && resourceClinicId === ctx.clinicId) {
    return { ok: true };
  }
  // clinic scope but resource belongs to another clinic (or has none):
  // respond as "not found" so existence is not disclosed cross-tenant.
  return { ok: false, httpStatus: 404, error: "Not found" };
}

/**
 * Express helper: enforce per-resource tenant access on `req`, writing the
 * appropriate PHI-free response and returning false when denied. Usage:
 *   const patient = await load(id);
 *   if (!patient) return res.status(404)...;
 *   if (!enforceTenantResource(req, res, patient.clinicId)) return; // stops here
 *   res.json(patient);
 */
export function enforceTenantResource(
  req: Request,
  res: Response,
  resourceClinicId: number | null | undefined,
): boolean {
  const result = checkTenantResourceAccess(req.tenant, resourceClinicId);
  if (result.ok) return true;
  res.status(result.httpStatus).json({ error: result.error });
  return false;
}
