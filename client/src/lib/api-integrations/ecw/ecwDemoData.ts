// DEMO FALLBACK — Phase 1 UI seeds.
//
// IMPORTANT: every value here is a SAFE PLACEHOLDER. There is NO real
// PHI in this file. Sync stats, error counts, audit entries, and
// resource counters all render as zeros / "Not Configured" until the
// Phase 2 backend lands. Nothing in here pretends a sync succeeded.
//
// This file exists so the UI compiles + renders without throwing on
// missing data. When the backend ships, swap each export for a
// TanStack Query call (`useQuery({queryKey:["api-integrations", ...]})`).

import type {
  AuditLogEntry,
  ClinicMappingRow,
  CoverageMappingRow,
  EcwScopeRuntimeState,
  IntegrationConnectionProfile,
  PatientIdentityCandidate,
  ProviderMappingRow,
  ResourceCountRow,
  SyncErrorRow,
  SyncJob,
} from "./ecwTypes";
import { ECW_RESOURCES } from "./ecwScopes";

// The default empty connection profile shown in the Connection
// Profile section before any real config exists. Every field is
// intentionally blank/false; nothing here is a "live" config.
export const EMPTY_CONNECTION_PROFILE: IntegrationConnectionProfile = {
  id: "",
  vendor: "eClinicalWorks",
  connectionName: "",
  clinicId: null,
  clinicLabel: null,
  environment: "Sandbox",
  fhirBaseUrl: "",
  bulkExportUrl: null,
  authorizationUrl: "",
  tokenUrl: "",
  clientId: "",
  clientSecretVaultRef: null,
  organizationIdentifier: null,
  groupIdentifier: null,
  systemLevelAccessEnabled: false,
  smartOnFhirEnabled: false,
  bulkFhirEnabled: false,
  authorizationStatus: "Not Configured",
  lastTokenRefresh: null,
  tokenExpiresAt: null,
  vendorSupportContact: null,
  implementationOwner: null,
  goLiveTargetDate: null,
  notes: "",
  // Phase 1 flag: backend credential vault is NOT wired yet, so
  // Save is held until Phase 2 lands. The UI uses this to disable
  // secret-write actions and surface a "backend pending" banner.
  backendCredentialStoreReady: false,
};

// Initial scope runtime state — every scope is disabled and has no
// import history. Phase 2 will populate this from the sync engine.
export const INITIAL_SCOPE_RUNTIME_STATE: EcwScopeRuntimeState[] =
  ECW_RESOURCES.map((resource) => ({
    scope: `system/${resource}.read`,
    enabled: false,
    lastSyncStatus: null,
    lastSyncAt: null,
    lastImportedCount: null,
    lastError: null,
    mappingStatus: "Not Started",
  }));

// Initial resource counts — all zero, all pending.
export const INITIAL_RESOURCE_COUNTS: ResourceCountRow[] = ECW_RESOURCES.map(
  (resource) => ({
    resource,
    lastImportedCount: null,
    lastSyncAt: null,
    lastSyncStatus: null,
  }),
);

// Demo lists that are empty by design — the UI tables render their
// empty states. NEVER seed PHI here, even fake-looking.
export const DEMO_CLINIC_MAPPINGS: ClinicMappingRow[] = [];
export const DEMO_PROVIDER_MAPPINGS: ProviderMappingRow[] = [];
export const DEMO_COVERAGE_MAPPINGS: CoverageMappingRow[] = [];
export const DEMO_PATIENT_IDENTITY_CANDIDATES: PatientIdentityCandidate[] = [];
export const DEMO_SYNC_JOBS: SyncJob[] = [];
export const DEMO_SYNC_ERRORS: SyncErrorRow[] = [];
export const DEMO_AUDIT_LOG: AuditLogEntry[] = [];
