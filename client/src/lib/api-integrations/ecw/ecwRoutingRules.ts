// eClinicalWorks FHIR R4 — downstream routing defaults.
//
// PHASE 1 SCOPE: these defaults seed the Routing UI surfaces. The
// real routing engine runs server-side in Phase 2 — the data below
// is exported so the UI can render the configured behavior without
// inventing it on the fly.
//
// The four routing tables here:
//   1. ServiceRequest routing  — order → execution queue
//   2. Ancillary routing       — eligible test → execution module
//   3. Document routing        — DocumentReference type → destination
//   4. Patient-match rules     — identity scoring inputs

import type {
  AncillaryOrderRoutingRule,
  AncillaryType,
  BillingReadinessChecklistItem,
  DocumentRoutingRule,
  PatientMatchRule,
  ServiceRequestRoutingRule,
} from "./ecwTypes";

// ─────────────────────────────────────────────────────────────────────────
// ServiceRequest routing — Encounter vs ServiceRequest semantics:
//   - Encounter = a real scheduled patient visit; do NOT treat as an
//     execution-pending order. Encounter rows reconcile with our
//     scheduling pipeline; they do not put a patient back in the queue.
//   - ServiceRequest = an EMR order or referral that needs execution
//     (e.g., "order BrainWave panel"). ServiceRequest rows route into
//     Plexus IQ qualification or Imaging Central depending on type.
// ─────────────────────────────────────────────────────────────────────────

export const SERVICE_REQUEST_ROUTING_DEFAULTS: ServiceRequestRoutingRule[] = [
  { id: "sr-1", matchType: "Display Text Contains", matchValue: "BrainWave", routesTo: "Plexus IQ qualification queue", enabled: true, notes: "Send to Plexus IQ for qualification review." },
  { id: "sr-2", matchType: "Display Text Contains", matchValue: "VitalWave", routesTo: "Plexus IQ qualification queue", enabled: true, notes: "" },
  { id: "sr-3", matchType: "Display Text Contains", matchValue: "Carotid Duplex", routesTo: "Imaging Central work queue", enabled: true, notes: "Ultrasound-only execution surface." },
  { id: "sr-4", matchType: "Display Text Contains", matchValue: "Echocardiogram", routesTo: "Imaging Central work queue", enabled: true, notes: "Echo TTE study." },
  { id: "sr-5", matchType: "Display Text Contains", matchValue: "Renal Artery Doppler", routesTo: "Imaging Central work queue", enabled: true, notes: "" },
  { id: "sr-6", matchType: "Display Text Contains", matchValue: "AAA Duplex", routesTo: "Imaging Central work queue", enabled: true, notes: "" },
  { id: "sr-7", matchType: "Display Text Contains", matchValue: "LE Venous Duplex", routesTo: "Imaging Central work queue", enabled: true, notes: "" },
  { id: "sr-8", matchType: "Display Text Contains", matchValue: "LE Arterial Doppler", routesTo: "Imaging Central work queue", enabled: true, notes: "" },
  { id: "sr-9", matchType: "CPT", matchValue: "93000", routesTo: "Manual triage", enabled: true, notes: "EKG — not Imaging Central. Manual triage until EKG module is wired." },
  { id: "sr-10", matchType: "CPT", matchValue: "81225", routesTo: "Manual triage", enabled: true, notes: "PGX — not Imaging Central. Manual triage until PGX module is wired." },
  { id: "sr-11", matchType: "Category Code", matchValue: "imaging", routesTo: "Manual triage", enabled: true, notes: "Catch-all for imaging that doesn't match an Imaging Central study type." },
];

// ─────────────────────────────────────────────────────────────────────────
// Ancillary routing — once a ServiceRequest is qualified, where does it
// physically execute?
//
// Imaging Central is ULTRASOUND-ONLY. BrainWave / VitalWave / EKG / PGX /
// CGX go to their own modules (or Manual triage if those aren't wired).
// ─────────────────────────────────────────────────────────────────────────

export const ANCILLARY_ROUTING_DEFAULTS: AncillaryOrderRoutingRule[] = [
  { id: "anc-1", ancillary: "Ultrasound", destination: "Imaging Central", enabled: true, imagingCentralUltrasoundOnly: true, notes: "Carotid Duplex, Echo TTE, Renal Doppler, AAA, LE Venous/Arterial." },
  { id: "anc-2", ancillary: "BrainWave", destination: "Ancillary Documents", enabled: true, imagingCentralUltrasoundOnly: true, notes: "BrainWave studies are NOT imaging — keep out of Imaging Central." },
  { id: "anc-3", ancillary: "VitalWave", destination: "Ancillary Documents", enabled: true, imagingCentralUltrasoundOnly: true, notes: "VitalWave studies are NOT imaging — keep out of Imaging Central." },
  { id: "anc-4", ancillary: "EKG", destination: "Ancillary Documents", enabled: true, imagingCentralUltrasoundOnly: true, notes: "Standalone EKG flow; not Imaging Central." },
  { id: "anc-5", ancillary: "PGX", destination: "Ancillary Documents", enabled: true, imagingCentralUltrasoundOnly: true, notes: "Pharmacogenomics — lab pipeline." },
  { id: "anc-6", ancillary: "CGX", destination: "Ancillary Documents", enabled: true, imagingCentralUltrasoundOnly: true, notes: "Cancer genomics — lab pipeline." },
  { id: "anc-7", ancillary: "Lab", destination: "Ancillary Documents", enabled: true, imagingCentralUltrasoundOnly: true, notes: "Generic lab orders." },
  { id: "anc-8", ancillary: "Imaging (Other)", destination: "Ancillary Documents", enabled: false, imagingCentralUltrasoundOnly: true, notes: "Other imaging (X-ray / CT / MRI) — disabled until a dedicated module is wired." },
];

export const ANCILLARY_TYPES: AncillaryType[] = [
  "BrainWave",
  "VitalWave",
  "Ultrasound",
  "EKG",
  "PGX",
  "CGX",
  "Lab",
  "Imaging (Other)",
];

// ─────────────────────────────────────────────────────────────────────────
// Document routing — DocumentReference / DiagnosticReport by LOINC.
// Phase 1 ships a small seed list. Backend completes the mapping by
// pulling from a richer LOINC subset during Phase 2 ingestion.
// ─────────────────────────────────────────────────────────────────────────

export const DOCUMENT_ROUTING_DEFAULTS: DocumentRoutingRule[] = [
  { id: "doc-1", codingSystem: "LOINC", code: "11506-3", displayLabel: "Provider-progress note", routesTo: "Patient Journey Timeline", enabled: true, notes: "" },
  { id: "doc-2", codingSystem: "LOINC", code: "57133-1", displayLabel: "Referral note", routesTo: "Patient Journey Timeline", enabled: true, notes: "" },
  { id: "doc-3", codingSystem: "LOINC", code: "34117-2", displayLabel: "History and physical note", routesTo: "Patient Journey Timeline", enabled: true, notes: "" },
  { id: "doc-4", codingSystem: "LOINC", code: "19005-8", displayLabel: "Ultrasound study", routesTo: "Ancillary Documents inbox", enabled: true, notes: "" },
  { id: "doc-5", codingSystem: "LOINC", code: "18748-4", displayLabel: "Diagnostic imaging report", routesTo: "Ancillary Documents inbox", enabled: true, notes: "" },
  { id: "doc-6", codingSystem: "LOINC", code: "68608-9", displayLabel: "Consent document", routesTo: "Document Library", enabled: true, notes: "Phase 1: catalog only; no e-signature flow yet." },
  { id: "doc-7", codingSystem: "LOINC", code: "11502-2", displayLabel: "Laboratory report", routesTo: "Ancillary Documents inbox", enabled: true, notes: "" },
  { id: "doc-8", codingSystem: "LOINC", code: "55107-7", displayLabel: "Insurance card / coverage doc", routesTo: "Billing Readiness packet", enabled: true, notes: "" },
];

// ─────────────────────────────────────────────────────────────────────────
// Patient identity matching — rule weights sum towards an auto-match
// threshold of 80. Below 80 the candidate goes into manual review.
// ─────────────────────────────────────────────────────────────────────────

export const PATIENT_MATCH_RULES: PatientMatchRule[] = [
  { id: "pm-1", signal: "MRN exact", enabled: true, weight: 60, notes: "Strongest single signal. MRN must come from MR-typed identifier." },
  { id: "pm-2", signal: "Name + DOB exact", enabled: true, weight: 40, notes: "Family + given + DOB exact match." },
  { id: "pm-3", signal: "Name + DOB fuzzy", enabled: true, weight: 25, notes: "Levenshtein ≤ 2 on family + given; DOB must match exactly." },
  { id: "pm-4", signal: "Phone exact", enabled: true, weight: 20, notes: "Normalized E.164. Helpful tiebreaker." },
  { id: "pm-5", signal: "Insurance member ID exact", enabled: true, weight: 30, notes: "Strong signal when MRN is missing." },
];

export const PATIENT_MATCH_AUTO_THRESHOLD = 80;

// ─────────────────────────────────────────────────────────────────────────
// Billing readiness checklist — mapping each requirement to its FHIR
// source. Phase 2 normalization will populate the boolean flags.
// ─────────────────────────────────────────────────────────────────────────

export const BILLING_READINESS_CHECKLIST: BillingReadinessChecklistItem[] = [
  { id: "br-1", label: "Active insurance coverage", sourceResource: "Coverage", sourceField: "Coverage.status='active'", internalReadinessFlag: "billing_readiness_checks.coverageActive", required: true, notes: "" },
  { id: "br-2", label: "Performed procedure with CPT", sourceResource: "Procedure", sourceField: "Procedure.code.coding[system=cpt].code", internalReadinessFlag: "billing_readiness_checks.procedureCpt", required: true, notes: "" },
  { id: "br-3", label: "Diagnostic report on file", sourceResource: "DiagnosticReport", sourceField: "DiagnosticReport.presentedForm[0].url", internalReadinessFlag: "billing_readiness_checks.reportOnFile", required: true, notes: "" },
  { id: "br-4", label: "Signed clinician note", sourceResource: "DocumentReference", sourceField: "DocumentReference.context.event=signed", internalReadinessFlag: "billing_readiness_checks.signedNote", required: true, notes: "Phase 2 may require physician_signing service to fire." },
  { id: "br-5", label: "Order of record (ServiceRequest)", sourceResource: "ServiceRequest", sourceField: "ServiceRequest.intent='order'&status='active|completed'", internalReadinessFlag: "billing_readiness_checks.orderOfRecord", required: true, notes: "" },
  { id: "br-6", label: "Linked encounter", sourceResource: "Encounter", sourceField: "Encounter.id", internalReadinessFlag: "billing_readiness_checks.encounterLinked", required: true, notes: "" },
  { id: "br-7", label: "Allergy review", sourceResource: "AllergyIntolerance", sourceField: "AllergyIntolerance — review timestamp", internalReadinessFlag: "billing_readiness_checks.allergiesReviewed", required: false, notes: "" },
];
