// Phase 4B — reusable permission gate for UX visibility.
//
// UX ONLY. This hides or disables interface affordances the user cannot use.
// It is NOT a security boundary — the backend enforces every access decision
// on the API. Never rely on this to protect data; rely on it to keep the UI
// honest about what the current user can do.
//
//   <PermissionGuard permission="users.view">…</PermissionGuard>
//   <PermissionGuard anyOf={["platform.audit.view", "audit.organization.view"]}>…</PermissionGuard>
//   <PermissionGuard allOf={["clinic.manage", "organization.manage"]}>…</PermissionGuard>

import type { ReactNode } from "react";
import { useAccess } from "./accessContext";

interface PermissionGuardProps {
  /** Single permission that must be held. */
  permission?: string;
  /** Held if ANY of these are present. */
  anyOf?: string[];
  /** Held only if ALL of these are present. */
  allOf?: string[];
  /** Rendered when the check fails. Defaults to nothing. */
  fallback?: ReactNode;
  children: ReactNode;
}

/** Compute whether the current access context satisfies a guard spec. */
export function useHasAccess(spec: Pick<PermissionGuardProps, "permission" | "anyOf" | "allOf">): boolean {
  const { hasPermission, hasAnyPermission, hasAllPermissions } = useAccess();
  if (spec.permission && !hasPermission(spec.permission)) return false;
  if (spec.anyOf && spec.anyOf.length > 0 && !hasAnyPermission(spec.anyOf)) return false;
  if (spec.allOf && spec.allOf.length > 0 && !hasAllPermissions(spec.allOf)) return false;
  // If no spec supplied at all, default to visible (nothing to restrict).
  return true;
}

export function PermissionGuard({ permission, anyOf, allOf, fallback = null, children }: PermissionGuardProps) {
  const allowed = useHasAccess({ permission, anyOf, allOf });
  return <>{allowed ? children : fallback}</>;
}
