// ═══════════════════════════════════════════════════════════════════════════
// Central permission-enforcement middleware (Phase 3).
//
// ONE canonical authorization layer built on AccessContextService. Replaces
// the scattered session.role string checks for MIGRATED high-risk routes.
//
// Enforcement is gated by featureFlags.permissionEnforcement:
//   • OFF (default) → the route's supplied `legacy` guard runs (behavior is
//     preserved on a DB where the access tables are not yet seeded/backfilled).
//     If no legacy guard is supplied, the request passes through unchanged.
//     In the OFF path NO access-context DB query is issued.
//   • ON  → authorization is resolved from the DB access context: capability
//     (permission keys, deny-wins already applied) ∩ scope (platform /
//     organization / clinic / — service). session.role is NOT consulted.
//
// Capability and scope are INDEPENDENT. Platform scope means "not limited to a
// single org/clinic for the capabilities the user has" — it does NOT grant
// capabilities the user lacks.
// ═══════════════════════════════════════════════════════════════════════════

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { featureFlags } from "../lib/featureFlags";
import {
  resolveAccessContext,
  type AccessContext,
} from "../services/access/accessContextService";
import { decideAccess, type PermissionMode } from "./accessDecision";

export { decideAccess } from "./accessDecision";
export type { AccessDecision, AccessDecisionInput } from "./accessDecision";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Request-scoped access context (undefined = not yet loaded). */
      accessContext?: AccessContext | null;
    }
  }
}

/** True when the new permission system is authoritative for migrated routes. */
export function permissionEnforcementEnabled(): boolean {
  return featureFlags.permissionEnforcement;
}

/**
 * Resolve (once) and cache the authoritative access context on the request.
 * Returns null when unauthenticated. Never re-queries within a single request.
 */
export async function ensureAccessContext(req: Request): Promise<AccessContext | null> {
  if (req.accessContext !== undefined) return req.accessContext;
  const userId = req.session?.userId;
  if (!userId) {
    req.accessContext = null;
    return null;
  }
  const ctx = await resolveAccessContext(userId);
  req.accessContext = ctx;
  return ctx;
}

/**
 * Standalone middleware: require an authenticated, ACTIVE user and attach the
 * fresh access context to the request. Rejects/destroys stale disabled
 * sessions immediately. Use where a router wants the context available to all
 * handlers; requirePermission also loads it lazily.
 */
export const loadAccessContext: RequestHandler = async (req, res, next) => {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  const ctx = await ensureAccessContext(req);
  if (!ctx || !ctx.isActive) {
    req.session?.destroy?.(() => {});
    return res.status(401).json({ error: "Not authenticated" });
  }
  return next();
};

// ─── Legacy fallbacks (used only while enforcement is OFF) ───────────────────

/** Legacy admin gate (session.role === "admin"). */
export const legacyRequireAdmin: RequestHandler = (req, res, next) => {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  if (req.session.role !== "admin") return res.status(403).json({ error: "Forbidden — admin access required" });
  return next();
};

/** Legacy any-of-roles gate (session.role ∈ roles). */
export function legacyRequireAnyRole(...roles: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
    const role = req.session.role ?? "";
    if (!roles.includes(role)) return res.status(403).json({ error: `Forbidden — requires one of: ${roles.join(", ")}` });
    return next();
  };
}

// ─── Scope resolvers ─────────────────────────────────────────────────────────
// A resolver returns the PERSISTED clinic/organization id a request acts on.
// Prefer loading the resource and reading its stored ownership over trusting
// a client-supplied id.
type ScopeResolver = (req: Request) => number | null | undefined | Promise<number | null | undefined>;

export interface PermissionOptions {
  /** Require platform scope in addition to the capability. */
  platform?: boolean;
  /** Resolve the target clinic id; enforced via isClinicInScope. */
  clinic?: ScopeResolver;
  /** Resolve the target organization id; enforced via isOrganizationInScope. */
  organization?: ScopeResolver;
  /** Guard used when enforcement is OFF (transition-era behavior preservation). */
  legacy?: RequestHandler;
}

function build(perms: string[], mode: PermissionMode, opts?: PermissionOptions): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Transition path: enforcement OFF → legacy guard (or pass-through). No
    // access-context DB query is issued here, so an un-provisioned DB is safe.
    if (!permissionEnforcementEnabled()) {
      if (opts?.legacy) return opts.legacy(req, res, next);
      return next();
    }
    try {
      const ctx = await ensureAccessContext(req);
      let clinicId: number | null | undefined;
      let organizationId: number | null | undefined;
      if (opts?.clinic) clinicId = (await opts.clinic(req)) ?? null;
      if (opts?.organization) organizationId = (await opts.organization(req)) ?? null;

      const decision = decideAccess(ctx, {
        permissions: perms,
        mode,
        platform: opts?.platform,
        clinicId,
        organizationId,
      });
      if (decision.ok) return next();
      if (decision.status === 401) {
        req.session?.destroy?.(() => {});
        return res.status(401).json({ error: "Not authenticated" });
      }
      // Generic 403 — never disclose which permission/scope was missing.
      return res.status(403).json({ error: "Forbidden" });
    } catch (err) {
      console.error("[accessControl] authorization error:", err instanceof Error ? err.message : err);
      return res.status(500).json({ error: "Authorization error" });
    }
  };
}

/** Require a single permission (+ optional scope). */
export function requirePermission(permission: string, opts?: PermissionOptions): RequestHandler {
  return build([permission], "all", opts);
}

/** Require ALL of the given permissions (+ optional scope). */
export function requireAllPermissions(permissions: string[], opts?: PermissionOptions): RequestHandler {
  return build(permissions, "all", opts);
}

/** Require ANY of the given permissions (+ optional scope). */
export function requireAnyPermission(permissions: string[], opts?: PermissionOptions): RequestHandler {
  return build(permissions, "any", opts);
}
