// Phase 4B — presentation labels for access-management surfaces.
//
// Friendly, controlled labels for workspace identifiers, audit actions, and
// scope types. These are DISPLAY ONLY; the stored/submitted values remain the
// controlled machine identifiers from the shared catalog.

import { WORKSPACE_IDENTIFIERS, type WorkspaceIdentifier } from "@shared/schema/access";

/** Friendly labels for the controlled default-workspace identifiers. */
export const WORKSPACE_LABELS: Record<WorkspaceIdentifier, string> = {
  plexus_home: "Plexus OS Home",
  platform_admin: "Platform Admin",
  organization_admin: "Organization Admin",
  clinic_admin: "Clinic Admin",
  clinical: "Clinician Portal",
  acs: "ACS Portal",
  pcs: "PCS Portal",
  technician: "Technician Workspace",
  operations: "Mission Control",
  finance: "Plexus Bank",
  billing: "Billing",
  executive: "Executive Dashboard",
  investor: "Investor Access",
  technical: "Technical",
  compliance: "Compliance / Audit",
  patient_support: "Patient Support",
  implementation: "Clinic Onboarding",
};

/** Ordered list of controlled workspace options for a <Select>. */
export const WORKSPACE_OPTIONS: { value: WorkspaceIdentifier; label: string }[] =
  WORKSPACE_IDENTIFIERS.map((value) => ({ value, label: WORKSPACE_LABELS[value] ?? value }));

export function workspaceLabel(id: string | null | undefined): string {
  if (!id) return "—";
  return (WORKSPACE_LABELS as Record<string, string>)[id] ?? id;
}

/** Human-readable labels for audit action keys. */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  "user.role.assigned": "Role Changed",
  "user.status.changed": "Account Status Changed",
  "user.permission.override_set": "Permission Override Changed",
  "user.service_access.set": "Service Access Changed",
  "user.clinic.assigned": "Clinic Access Changed",
  "user.organization.assigned": "Organization Access Changed",
  "user.default_workspace.changed": "Default Workspace Changed",
  "user.identity.updated": "Identity Updated",
  "create": "Created",
  "update": "Updated",
  "clinic.updated": "Clinic Updated",
  "organization.created": "Organization Created",
  "organization.updated": "Organization Updated",
};

export function auditActionLabel(action: string): string {
  if (AUDIT_ACTION_LABELS[action]) return AUDIT_ACTION_LABELS[action];
  return action
    .replace(/^user\./, "")
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Scope-type friendly label. */
export function scopeTypeLabel(scopeType: string | null | undefined): string {
  switch (scopeType) {
    case "platform":
      return "Platform";
    case "organization":
      return "Organization";
    case "clinic":
      return "Clinic";
    default:
      return scopeType ?? "—";
  }
}

/** Account-status friendly label. */
export function statusLabel(status: string | null | undefined): string {
  switch (status) {
    case "active":
      return "Active";
    case "inactive":
      return "Inactive";
    case "suspended":
      return "Suspended";
    default:
      return status ?? "—";
  }
}

/**
 * Resolve a user's best display name using the required fallback chain:
 * displayName → firstName + lastName → username → email.
 */
export function resolveDisplayName(u: {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  email?: string | null;
}): string {
  if (u.displayName?.trim()) return u.displayName.trim();
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (u.username?.trim()) return u.username.trim();
  if (u.email?.trim()) return u.email.trim();
  return "Unknown user";
}

/** Format an ISO timestamp compactly, or a dash when absent. */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
