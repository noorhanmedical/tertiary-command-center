// eClinicalWorks FHIR R4 — the 18 read scopes Phase 1 represents.
//
// This is the source-of-truth list the Integration Station renders.
// Each entry pairs the scope string with its FHIR resource, the
// downstream modules it feeds, the internal table(s) Phase 2 will
// populate, and dependencies on other resources.
//
// REFERENCE: see docs/architecture/ecw-fhir-r4-integration-foundation.md
// for the full data-flow diagram and Phase 2 backend schema plan.

import type {
  DownstreamModule,
  EcwResourceType,
  EcwScopeDefinition,
  EcwScopeString,
} from "./ecwTypes";

export const ECW_RESOURCES: EcwResourceType[] = [
  "Patient",
  "Encounter",
  "Condition",
  "MedicationRequest",
  "Medication",
  "Observation",
  "DiagnosticReport",
  "DocumentReference",
  "Binary",
  "Procedure",
  "AllergyIntolerance",
  "Coverage",
  "Immunization",
  "ServiceRequest",
  "Practitioner",
  "Device",
  "MedicationAdministration",
  "Specimen",
];

export const scopeFor = (resource: EcwResourceType): EcwScopeString =>
  `system/${resource}.read`;

export const ECW_SCOPE_DEFINITIONS: EcwScopeDefinition[] = [
  {
    scope: "system/Patient.read",
    resource: "Patient",
    description:
      "Demographics, identifiers (MRN, member IDs), name, DOB, contact, address. Foundation for every downstream resource — Patient must sync before anything else is meaningful.",
    destinationModules: [
      "Patient Directory",
      "Plexus IQ",
      "Engagement Center",
      "Patient Journey Timeline",
    ],
    internalTables: ["patient_screenings", "patient_directory_records"],
    dependsOn: [],
    requiredForGoLive: true,
  },
  {
    scope: "system/Encounter.read",
    resource: "Encounter",
    description:
      "Patient visits + appointments that have actually been scheduled in eCW. Used to reconcile our scheduling pipeline with EMR-of-record and to drive history-aware qualification.",
    destinationModules: [
      "Scheduling",
      "Patient Journey Timeline",
      "Plexus IQ",
      "Engagement Center",
    ],
    internalTables: ["global_schedule_events", "patient_journey_events"],
    dependsOn: ["Patient", "Practitioner"],
    requiredForGoLive: true,
  },
  {
    scope: "system/Condition.read",
    resource: "Condition",
    description:
      "Problem list + diagnoses (ICD-10). Direct input to Plexus IQ qualification evidence.",
    destinationModules: ["Plexus IQ", "Patient Directory"],
    internalTables: ["patient_screenings.diagnoses", "patient_journey_events"],
    dependsOn: ["Patient"],
    requiredForGoLive: true,
  },
  {
    scope: "system/MedicationRequest.read",
    resource: "MedicationRequest",
    description:
      "Active prescriptions / Rx orders. Combined with `Medication` for drug-class signals in qualification and analytics.",
    destinationModules: ["Plexus IQ", "Patient Directory"],
    internalTables: ["patient_screenings.medications"],
    dependsOn: ["Patient", "Medication", "Practitioner"],
    requiredForGoLive: true,
  },
  {
    scope: "system/Medication.read",
    resource: "Medication",
    description:
      "Coded medication catalog (RxNorm). Joins to MedicationRequest to give drug class + ancillary relevance.",
    destinationModules: ["Plexus IQ"],
    internalTables: ["medication_catalog"],
    dependsOn: [],
    requiredForGoLive: false,
  },
  {
    scope: "system/Observation.read",
    resource: "Observation",
    description:
      "Vitals, labs, exam findings, symptom panels. Filtered by category — qualifying observations land in screening history; report-shaped observations are routed to Ancillary Documents.",
    destinationModules: ["Plexus IQ", "Ancillary Documents", "Patient Directory"],
    internalTables: ["patient_screenings.history", "ancillary_observations"],
    dependsOn: ["Patient", "Encounter"],
    requiredForGoLive: true,
  },
  {
    scope: "system/DiagnosticReport.read",
    resource: "DiagnosticReport",
    description:
      "Imaging + lab + study reports. Pairs with Binary for the actual report content; routes into Ancillary Documents and Billing Readiness packets.",
    destinationModules: ["Ancillary Documents", "Billing Readiness", "Patient Journey Timeline"],
    internalTables: ["case_document_readiness", "ancillary_documents"],
    dependsOn: ["Patient", "Encounter", "Binary"],
    requiredForGoLive: true,
  },
  {
    scope: "system/DocumentReference.read",
    resource: "DocumentReference",
    description:
      "Chart documents — consents, intake forms, signed packets, CCDs. Pairs with Binary for content. Loaded into Document Library + per-case Ancillary Documents.",
    destinationModules: ["Document Library", "Ancillary Documents"],
    internalTables: ["documents", "document_surface_assignments"],
    dependsOn: ["Patient", "Binary"],
    requiredForGoLive: true,
  },
  {
    scope: "system/Binary.read",
    resource: "Binary",
    description:
      "Raw byte payload for DocumentReference + DiagnosticReport content (PDF/CCD/JPG/etc.). Phase 1 does NOT decode CCDs — that's Phase 2+. Phase 1 only catalogs presence.",
    destinationModules: ["Document Library", "Ancillary Documents"],
    internalTables: ["document_blobs"],
    dependsOn: [],
    requiredForGoLive: true,
  },
  {
    scope: "system/Procedure.read",
    resource: "Procedure",
    description:
      "Performed procedures (CPT-coded). Joins with DiagnosticReport on encounter; drives Billing Readiness and history-aware qualification.",
    destinationModules: ["Billing Readiness", "Plexus IQ", "Patient Journey Timeline"],
    internalTables: ["procedure_events"],
    dependsOn: ["Patient", "Encounter"],
    requiredForGoLive: true,
  },
  {
    scope: "system/AllergyIntolerance.read",
    resource: "AllergyIntolerance",
    description:
      "Allergy list. Surfaced in Patient Directory + clinical packet, gates contrast / PGX flows.",
    destinationModules: ["Patient Directory", "Plexus IQ"],
    internalTables: ["patient_allergies"],
    dependsOn: ["Patient"],
    requiredForGoLive: false,
  },
  {
    scope: "system/Coverage.read",
    resource: "Coverage",
    description:
      "Insurance plans + payor info. Directly drives payor-mix analytics, cooldown rules (Medicare 12 mo / PPO 6 mo), and billing readiness.",
    destinationModules: ["Billing Readiness", "Plexus IQ", "Patient Directory"],
    internalTables: ["insurance_eligibility_review", "cooldown_records"],
    dependsOn: ["Patient"],
    requiredForGoLive: true,
  },
  {
    scope: "system/Immunization.read",
    resource: "Immunization",
    description:
      "Vaccination history. Lower-priority for ancillary qualification; useful for completeness on Patient Journey + chronic disease management context.",
    destinationModules: ["Patient Directory", "Patient Journey Timeline"],
    internalTables: ["patient_immunizations"],
    dependsOn: ["Patient"],
    requiredForGoLive: false,
  },
  {
    scope: "system/ServiceRequest.read",
    resource: "ServiceRequest",
    description:
      "Orders / referrals / tests NEEDING execution. Distinct from Encounter (which is the scheduled visit). ServiceRequest is the trigger to put a patient into the Plexus IQ queue or Imaging Central work queue.",
    destinationModules: ["Plexus IQ", "Imaging Central", "Engagement Center"],
    internalTables: ["service_requests", "patient_execution_cases"],
    dependsOn: ["Patient", "Practitioner"],
    requiredForGoLive: true,
  },
  {
    scope: "system/Practitioner.read",
    resource: "Practitioner",
    description:
      "Provider roster + NPI. Used to map eCW providers to our user accounts so encounters, orders, and signing routes correctly.",
    destinationModules: ["Team Ops", "Scheduling"],
    internalTables: ["users", "outreach_schedulers"],
    dependsOn: [],
    requiredForGoLive: true,
  },
  {
    scope: "system/Device.read",
    resource: "Device",
    description:
      "Devices referenced in observations / reports (e.g., monitor IDs). Phase 1 catalogs only; Phase 2+ may use for QC.",
    destinationModules: ["Ancillary Documents"],
    internalTables: ["device_catalog"],
    dependsOn: [],
    requiredForGoLive: false,
  },
  {
    scope: "system/MedicationAdministration.read",
    resource: "MedicationAdministration",
    description:
      "In-clinic medication events. Complements MedicationRequest for context-aware qualification (e.g., recently administered vs. prescribed).",
    destinationModules: ["Plexus IQ", "Patient Directory"],
    internalTables: ["medication_administrations"],
    dependsOn: ["Patient", "Medication"],
    requiredForGoLive: false,
  },
  {
    scope: "system/Specimen.read",
    resource: "Specimen",
    description:
      "Collected lab specimens. Phase 1 catalogs only; useful for chain-of-custody when lab integrations land.",
    destinationModules: ["Ancillary Documents"],
    internalTables: ["specimen_catalog"],
    dependsOn: ["Patient"],
    requiredForGoLive: false,
  },
];

// Convenience helpers for the UI.
export const ECW_SCOPE_STRINGS: EcwScopeString[] = ECW_SCOPE_DEFINITIONS.map(
  (s) => s.scope,
);

export function getScopeDefinition(
  resource: EcwResourceType,
): EcwScopeDefinition | undefined {
  return ECW_SCOPE_DEFINITIONS.find((s) => s.resource === resource);
}

export const ECW_GO_LIVE_SCOPES = ECW_SCOPE_DEFINITIONS.filter(
  (s) => s.requiredForGoLive,
);

export const ALL_DESTINATION_MODULES: DownstreamModule[] = [
  "Patient Directory",
  "Scheduling",
  "Engagement Center",
  "Plexus IQ",
  "Imaging Central",
  "Ancillary Documents",
  "Billing Readiness",
  "Document Library",
  "Patient Journey Timeline",
  "Mission Control",
  "Team Ops",
];
