// Phase 4B — typed client for the frozen /api/access/* control plane.
//
// The BACKEND is authoritative. This module is a thin, typed transport layer:
// it shapes requests, types responses to match the frozen contracts, and
// normalizes errors so the Settings UI can surface 400/403/404 clearly. It
// contains NO authorization logic and NEVER recomputes effective permissions —
// it only reads what the backend returns.

import { apiRequest, ApiError } from "@/lib/queryClient";

// ─── Response contract types (mirror accessAdminService return shapes) ───────

export interface AccessUserListRow {
  id: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  jobTitle: string | null;
  status: string;
  active: boolean;
  primaryLegacyRole: string | null;
  defaultWorkspace: string | null;
  lastLoginAt: string | null;
}

export interface AccessUserProfile {
  identity: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
    email: string | null;
    username: string;
    jobTitle: string | null;
  };
  account: {
    status: string;
    active: boolean;
    mfaRequired: boolean;
    lastLoginAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  };
  roles: { primary: string | null; additional: string[] };
  organizations: { organizationId: number; isPrimary: boolean }[];
  clinics: { clinicId: number; isPrimary: boolean }[];
  permissions: {
    inherited: string[];
    grants: string[];
    denies: string[];
    effective: string[];
  };
  serviceAccess: {
    inherited: string[];
    grants: string[];
    denies: string[];
    effective: string[];
  };
  defaultWorkspace: string;
  accessSummary: {
    platformScope: boolean;
    organizationIds: number[];
    clinicIds: number[];
  };
}

export interface AccessOrganization {
  id: number;
  name: string;
  slug: string;
  orgType: string;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}
export interface AccessOrganizationDetail extends AccessOrganization {
  clinics: { id: number; name: string }[];
}

export interface AccessClinic {
  id: number;
  name: string;
  slug?: string | null;
  organizationId?: number | null;
  active?: boolean | null;
  shortName?: string | null;
  facilityType?: string | null;
}

export interface AccessRoleSummary {
  id: number;
  key: string;
  displayName: string;
  description?: string | null;
  scopeType: string;
  defaultWorkspace: string;
  isSystem?: boolean | null;
  isAssignable?: boolean | null;
}
export interface AccessRoleDetail extends AccessRoleSummary {
  defaultPermissions: string[];
  defaultServiceAccess: string[];
}

export interface AccessPermissionRow {
  id: number;
  key: string;
  category: string;
  description: string;
}

export interface AccessServiceRow {
  internalCode: string;
  displayName: string;
  active: boolean;
  category: string | null;
}

export interface AccessAuditRow {
  id: number;
  clinicId: number | null;
  userId: string | null;
  username: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  changes: Record<string, unknown> | null;
  createdAt: string | null;
}
export interface AccessAuditResponse {
  scope: "platform" | "organization";
  rows: AccessAuditRow[];
}

export interface OverrideMutationResult {
  grants: string[];
  denies: string[];
  effective: string[];
}

// ─── Request payload types ───────────────────────────────────────────────────

export interface UserListFilters {
  search?: string;
  status?: string;
  role?: string;
  organizationId?: number;
  clinicId?: number;
}

export interface IdentityInput {
  firstName?: string;
  lastName?: string;
  displayName?: string;
  email?: string;
  jobTitle?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function qs(filters: UserListFilters): string {
  const p = new URLSearchParams();
  if (filters.search) p.set("search", filters.search);
  if (filters.status) p.set("status", filters.status);
  if (filters.role) p.set("role", filters.role);
  if (filters.organizationId != null) p.set("organizationId", String(filters.organizationId));
  if (filters.clinicId != null) p.set("clinicId", String(filters.clinicId));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/**
 * Translate a thrown ApiError from an access mutation into a human message.
 * The backend returns `{ error: "<reason>" }`; we map known reasons + HTTP
 * status to clear operator language. This is presentation only — the backend
 * already made and enforced the decision.
 */
export function describeAccessError(err: unknown): string {
  if (err instanceof ApiError) {
    const reason = extractReason(err.body);
    if (err.status === 403) {
      if (reason?.startsWith("clinic_out_of_scope")) return "This clinic is outside your authorized scope.";
      if (reason?.startsWith("organization_out_of_scope")) return "This organization is outside your authorized scope.";
      if (reason?.includes("cannot_assign") || reason?.includes("role")) return "This role cannot be assigned by your account.";
      if (reason?.includes("cannot_grant") || reason?.includes("permission")) return "You cannot grant a permission you do not hold.";
      return "You do not have permission to make this change.";
    }
    if (err.status === 400) {
      if (reason?.startsWith("unknown_role")) return "That role is not a valid role.";
      if (reason?.startsWith("role_not_assignable")) return "That role cannot be assigned yet.";
      if (reason?.startsWith("invalid_workspace")) return "That default workspace is not valid.";
      if (reason?.startsWith("invalid_status")) return "That account status is not valid.";
      if (reason?.includes("permission")) return "That permission key is not valid.";
      return reason ? humanize(reason) : "That change was rejected as invalid.";
    }
    if (err.status === 404) return "That record no longer exists.";
    if (err.status === 401) return "Your session has expired. Please sign in again.";
  }
  return "Something went wrong. Please try again.";
}

function extractReason(body: string): string | null {
  try {
    const j = JSON.parse(body);
    return typeof j?.error === "string" ? j.error : null;
  } catch {
    return null;
  }
}

function humanize(reason: string): string {
  return reason.replace(/[_:]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export const accessApi = {
  listUsers: async (filters: UserListFilters = {}): Promise<AccessUserListRow[]> =>
    json(await apiRequest("GET", `/api/access/users${qs(filters)}`)),

  getUser: async (id: string): Promise<AccessUserProfile> =>
    json(await apiRequest("GET", `/api/access/users/${id}`)),

  createUser: async (input: { username: string; password: string } & IdentityInput): Promise<{ id: string; username: string }> =>
    json(await apiRequest("POST", "/api/access/users", input)),

  updateIdentity: async (id: string, input: IdentityInput): Promise<{ ok: true }> =>
    json(await apiRequest("PATCH", `/api/access/users/${id}`, input)),

  setStatus: async (id: string, status: string): Promise<{ status: string; active: boolean }> =>
    json(await apiRequest("PATCH", `/api/access/users/${id}/status`, { status })),

  setRoles: async (id: string, primary: string, additional: string[] = []): Promise<unknown> =>
    json(await apiRequest("PUT", `/api/access/users/${id}/roles`, { primary, additional })),

  setOrganizations: async (
    id: string,
    organizations: { organizationId: number; isPrimary?: boolean }[],
  ): Promise<unknown> => json(await apiRequest("PUT", `/api/access/users/${id}/organizations`, { organizations })),

  setClinics: async (
    id: string,
    clinics: { clinicId: number; isPrimary?: boolean }[],
  ): Promise<unknown> => json(await apiRequest("PUT", `/api/access/users/${id}/clinics`, { clinics })),

  setPermissions: async (id: string, grants: string[], denies: string[]): Promise<OverrideMutationResult> =>
    json(await apiRequest("PUT", `/api/access/users/${id}/permissions`, { grants, denies })),

  setServices: async (id: string, grants: string[], denies: string[]): Promise<OverrideMutationResult> =>
    json(await apiRequest("PUT", `/api/access/users/${id}/services`, { grants, denies })),

  setDefaultWorkspace: async (id: string, defaultWorkspace: string): Promise<{ defaultWorkspace: string }> =>
    json(await apiRequest("PUT", `/api/access/users/${id}/default-workspace`, { defaultWorkspace })),

  listOrganizations: async (): Promise<AccessOrganization[]> =>
    json(await apiRequest("GET", "/api/access/organizations")),
  getOrganization: async (id: number): Promise<AccessOrganizationDetail> =>
    json(await apiRequest("GET", `/api/access/organizations/${id}`)),
  createOrganization: async (input: { name: string; slug: string; orgType?: string }): Promise<AccessOrganization> =>
    json(await apiRequest("POST", "/api/access/organizations", input)),
  updateOrganization: async (id: number, input: { name?: string; status?: string }): Promise<AccessOrganization> =>
    json(await apiRequest("PATCH", `/api/access/organizations/${id}`, input)),

  listClinics: async (): Promise<AccessClinic[]> => json(await apiRequest("GET", "/api/access/clinics")),
  getClinic: async (id: number): Promise<AccessClinic> => json(await apiRequest("GET", `/api/access/clinics/${id}`)),
  updateClinic: async (id: number, input: { name?: string; active?: boolean; shortName?: string }): Promise<AccessClinic> =>
    json(await apiRequest("PATCH", `/api/access/clinics/${id}`, input)),

  listRoles: async (): Promise<AccessRoleSummary[]> => json(await apiRequest("GET", "/api/access/roles")),
  getRole: async (key: string): Promise<AccessRoleDetail> => json(await apiRequest("GET", `/api/access/roles/${key}`)),
  listPermissions: async (): Promise<AccessPermissionRow[]> => json(await apiRequest("GET", "/api/access/permissions")),
  listServices: async (): Promise<AccessServiceRow[]> => json(await apiRequest("GET", "/api/access/services")),

  getAudit: async (limit?: number): Promise<AccessAuditResponse> =>
    json(await apiRequest("GET", `/api/access/audit${limit ? `?limit=${limit}` : ""}`)),
};
