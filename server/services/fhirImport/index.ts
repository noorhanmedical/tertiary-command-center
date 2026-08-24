// FHIR Import Pipeline — barrel re-export
//
// Import from this index to avoid deep relative imports in other modules.

export type {
  FhirPatient,
  FhirMedication,
  FhirCondition,
  FhirMedicationRequest,
  FhirEncounter,
  FhirProcedure,
  FhirDiagnosticReport,
  FhirResource,
  FhirPatientBundle,
  ParsedFhirExport,
  S3NdjsonFile,
  FhirImportOptions,
  FhirImportStats,
  FhirImportResult,
  FhirSchedulerRunRecord,
} from "./types";

export { parseFhirNdjsonFiles, ingestNdjsonContent, extractPatientIdFromReference } from "./fhirNdjsonParser";

export {
  mapFhirToPatientDirectory,
  mapFhirToScreening,
  extractMrn,
  extractPhone,
  extractEmail,
  calculateAge,
  getConditionDisplay,
  getMedicationDisplay,
  resolveMedicationName,
  getProcedureDisplay,
  getProcedureDate,
  hasUpcomingEncounter,
} from "./fhirPatientMapper";

export {
  listExportTimestamps,
  getLatestExportTimestamp,
  listNdjsonFiles,
  downloadNdjsonFile,
  readAllNdjsonFiles,
} from "./fhirS3Reader";

export { getClinicGroupMappings, getMappingByGroupId, getMappingByClinicId } from "./config";
export type { ClinicGroupMapping } from "./config";

export { runFhirImport } from "./fhirImportOrchestrator";

export {
  startFhirImportScheduler,
  stopFhirImportScheduler,
  getFhirSchedulerRunHistory,
  triggerFhirSchedulerTick,
} from "./fhirImportScheduler";
