// Phase 4B — the single shared frontend auth/access context.
//
// This is the ONE place the app reads the current user's effective access. It
// wraps the already-cached GET /api/auth/me result (react-query key
// ["/api/auth/me"]) and exposes convenience helpers for UX visibility and
// control state.
//
// AUTHORITY BOUNDARY: the backend is the security boundary. These helpers only
// answer "should the UI show/enable this?". They read the backend's ALREADY
// computed effective permission/service-access sets (deny applied server-side)
// — the client NEVER recomputes inheritance, grants, or denies. Do not build a
// second permission model on top of this.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useCurrentUser } from "@/hooks/api/auth";
import type { AuthUser } from "@/App";

export interface AccessContextValue {
  /** The current user, or null when unauthenticated. */
  user: AuthUser;
  isLoading: boolean;
  /** Effective permission keys (backend-computed, deny applied). */
  permissions: string[];
  /** Active roles with scope/default-workspace metadata. */
  roles: NonNullable<AuthUser>["roles"];
  /** Resolved scope (platform flag + org/clinic id sets). */
  scope: { platform: boolean; organizationIds: number[]; clinicIds: number[] };
  /** Effective ancillary service access codes (backend-computed). */
  serviceAccess: string[];
  /** Controlled default-workspace identifier. */
  defaultWorkspace: string | null;
  /** Legacy single-role string (transition-era). */
  legacyRole: string | null;

  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
  hasAllPermissions: (permissions: string[]) => boolean;
  hasServiceAccess: (code: string) => boolean;
}

const AccessCtx = createContext<AccessContextValue | null>(null);

const EMPTY_SCOPE = { platform: false, organizationIds: [] as number[], clinicIds: [] as number[] };

/**
 * Provider. Mount once near the app root INSIDE QueryClientProvider. It reads
 * the shared /api/auth/me cache — it does not fetch a second copy.
 */
export function AccessProvider({ children }: { children: ReactNode }) {
  const { data: user, isLoading } = useCurrentUser();

  const value = useMemo<AccessContextValue>(() => {
    const permissions = user?.permissions ?? [];
    const permSet = new Set(permissions);
    const serviceAccess = user?.serviceAccess ?? [];
    const svcSet = new Set(serviceAccess);
    return {
      user: user ?? null,
      isLoading,
      permissions,
      roles: user?.roles ?? [],
      scope: user?.scope ?? EMPTY_SCOPE,
      serviceAccess,
      defaultWorkspace: user?.defaultWorkspace ?? null,
      legacyRole: user?.role ?? null,
      hasPermission: (p) => permSet.has(p),
      hasAnyPermission: (ps) => ps.some((p) => permSet.has(p)),
      hasAllPermissions: (ps) => ps.every((p) => permSet.has(p)),
      hasServiceAccess: (c) => svcSet.has(c),
    };
  }, [user, isLoading]);

  return <AccessCtx.Provider value={value}>{children}</AccessCtx.Provider>;
}

/** Read the shared access context. Throws if used outside AccessProvider. */
export function useAccess(): AccessContextValue {
  const ctx = useContext(AccessCtx);
  if (!ctx) throw new Error("useAccess must be used within an AccessProvider");
  return ctx;
}

// ─── Settings-entry capability set ────────────────────────────────────────────
// The permissions that legitimately grant entry to the access-management
// Settings console. Holding ANY one lets a user IN; individual sections remain
// separately gated (see admin-access.tsx). Kept here so the entry guard and the
// nav-visibility hook agree on exactly one definition.
export const SETTINGS_ENTRY_PERMISSIONS = [
  "users.view",
  "users.manage",
  "organization.view",
  "organization.manage",
  "clinic.view",
  "clinic.manage",
  "platform.audit.view",
  "audit.organization.view",
] as const;

/** Does this permission set grant entry to the access-management Settings? */
export function canEnterAccessSettings(permissions: string[] | undefined | null): boolean {
  if (!permissions?.length) return false;
  const set = new Set(permissions);
  return SETTINGS_ENTRY_PERMISSIONS.some((p) => set.has(p));
}
