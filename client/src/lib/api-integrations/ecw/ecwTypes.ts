// eClinicalWorks FHIR R4 — TypeScript domain types.
//
// PHASE 1 SCOPE: these types describe the UI surface only. The
// production schema lives in the backend (Phase 2) and will replace
// the demo-fallback shapes in `ecwDemoData.ts`. When the backend
// ships, the contract here is what the API responses must conform
// to so the UI doesn't need to change.
//
// Sources of truth referenced in the architecture doc:
//   docs/architecture/ecw-fhir-r4-integration-foundation.md

// ─────────────────────────────────────────────────────────────────────────
// Vendors + connections
// ─────────────────────────────────────────────────────────────────────────

export type IntegrationVendor = "eClinicalWorks";

export type IntegrationEnvironment = "Sandbox" | "Production";

export type AuthorizationStatus =
  | "Not Configured"
  | "Pending Authorization"
  | "Authorized"
  | "Token Expired"
  | "Refresh Failed"
  | "Revoked"
  | "Error";

export interface IntegrationConnectionProfile {
  id: string;
  vendor: IntegrationVendor;
  connectionName: string;
  clinicId: string | null;
  clinicLabel: string | null;
  environment: IntegrationEnvironment;
  fhirBaseUrl: string;
  bulkExportUrl: string | null;
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  // Reference into the credential vault, NOT the secret itself.
  // Phase 1 displays this as a masked placeholder.
  clientSecretVaultRef: string | null;
  organizationIdentifier: string | null;
  groupIdentifier: string | null;
  systemLevelAccessEnabled: boolean;
  smartOnFhirEnabled: boolean;
  bulkFhirEnabled: boolean;
  authorizationStatus: AuthorizationStatus;
  lastTokenRefresh: string | null;
  tokenExpiresAt: string | null;
  vendorSupportContact: string | null;
  implementationOwner: string | null;
  goLiveTargetDate: string | null;
  notes: string;
  // Phase 1 read-only flag: when true the UI surfaces a banner saying
  // the credential vault is wired and Save is safe. Until then Save
  // is disabled and the secret field is read-only.
  backendCredentialStoreReady: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Scopes
// ─────────────────────────────────────────────────────────────────────────

export type EcwResourceType =
  | "Patient"
  | "Encounter"
  | "Condition"
  | "MedicationRequest"
  | "Medication"
  | "Observation"
  | "DiagnosticReport"
  | "DocumentReference"
  | "Binary"
  | "Procedure"
  | "AllergyIntolerance"
  | "Coverage"
  | "Immunization"
  | "ServiceRequest"
  | "Practitioner"
  | "Device"
  | "MedicationAdministration"
  | "Specimen";

export type EcwScopeString = `system/${EcwResourceType}.read`;

export type SyncStatus =
  | "Requested"
  | "Accepted"
  | "In Progress"
  | "Complete"
  | "Partial Complete"
  | "Failed"
  | "Cancelled"
  | "Paused";

export interface EcwScopeDefinition {
  scope: EcwScopeString;
  resource: EcwResourceType;
  description: string;
  // Where this resource flows once normalized.
  destinationModules: DownstreamModule[];
  // Internal table(s) this resource normalizes into. Phase 2 will
  // create these — Phase 1 just names them.
  internalTables: string[];
  // Resources that must finish syncing before this one is meaningful
  // (e.g., Encounter rows need Patient rows first).
  dependsOn: EcwResourceType[];
  // Whether the resource is on the Phase 1 go-live checklist.
  requiredForGoLive: boolean;
}

export interface EcwScopeRuntimeState {
  scope: EcwScopeString;
  enabled: boolean;
  lastSyncStatus: SyncStatus | null;
  lastSyncAt: string | null;
  lastImportedCount: number | null;
  lastError: string | null;
  mappingStatus: MappingStatus;
}

export type MappingStatus =
  | "Not Started"
  | "In Progress"
  | "Ready to Validate"
  | "Validated"
  | "Blocked";

// ─────────────────────────────────────────────────────────────────────────
// Downstream modules
// ─────────────────────────────────────────────────────────────────────────

export type DownstreamModule =
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

// ─────────────────────────────────────────────────────────────────────────
// Field mapping
// ─────────────────────────────────────────────────────────────────────────

export interface FieldMapping {
  id: string;
  resource: EcwResourceType;
  // FHIR path-style source (e.g. `Patient.name[0].family`).
  sourcePath: string;
  // Internal column / property (e.g. `patient_screenings.lastName`).
  internalTarget: string;
  // Whether this is required for the resource to be usable downstream.
  required: boolean;
  // Notes / coding system / value-set guidance.
  notes: string;
  // Validation status. Backend-pending in Phase 1.
  validationStatus: "Not Validated" | "Sample Passed" | "Sample Failed" | "Not Applicable";
}

// ─────────────────────────────────────────────────────────────────────────
// Clinic + provider mapping
// ─────────────────────────────────────────────────────────────────────────

export interface ClinicMappingRow {
  id: string;
  ecwLocationId: string;
  ecwLocationName: string;
  internalFacilityId: string | null;
  internalFacilityName: string | null;
  status: "Unmapped" | "Mapped" | "Ambiguous";
  notes: string;
}

export interface ProviderMappingRow {
  id: string;
  ecwPractitionerId: string;
  ecwPractitionerName: string;
  ecwNpi: string | null;
  internalUserId: string | null;
  internalUserName: string | null;
  role: "Clinician" | "Scheduler" | "Technician" | "Liaison" | "Other";
  status: "Unmapped" | "Mapped" | "Ambiguous" | "Inactive";
  notes: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Patient identity matching
// ─────────────────────────────────────────────────────────────────────────

export type PatientMatchSignal =
  | "MRN exact"
  | "Name + DOB exact"
  | "Name + DOB fuzzy"
  | "Phone exact"
  | "Insurance member ID exact";

export interface PatientMatchRule {
  id: string;
  signal: PatientMatchSignal;
  enabled: boolean;
  weight: number; // 0–100; rules sum towards a match threshold
  notes: string;
}

export interface PatientIdentityCandidate {
  ecwPatientId: string;
  ecwMrn: string | null;
  ecwName: string;
  ecwDob: string | null;
  // The internal patient row this candidate would merge into, if any.
  internalCandidateId: string | null;
  internalCandidateName: string | null;
  matchScore: number;
  status: "Pending Review" | "Auto Merge" | "Manual Merge" | "Duplicate Suspect" | "No Match";
}

// ─────────────────────────────────────────────────────────────────────────
// Scheduling mapping
// ─────────────────────────────────────────────────────────────────────────

export type EncounterClassMapping =
  | { ecwClass: string; internalAppointmentType: string; behavior: "Use as appointment" | "Use as visit history" | "Ignore" };

export type ServiceRequestRoutingTarget =
  | "Plexus IQ qualification queue"
  | "Imaging Central work queue"
  | "Engagement Center outreach"
  | "Ancillary Documents inbox"
  | "Manual triage";

export interface ServiceRequestRoutingRule {
  id: string;
  // Either a CPT code or a category code (LOINC, SNOMED) the
  // ServiceRequest must match to take this route.
  matchType: "CPT" | "Category Code" | "Display Text Contains";
  matchValue: string;
  routesTo: ServiceRequestRoutingTarget;
  enabled: boolean;
  notes: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Orders + ancillary routing
// ─────────────────────────────────────────────────────────────────────────

export type AncillaryType =
  | "BrainWave"
  | "VitalWave"
  | "Ultrasound"
  | "EKG"
  | "PGX"
  | "CGX"
  | "Lab"
  | "Imaging (Other)";

export interface AncillaryOrderRoutingRule {
  id: string;
  ancillary: AncillaryType;
  destination: DownstreamModule;
  enabled: boolean;
  // Imaging Central is ultrasound-only — this flag is a UI hint, not
  // a runtime check. Runtime check lives in Phase 2 normalization.
  imagingCentralUltrasoundOnly: boolean;
  notes: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Documents + reports mapping
// ─────────────────────────────────────────────────────────────────────────

export type DocumentRoutingTarget =
  | "Document Library"
  | "Ancillary Documents inbox"
  | "Patient Journey Timeline"
  | "Billing Readiness packet"
  | "Manual review";

export interface DocumentRoutingRule {
  id: string;
  // FHIR coding system + code combo (LOINC most common).
  codingSystem: string;
  code: string;
  displayLabel: string;
  routesTo: DocumentRoutingTarget;
  enabled: boolean;
  notes: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Insurance / coverage mapping
// ─────────────────────────────────────────────────────────────────────────

export type PayorClass = "Medicare" | "Medicaid" | "Commercial" | "PPO" | "HMO" | "Cash" | "Other";

export interface CoverageMappingRow {
  id: string;
  ecwPayorName: string;
  ecwPayorIdentifier: string | null;
  internalPayorClass: PayorClass | null;
  internalPlanId: string | null;
  cooldownProfileKey: string | null;
  status: "Unmapped" | "Mapped" | "Needs Review";
  notes: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Billing readiness mapping
// ─────────────────────────────────────────────────────────────────────────

export interface BillingReadinessChecklistItem {
  id: string;
  label: string;
  sourceResource: EcwResourceType;
  sourceField: string;
  internalReadinessFlag: string;
  required: boolean;
  notes: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Sync jobs + errors + audit
// ─────────────────────────────────────────────────────────────────────────

export interface SyncJob {
  id: string;
  connectionId: string;
  jobType:
    | "Full Import"
    | "Incremental Sync"
    | "Resource-Specific Sync"
    | "Date Range Import"
    | "Patient Panel Import"
    | "Clinic Import"
    | "Provider Import"
    | "Validation Only";
  resource: EcwResourceType | "All";
  status: SyncStatus;
  startedAt: string | null;
  finishedAt: string | null;
  requestedBy: string;
  resourceCount: number | null;
  errorCount: number | null;
  notes: string;
}

export type ErrorCategory =
  | "Authentication"
  | "Authorization"
  | "Network"
  | "Rate Limit"
  | "Validation"
  | "Mapping"
  | "Downstream Routing"
  | "PHI Integrity"
  | "Unknown";

export interface SyncErrorRow {
  id: string;
  jobId: string | null;
  resource: EcwResourceType | "Connection";
  category: ErrorCategory;
  severity: "Info" | "Warning" | "Error" | "Critical";
  message: string;
  occurredAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  // Set when the error is associated with a specific upstream resource
  // ID. Surfaced for triage, never used to render PHI.
  upstreamResourceId: string | null;
}

export type AuditEventType =
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
  | "Connection Disabled";

export interface AuditLogEntry {
  id: string;
  occurredAt: string;
  actor: string;
  eventType: AuditEventType;
  connectionId: string;
  // Free-text human-readable summary. Must NOT include patient PHI.
  summary: string;
  // Optional JSON diff for mapping / scope / config changes. Backend
  // pending in Phase 1.
  diff: Record<string, unknown> | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Resource count widget shape
// ─────────────────────────────────────────────────────────────────────────

export interface ResourceCountRow {
  resource: EcwResourceType;
  lastImportedCount: number | null;
  lastSyncAt: string | null;
  lastSyncStatus: SyncStatus | null;
}
