// FHIR Import Pipeline — shared types
//
// Covers FHIR R4 resource shapes (key fields only), the patient bundle
// grouping used throughout the pipeline, and the ImportResult returned
// to callers. All FHIR shapes are intentionally minimal — only the
// fields the mapper actually reads are declared; extra fields from the
// real NDJSON are safely ignored by the parser.

// ─── FHIR R4 Resource shapes ──────────────────────────────────────────────

export type FhirCoding = {
  system?: string;
  code?: string;
  display?: string;
};

export type FhirCodeableConcept = {
  coding?: FhirCoding[];
  text?: string;
};

export type FhirIdentifier = {
  use?: string;   // "usual" | "official" | "secondary" | etc.
  type?: {
    coding?: FhirCoding[];
  };
  system?: string;
  value?: string;
};

export type FhirHumanName = {
  family?: string;
  given?: string[];
  use?: string;
};

export type FhirContactPoint = {
  system?: string; // "phone" | "email" | "fax" | "pager" | "url" | "sms" | "other"
  value?: string;
  use?: string;
};

export type FhirAddress = {
  line?: string[];
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  use?: string;
};

export type FhirReference = {
  reference?: string; // e.g. "Patient/12345"
};

export type FhirPeriod = {
  start?: string; // ISO 8601
  end?: string;
};

// ─── Patient ──────────────────────────────────────────────────────────────

export type FhirPatient = {
  resourceType: "Patient";
  id?: string;
  identifier?: FhirIdentifier[];
  name?: FhirHumanName[];
  birthDate?: string; // YYYY-MM-DD
  gender?: string; // "male" | "female" | "other" | "unknown"
  telecom?: FhirContactPoint[];
  address?: FhirAddress[];
};

// ─── Medication (standalone drug resource — ECW pattern) ──────────────────
// ECW emits drug names in a separate Medication resource; MedicationRequests
// then reference it via medicationReference instead of embedding the name
// in medicationCodeableConcept. The parser builds a lookup map from these.

export type FhirMedication = {
  resourceType: "Medication";
  id?: string;
  code?: FhirCodeableConcept;
};

// ─── Condition ────────────────────────────────────────────────────────────

export type FhirCondition = {
  resourceType: "Condition";
  id?: string;
  subject?: FhirReference;
  code?: FhirCodeableConcept;
  clinicalStatus?: FhirCodeableConcept;
  onsetDateTime?: string;
  recordedDate?: string;
};

// ─── MedicationRequest ────────────────────────────────────────────────────

export type FhirMedicationRequest = {
  resourceType: "MedicationRequest";
  id?: string;
  subject?: FhirReference;
  // Standard FHIR: drug name embedded directly
  medicationCodeableConcept?: FhirCodeableConcept;
  // ECW pattern: reference to a standalone Medication resource
  medicationReference?: FhirReference;
  status?: string; // "active" | "stopped" | "completed" | "cancelled" | etc.
  authoredOn?: string;
};

// ─── Encounter ────────────────────────────────────────────────────────────

export type FhirEncounterParticipant = {
  type?: FhirCodeableConcept[];
  individual?: FhirReference;
};

export type FhirEncounterClass = {
  system?: string;
  code?: string;
  display?: string;
};

export type FhirEncounter = {
  resourceType: "Encounter";
  id?: string;
  subject?: FhirReference;
  status?: string; // "planned" | "arrived" | "triaged" | "in-progress" | "finished" | "cancelled"
  class?: FhirEncounterClass;
  period?: FhirPeriod;
  type?: FhirCodeableConcept[];
  participant?: FhirEncounterParticipant[];
};

// ─── Procedure ────────────────────────────────────────────────────────────

export type FhirProcedure = {
  resourceType: "Procedure";
  id?: string;
  status?: string; // "preparation" | "in-progress" | "not-done" | "on-hold" | "stopped" | "completed" | "entered-in-error" | "unknown"
  code?: FhirCodeableConcept;
  subject?: FhirReference;
  performedDateTime?: string;
  performedPeriod?: FhirPeriod;
};

// ─── DiagnosticReport ─────────────────────────────────────────────────────

export type FhirDiagnosticReport = {
  resourceType: "DiagnosticReport";
  id?: string;
  subject?: FhirReference;
  code?: FhirCodeableConcept;
  status?: string; // "registered" | "partial" | "preliminary" | "final" | etc.
  effectiveDateTime?: string;
  issued?: string;
  conclusion?: string;
};

// ─── Union of all handled resource types ─────────────────────────────────

export type FhirResource =
  | FhirPatient
  | FhirMedication
  | FhirCondition
  | FhirMedicationRequest
  | FhirEncounter
  | FhirProcedure
  | FhirDiagnosticReport;

// ─── Patient bundle ───────────────────────────────────────────────────────
// One per unique FHIR patient id after grouping across all NDJSON files.

export type FhirPatientBundle = {
  patient: FhirPatient;
  conditions: FhirCondition[];
  medications: FhirMedicationRequest[];
  encounters: FhirEncounter[];
  procedures: FhirProcedure[];
  diagnosticReports: FhirDiagnosticReport[];
};

// ─── Parsed NDJSON result ─────────────────────────────────────────────────

export type ParsedFhirExport = {
  /** Bundles keyed by FHIR patient resource id (e.g. "12345") */
  bundles: Map<string, FhirPatientBundle>;
  /**
   * Drug name lookup built from standalone Medication resources.
   * Key = Medication.id, value = resolved display name.
   * Used by the mapper to resolve MedicationRequest.medicationReference.
   */
  medicationLookup: Map<string, string>;
  /** Total raw lines read (including blank / unparseable) */
  totalLines: number;
  /** Lines that failed JSON.parse or had no resourceType */
  parseErrors: number;
};

// ─── S3 file entry ─────────────────────────────────────────────────────────

export type S3NdjsonFile = {
  key: string;          // full S3 object key
  resourceType: string; // "Patient" | "Condition" | etc., inferred from key path
};

// ─── Orchestrator options & result ────────────────────────────────────────

export type FhirImportOptions = {
  /** ECW / EHR group id — maps to a specific clinic via config */
  groupId: string;
  /** Specific export timestamp folder; pass "latest" or omit to auto-detect */
  timestamp?: string;
  /** Integer FK to clinics.id */
  clinicId: number;
  /** Text slug stored in patient_directory.clinic_id (tech-debt: that column is TEXT) */
  clinicSlug: string;
  /** Display name used in batch naming */
  clinicName: string;
  /** When true, fire startBatchAnalysis after import */
  autoQualify: boolean;
  /** Parse + validate without writing anything to the DB */
  dryRun?: boolean;
};

export type FhirImportStats = {
  totalPatientBundles: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  batchId: number | null;
  /** jobId returned by startBatchAnalysis, when autoQualify=true */
  analysisJobId: number | null;
};

export type FhirImportResult = {
  ok: boolean;
  stats: FhirImportStats;
  /** Human-readable summary — PHI-safe (no patient names / DOBs) */
  message: string;
  error?: string;
};

// ─── Scheduler run record ─────────────────────────────────────────────────

export type FhirSchedulerRunRecord = {
  groupId: string;
  clinicId: number;
  ranAt: Date;
  result: FhirImportResult;
};
