// Phase 4B — react-query hooks for the access-management control plane.
//
// Reads use the shared queryClient. Mutations return the raw promise so callers
// can await, surface errors via describeAccessError, then invalidate/refetch.
// The user-detail cache is the source of truth after a mutation — we refetch it
// rather than optimistically mutating privilege state.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "./keys";
import { accessApi, type UserListFilters } from "@/lib/access/accessApi";

function filtersKey(f: UserListFilters): string {
  return JSON.stringify({
    search: f.search ?? "",
    status: f.status ?? "",
    role: f.role ?? "",
    organizationId: f.organizationId ?? "",
    clinicId: f.clinicId ?? "",
  });
}

export function useAccessUsers(filters: UserListFilters, enabled = true) {
  return useQuery({
    queryKey: qk.access.users(filtersKey(filters)),
    queryFn: () => accessApi.listUsers(filters),
    enabled,
  });
}

export function useAccessUser(id: string | null) {
  return useQuery({
    queryKey: qk.access.user(id ?? "none"),
    queryFn: () => accessApi.getUser(id as string),
    enabled: !!id,
  });
}

export function useAccessOrganizations(enabled = true) {
  return useQuery({
    queryKey: qk.access.organizations(),
    queryFn: () => accessApi.listOrganizations(),
    enabled,
  });
}

export function useAccessClinics(enabled = true) {
  return useQuery({
    queryKey: qk.access.clinics(),
    queryFn: () => accessApi.listClinics(),
    enabled,
  });
}

export function useAccessRoles(enabled = true) {
  return useQuery({
    queryKey: qk.access.roles(),
    queryFn: () => accessApi.listRoles(),
    enabled,
  });
}

export function useAccessRole(key: string | null) {
  return useQuery({
    queryKey: qk.access.role(key ?? "none"),
    queryFn: () => accessApi.getRole(key as string),
    enabled: !!key,
  });
}

export function useAccessPermissions(enabled = true) {
  return useQuery({
    queryKey: qk.access.permissions(),
    queryFn: () => accessApi.listPermissions(),
    enabled,
  });
}

export function useAccessServices(enabled = true) {
  return useQuery({
    queryKey: qk.access.services(),
    queryFn: () => accessApi.listServices(),
    enabled,
  });
}

export function useAccessAudit(enabled = true, limit?: number) {
  return useQuery({
    queryKey: qk.access.audit(),
    queryFn: () => accessApi.getAudit(limit),
    enabled,
  });
}

/** Invalidate the user list + a specific user's detail after a mutation. */
export function useInvalidateAccessUser() {
  const client = useQueryClient();
  return (id?: string) => {
    client.invalidateQueries({ queryKey: ["/api/access/users"] });
    if (id) client.invalidateQueries({ queryKey: qk.access.user(id) });
    // The actor's own effective access may have changed if they edited
    // themselves; refresh /api/auth/me so nav/guards stay honest.
    client.invalidateQueries({ queryKey: qk.auth.me() });
    client.invalidateQueries({ queryKey: qk.access.audit() });
  };
}
