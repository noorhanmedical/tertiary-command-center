// API Integration Station — vendor-neutral domain types.
//
// PHASE 1 SCOPE: these types describe the integration shell the UI
// renders today. They are deliberately vendor-neutral so additional
// EMR vendors (Epic FHIR, Athena, Oracle Health / Cerner, NextGen,
// Veradigm, Meditech, Other FHIR R4 EMR) can be added without
// rewriting the shell.
//
// Per-vendor specifics (e.g., the 18 eCW FHIR R4 scopes) live in
// the vendor adapter folders under `client/src/lib/api-integrations/<vendor>/`.

import type { LucideIcon } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────
// Vendors
// ─────────────────────────────────────────────────────────────────────────

export type IntegrationVendor =
  | "eClinicalWorks"
  | "Epic"
  | "Athena"
  | "Oracle Health (Cerner)"
  | "NextGen"
  | "Veradigm"
  | "Meditech"
  | "Other FHIR R4 EMR";

// ─────────────────────────────────────────────────────────────────────────
// Connection profile (vendor-neutral). Per-vendor adapters narrow the
// `fields` shape via discriminated unions when needed.
// ─────────────────────────────────────────────────────────────────────────

export type IntegrationEnvironment = "Sandbox" | "Production";

export type IntegrationAuthStatus =
  | "Not Configured"
  | "Pending Authorization"
  | "Authorized"
  | "Token Expired"
  | "Refresh Failed"
  | "Revoked"
  | "Error";

export interface IntegrationConnection {
  id: string;
  vendor: IntegrationVendor;
  connectionName: string;
  environment: IntegrationEnvironment;
  // Vendor-specific endpoints live on the adapter; this is the
  // shared minimum every connection must declare.
  baseUrl: string;
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  // Opaque reference into the credential vault. The raw secret never
  // travels through the browser.
  clientSecretVaultRef: string | null;
  authStatus: IntegrationAuthStatus;
  lastAuthorizedAt: string | null;
  tokenExpiresAt: string | null;
  // Phase 1 flag — until the credential vault is wired, Save is disabled.
  backendCredentialStoreReady: boolean;
  notes: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Sync status — shared across every vendor adapter
// ─────────────────────────────────────────────────────────────────────────

export type IntegrationSyncStatus =
  | "Requested"
  | "Accepted"
  | "In Progress"
  | "Complete"
  | "Partial Complete"
  | "Failed"
  | "Cancelled"
  | "Paused"
  | "Not Configured"
  | "Backend Pending";

// ─────────────────────────────────────────────────────────────────────────
// Scope (vendor-neutral wrapper). Per-vendor adapter narrows the
// `vendorScopeId` (e.g., `system/Patient.read` for FHIR R4).
// ─────────────────────────────────────────────────────────────────────────

export interface IntegrationScope {
  vendor: IntegrationVendor;
  vendorScopeId: string;
  resource: string;
  description: string;
  destinationModules: IntegrationDownstreamDestination[];
  internalTables: string[];
  dependsOn: string[];
  requiredForGoLive: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Field mapping (vendor-neutral). Every vendor flattens its native
// resource shape onto FHIR-path-like accessors.
// ─────────────────────────────────────────────────────────────────────────

export interface IntegrationFieldMapping {
  id: string;
  vendor: IntegrationVendor;
  resource: string;
  sourcePath: string;
  internalTarget: string;
  required: boolean;
  notes: string;
  validationStatus:
    | "Not Validated"
    | "Sample Passed"
    | "Sample Failed"
    | "Not Applicable";
}

// ─────────────────────────────────────────────────────────────────────────
// Sync jobs + errors
// ─────────────────────────────────────────────────────────────────────────

export interface IntegrationSyncJob {
  id: string;
  connectionId: string;
  vendor: IntegrationVendor;
  jobType:
    | "Full Import"
    | "Incremental Sync"
    | "Resource-Specific Sync"
    | "Date Range Import"
    | "Patient Panel Import"
    | "Clinic Import"
    | "Provider Import"
    | "Validation Only";
  resource: string | "All";
  status: IntegrationSyncStatus;
  startedAt: string | null;
  finishedAt: string | null;
  requestedBy: string;
  resourceCount: number | null;
  errorCount: number | null;
  notes: string;
}

export type IntegrationErrorCategory =
  | "Authentication"
  | "Authorization"
  | "Network"
  | "Rate Limit"
  | "Validation"
  | "Mapping"
  | "Downstream Routing"
  | "PHI Integrity"
  | "Unknown";

export interface IntegrationSyncError {
  id: string;
  jobId: string | null;
  vendor: IntegrationVendor;
  resource: string | "Connection";
  category: IntegrationErrorCategory;
  severity: "Info" | "Warning" | "Error" | "Critical";
  message: string;
  occurredAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  upstreamResourceId: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Audit events
// ─────────────────────────────────────────────────────────────────────────

export type IntegrationAuditEventType =
  | "Connection Created"
  | "Connection Updated"
  | "Authorization Started"
  | "Authorization Succeeded"
  | "Authorization Failed"
  | "Token Refreshed"
  | "Sync Requested"
  | "Sync Completed"
  | "Sync Failed"
  | "Mapping Updated"
  | "Scope Toggled"
  | "Secret Rotated"
  | "Connection Disabled"
  | "Writeback Attempted"
  | "Writeback Rejected";

export interface IntegrationAuditEvent {
  id: string;
  occurredAt: string;
  actor: string;
  eventType: IntegrationAuditEventType;
  vendor: IntegrationVendor;
  connectionId: string;
  // Free-text summary. MUST NOT include PHI.
  summary: string;
  // JSON diff for config / mapping changes (no PHI).
  diff: Record<string, unknown> | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Downstream destinations + resource counts
// ─────────────────────────────────────────────────────────────────────────

export type IntegrationDownstreamDestination =
  | "Patient Directory"
  | "Scheduling"
  | "Engagement Center"
  | "Plexus IQ"
  | "Imaging Central"
  | "Ancillary Documents"
  | "Billing Readiness"
  | "Document Library"
  | "Patient Journey Timeline"
  | "Mission Control"
  | "Team Ops";

export interface IntegrationResourceCount {
  vendor: IntegrationVendor;
  resource: string;
  lastImportedCount: number | null;
  lastSyncAt: string | null;
  lastSyncStatus: IntegrationSyncStatus | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Credential policy
// ─────────────────────────────────────────────────────────────────────────

export interface IntegrationCredentialPolicy {
  // No raw secret in source / localStorage / logs.
  secretsServerSideOnly: true;
  // The UI displays only a vault reference once stored.
  vaultReferenceVisible: boolean;
  // PHI must never enter audit summaries or error messages.
  phiNeverLogged: true;
  // Tokens carry explicit TTL + refresh under advisory lock.
  tokensHaveTtl: true;
  // Every credential read/rotate writes an audit event.
  credentialChangesAudited: true;
  // Writeback scopes are off unless explicitly configured + approved.
  writebackRequiresApproval: true;
}

// ─────────────────────────────────────────────────────────────────────────
// Test console
// ─────────────────────────────────────────────────────────────────────────

export interface IntegrationTestResult {
  id: string;
  label: string;
  status: "Not Run" | "Running" | "Passed" | "Failed" | "Backend Pending";
  message: string | null;
  ranAt: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Vendor catalog row (used by the Vendors section in the UI)
// ─────────────────────────────────────────────────────────────────────────

export interface IntegrationVendorAdapterCard {
  vendor: IntegrationVendor;
  shortLabel: string;
  description: string;
  Icon: LucideIcon;
  // "Available" = adapter ships in Phase 1; "Future" = placeholder.
  status: "Available" | "Future";
  // Adapter-specific landing section the UI jumps to.
  adapterSectionId: string | null;
}
