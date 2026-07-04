// eClinicalWorks FHIR R4 — field mapping baseline.
//
// PHASE 1 SCOPE: the mappings below define the FHIR paths the
// Integration Station expects to consume and the internal targets
// they normalize into. These are reviewer-visible defaults; the
// real normalization runs in Phase 2 on the server.
//
// The list is intentionally short — one or two mappings per resource
// — to seed the UI. Phase 2 will expand each resource to the full
// field surface as we ingest real samples.

import type { FieldMapping } from "./ecwTypes";

export const ECW_FIELD_MAPPINGS: FieldMapping[] = [
  // Patient
  { id: "patient.mrn", resource: "Patient", sourcePath: "Patient.identifier[type=MR].value", internalTarget: "patient_screenings.mrn", required: true, notes: "Use MR-typed identifier; ignore SSN and DL-typed identifiers.", validationStatus: "Not Validated" },
  { id: "patient.last", resource: "Patient", sourcePath: "Patient.name[use=official].family", internalTarget: "patient_screenings.lastName", required: true, notes: "", validationStatus: "Not Validated" },
  { id: "patient.first", resource: "Patient", sourcePath: "Patient.name[use=official].given[0]", internalTarget: "patient_screenings.firstName", required: true, notes: "", validationStatus: "Not Validated" },
  { id: "patient.dob", resource: "Patient", sourcePath: "Patient.birthDate", internalTarget: "patient_screenings.dob", required: true, notes: "ISO date.", validationStatus: "Not Validated" },
  { id: "patient.phone", resource: "Patient", sourcePath: "Patient.telecom[system=phone&use=mobile].value", internalTarget: "patient_screenings.phoneNumber", required: false, notes: "Prefer mobile; fall back to home.", validationStatus: "Not Validated" },

  // Encounter
  { id: "encounter.start", resource: "Encounter", sourcePath: "Encounter.period.start", internalTarget: "global_schedule_events.scheduledAt", required: true, notes: "", validationStatus: "Not Validated" },
  { id: "encounter.class", resource: "Encounter", sourcePath: "Encounter.class.code", internalTarget: "global_schedule_events.appointmentClass", required: true, notes: "Used by scheduling-mapping rules.", validationStatus: "Not Validated" },
  { id: "encounter.location", resource: "Encounter", sourcePath: "Encounter.location[0].location.reference", internalTarget: "global_schedule_events.facilityId", required: true, notes: "Resolves via Clinic Mapping table.", validationStatus: "Not Validated" },

  // Condition
  { id: "condition.code", resource: "Condition", sourcePath: "Condition.code.coding[system=icd-10].code", internalTarget: "patient_screenings.diagnoses", required: true, notes: "Stored as `code | display` semicolon-joined.", validationStatus: "Not Validated" },
  { id: "condition.onset", resource: "Condition", sourcePath: "Condition.onsetDateTime", internalTarget: "patient_journey_events.eventDate", required: false, notes: "", validationStatus: "Not Validated" },

  // MedicationRequest
  { id: "medreq.code", resource: "MedicationRequest", sourcePath: "MedicationRequest.medicationCodeableConcept.coding[system=rxnorm].code", internalTarget: "patient_screenings.medications", required: true, notes: "Join to Medication for class.", validationStatus: "Not Validated" },
  { id: "medreq.status", resource: "MedicationRequest", sourcePath: "MedicationRequest.status", internalTarget: "patient_screenings.medications.active", required: false, notes: "Only `active` flows into qualification.", validationStatus: "Not Validated" },

  // Medication
  { id: "medication.name", resource: "Medication", sourcePath: "Medication.code.coding[system=rxnorm].display", internalTarget: "medication_catalog.displayName", required: true, notes: "", validationStatus: "Not Validated" },
  { id: "medication.class", resource: "Medication", sourcePath: "Medication.code.coding[system=usp].code", internalTarget: "medication_catalog.drugClass", required: false, notes: "Optional; not all payors return USP coding.", validationStatus: "Not Validated" },

  // Observation
  { id: "obs.code", resource: "Observation", sourcePath: "Observation.code.coding[system=loinc].code", internalTarget: "patient_screenings.history", required: true, notes: "LOINC required for filtering.", validationStatus: "Not Validated" },
  { id: "obs.value", resource: "Observation", sourcePath: "Observation.valueQuantity.value", internalTarget: "patient_screenings.history", required: false, notes: "Stored alongside code + units.", validationStatus: "Not Validated" },
  { id: "obs.effective", resource: "Observation", sourcePath: "Observation.effectiveDateTime", internalTarget: "patient_journey_events.eventDate", required: true, notes: "", validationStatus: "Not Validated" },

  // DiagnosticReport
  { id: "diag.code", resource: "DiagnosticReport", sourcePath: "DiagnosticReport.code.coding[system=loinc].code", internalTarget: "case_document_readiness.reportType", required: true, notes: "", validationStatus: "Not Validated" },
  { id: "diag.binary", resource: "DiagnosticReport", sourcePath: "DiagnosticReport.presentedForm[0].url", internalTarget: "case_document_readiness.binaryRef", required: true, notes: "Resolves to a Binary fetch.", validationStatus: "Not Validated" },

  // DocumentReference
  { id: "docref.type", resource: "DocumentReference", sourcePath: "DocumentReference.type.coding[system=loinc].code", internalTarget: "documents.kindCode", required: true, notes: "Used by Document Routing rules.", validationStatus: "Not Validated" },
  { id: "docref.binary", resource: "DocumentReference", sourcePath: "DocumentReference.content[0].attachment.url", internalTarget: "documents.binaryRef", required: true, notes: "", validationStatus: "Not Validated" },

  // Binary
  { id: "binary.contentType", resource: "Binary", sourcePath: "Binary.contentType", internalTarget: "document_blobs.mimeType", required: true, notes: "Stored as MIME; Phase 1 catalogs only.", validationStatus: "Not Validated" },

  // Procedure
  { id: "procedure.code", resource: "Procedure", sourcePath: "Procedure.code.coding[system=cpt].code", internalTarget: "procedure_events.cptCode", required: true, notes: "", validationStatus: "Not Validated" },
  { id: "procedure.performed", resource: "Procedure", sourcePath: "Procedure.performedDateTime", internalTarget: "procedure_events.performedAt", required: true, notes: "", validationStatus: "Not Validated" },

  // AllergyIntolerance
  { id: "allergy.code", resource: "AllergyIntolerance", sourcePath: "AllergyIntolerance.code.coding[system=snomed].code", internalTarget: "patient_allergies.code", required: true, notes: "", validationStatus: "Not Validated" },
  { id: "allergy.severity", resource: "AllergyIntolerance", sourcePath: "AllergyIntolerance.reaction[0].severity", internalTarget: "patient_allergies.severity", required: false, notes: "", validationStatus: "Not Validated" },

  // Coverage
  { id: "coverage.payor", resource: "Coverage", sourcePath: "Coverage.payor[0].display", internalTarget: "insurance_eligibility_review.payorDisplay", required: true, notes: "Resolves via Coverage Mapping table.", validationStatus: "Not Validated" },
  { id: "coverage.memberId", resource: "Coverage", sourcePath: "Coverage.subscriberId", internalTarget: "insurance_eligibility_review.memberId", required: true, notes: "", validationStatus: "Not Validated" },
  { id: "coverage.period", resource: "Coverage", sourcePath: "Coverage.period.start", internalTarget: "insurance_eligibility_review.effectiveFrom", required: false, notes: "", validationStatus: "Not Validated" },

  // Immunization
  { id: "immunization.code", resource: "Immunization", sourcePath: "Immunization.vaccineCode.coding[system=cvx].code", internalTarget: "patient_immunizations.code", required: true, notes: "", validationStatus: "Not Validated" },

  // ServiceRequest
  { id: "sr.intent", resource: "ServiceRequest", sourcePath: "ServiceRequest.intent", internalTarget: "service_requests.intent", required: true, notes: "Filter on `order` for active orders.", validationStatus: "Not Validated" },
  { id: "sr.code", resource: "ServiceRequest", sourcePath: "ServiceRequest.code.coding[system=cpt].code", internalTarget: "service_requests.cptCode", required: true, notes: "Routes via ServiceRequest Routing rules.", validationStatus: "Not Validated" },
  { id: "sr.requester", resource: "ServiceRequest", sourcePath: "ServiceRequest.requester.reference", internalTarget: "service_requests.requesterPractitionerId", required: true, notes: "Resolves via Provider Mapping.", validationStatus: "Not Validated" },

  // Practitioner
  { id: "practitioner.npi", resource: "Practitioner", sourcePath: "Practitioner.identifier[system=npi].value", internalTarget: "users.npi", required: true, notes: "", validationStatus: "Not Validated" },
  { id: "practitioner.name", resource: "Practitioner", sourcePath: "Practitioner.name[use=official].text", internalTarget: "users.displayName", required: true, notes: "", validationStatus: "Not Validated" },

  // Device
  { id: "device.deviceName", resource: "Device", sourcePath: "Device.deviceName[type=user-friendly-name].name", internalTarget: "device_catalog.displayName", required: false, notes: "", validationStatus: "Not Validated" },

  // MedicationAdministration
  { id: "medadm.code", resource: "MedicationAdministration", sourcePath: "MedicationAdministration.medicationCodeableConcept.coding[system=rxnorm].code", internalTarget: "medication_administrations.code", required: true, notes: "", validationStatus: "Not Validated" },
  { id: "medadm.effective", resource: "MedicationAdministration", sourcePath: "MedicationAdministration.effectiveDateTime", internalTarget: "medication_administrations.administeredAt", required: true, notes: "", validationStatus: "Not Validated" },

  // Specimen
  { id: "specimen.type", resource: "Specimen", sourcePath: "Specimen.type.coding[system=snomed].code", internalTarget: "specimen_catalog.typeCode", required: true, notes: "", validationStatus: "Not Validated" },
  { id: "specimen.collected", resource: "Specimen", sourcePath: "Specimen.collection.collectedDateTime", internalTarget: "specimen_catalog.collectedAt", required: true, notes: "", validationStatus: "Not Validated" },
];

export function getFieldMappingsForResource(
  resource: FieldMapping["resource"],
): FieldMapping[] {
  return ECW_FIELD_MAPPINGS.filter((m) => m.resource === resource);
}
