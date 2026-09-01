/**
 * tenantContext — explicit, fail-closed tenant scope.
 *
 * Background (ADR-002, GAP-001): the platform historically expressed tenant
 * scope as `req.clinicId: number | null`, where `null` meant BOTH "admin, see
 * everything" AND "non-admin with no clinic assigned". That overloading is
 * fail-OPEN: a mis-scoped non-admin could fall into the see-everything path, and
 * repositories dropped their filter whenever the value was null.
 *
 * This module replaces that ambiguity with a discriminated union so the three
 * cases are distinct and the "no valid scope" case can be denied rather than
 * silently widened:
 *
 *   - { kind: "clinic", clinicId }   → scope every query to this clinic
 *   - { kind: "platform" }           → explicit all-clinic admin scope
 *   - { kind: "denied", reason }     → no valid scope; access must be refused
 *
 * This file is intentionally additive: it introduces the type and the resolver
 * and populates `req.tenant`. The legacy `req.clinicId` remains populated by
 * clinicContext for now; repositories migrate onto `req.tenant` in a later step
 * (ADR-002 C.2), after which the legacy field is removed.
 *
 * IMPORTANT: The `platform` scope is the ONLY place a tenant predicate may be
 * intentionally omitted, and it is reached only for an authenticated `admin`.
 * Everything else that lacks a concrete clinic resolves to `denied`.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction } from "express";

/** Reasons a request has no usable tenant scope. Kept coarse on purpose — do not
 *  leak session internals to callers; these are for server-side decisions/logs. */
export type TenantDenyReason =
  | "unauthenticated" // no session user
  | "no_clinic_assigned"; // authenticated non-admin without a clinic

export type TenantContext =
  | { kind: "clinic"; clinicId: number }
  | { kind: "platform" }
  | { kind: "denied"; reason: TenantDenyReason };

declare global {
  namespace Express {
    interface Request {
      /**
       * Explicit tenant scope for this request. Prefer this over `clinicId`.
       * `clinicId` is retained during migration (ADR-002) and will be removed.
       */
      tenant: TenantContext;
    }
  }
}

/**
 * Resolve the tenant context from the session. Pure function so it is unit- and
 * regression-testable without an Express request (see C.6 negative tests).
 *
 * Rules:
 *   - admin role                    → platform scope (all clinics)
 *   - authenticated + clinicId set  → clinic scope
 *   - authenticated, no clinicId    → denied (no_clinic_assigned)  [fail-closed]
 *   - unauthenticated               → denied (unauthenticated)
 */
export function resolveTenantContext(session: {
  userId?: unknown;
  role?: unknown;
  clinicId?: unknown;
}): TenantContext {
  const isAuthenticated = session?.userId != null;
  if (!isAuthenticated) {
    return { kind: "denied", reason: "unauthenticated" };
  }

  if (session.role === "admin") {
    // Explicit, intentional all-clinic scope. This is the ONLY unscoped path.
    return { kind: "platform" };
  }

  const clinicId = session.clinicId;
  if (typeof clinicId === "number" && Number.isInteger(clinicId) && clinicId > 0) {
    return { kind: "clinic", clinicId };
  }

  // Authenticated non-admin without a valid clinic assignment. Fail closed:
  // this user sees NO tenant-scoped data until a clinic is assigned.
  return { kind: "denied", reason: "no_clinic_assigned" };
}

/**
 * Request-scoped tenant store (ADR-006). Mirrors the pattern already used for
 * request-id in requestObservability. Storing the scope here lets the repository
 * layer enforce tenant predicates WITHOUT threading a clinicId argument through
 * every method signature (which would risk a caller passing null and re-opening
 * the fail-open hole).
 */
const tenantStore = new AsyncLocalStorage<TenantContext>();

/**
 * Read the effective tenant scope for the current async context. Returns
 * undefined when there is no active store (e.g., a background job that did not
 * enter a scope). The repository guard treats `undefined` as fail-closed for
 * request-expecting paths.
 */
export function getTenantScope(): TenantContext | undefined {
  return tenantStore.getStore();
}

/**
 * Run `fn` under an explicit **system** (unscoped) tenant scope. This is the ONLY
 * sanctioned way for background jobs / seeds / migrations to run unscoped, and it
 * is deliberately greppable for review. Do not use it inside request handling.
 */
export function withSystemScope<T>(fn: () => T): T {
  return tenantStore.run({ kind: "platform" }, fn);
}

/**
 * Re-establish a previously-captured tenant scope for detached work (ADR-006).
 *
 * Detached background jobs (e.g., a `void`-ed analysis loop that outlives the
 * request) must not rely on implicit AsyncLocalStorage propagation surviving the
 * request. The pattern is: capture `getTenantScope()` at kickoff **inside** the
 * request, then run the detached work under `runWithScope(capturedScope, fn)`.
 *
 * If `scope` is undefined (kickoff had no scope), `fn` runs with NO store so any
 * scoped repository access fails closed — the correct, safe default. A caller
 * that legitimately needs unscoped background access must use `withSystemScope`.
 */
export function runWithScope<T>(scope: TenantContext | undefined, fn: () => T): T {
  if (!scope) return fn();
  return tenantStore.run(scope, fn);
}

/**
 * Express middleware. Must run AFTER session middleware. Populates `req.tenant`
 * AND establishes the async tenant store for the remainder of the request so the
 * repository layer can enforce scope centrally. Enforcement (deny) happens in the
 * repository guard / route guards (ADR-002 C.2/C.3), not here — this middleware
 * only makes the scope explicit and available.
 */
export function tenantContext(req: Request, _res: Response, next: NextFunction): void {
  const ctx = resolveTenantContext({
    userId: req.session?.userId,
    role: req.session?.role,
    clinicId: req.session?.clinicId,
  });
  req.tenant = ctx;
  tenantStore.run(ctx, next);
}

/**
 * Repository-layer guard (ADR-006). Resolves the effective clinic predicate from
 * the async tenant scope:
 *   - clinic   → returns the clinicId (caller MUST apply the predicate)
 *   - platform → returns null (unscoped; admin/system only)
 *   - denied / no store → THROWS TENANT_SCOPE_DENIED (query must not run)
 *
 * Repositories use the returned value to add `AND clinic_id = ?` to reads and
 * writes. Because there is no clinicId parameter for callers to pass, a caller
 * cannot accidentally opt out of scoping.
 */
export function resolveScopedClinicId(): number | null {
  const ctx = getTenantScope();
  if (!ctx) {
    // No active scope on a path that reached a scoped repository. Fail closed.
    throwScopeDenied();
  }
  if (ctx.kind === "clinic") return ctx.clinicId;
  if (ctx.kind === "platform") return null;
  return throwScopeDenied();
}

function throwScopeDenied(): never {
  const err = new Error("TENANT_SCOPE_DENIED");
  (err as { code?: string }).code = "TENANT_SCOPE_DENIED";
  throw err;
}

/**
 * Narrowing helpers for the repository layer (used in C.2). A repository that
 * receives `platform` scope may run unscoped; a repository that receives
 * `clinic` scope MUST apply the clinic predicate; a `denied` scope MUST NOT
 * return tenant data.
 */
export function isPlatformScope(t: TenantContext): t is { kind: "platform" } {
  return t.kind === "platform";
}

export function requireClinicId(t: TenantContext): number | null {
  // Returns the clinic id for clinic scope, null for platform (unscoped),
  // and throws for denied — callers convert the throw into a 401/403.
  if (t.kind === "clinic") return t.clinicId;
  if (t.kind === "platform") return null;
  const err = new Error("TENANT_SCOPE_DENIED");
  (err as { code?: string }).code = "TENANT_SCOPE_DENIED";
  throw err;
}
