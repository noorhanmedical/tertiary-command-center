// Clinical Intelligence & Governance — knowledge-layer model.
//
// This is the shared, typed data model behind both:
//   - the "AI Logic for This Patient" drawer inside Admin Review, and
//   - the Clinical Intelligence & Governance tile/page (system AI brain).
//
// The entity types now live in `@shared/schema/clinicalIntelligence` (the
// same shapes the PostgreSQL-backed API serves) and are re-exported here so
// existing imports keep working. This file keeps the client-only display
// label maps and canonical phrasing. Nothing here changes the analysis
// engine's behavior; rules and learning items are governance artifacts
// pending human approval.

export {
  type CiRuleScope,
  type CiAncillaryTarget,
  type CiOutputArea,
  type CiSourceType,
  type CiConfidence,
  type CiLearningStatus,
  type CiRuleStatus,
  type CiEvidenceRecord,
  type CiLearningItem,
  type CiRuleVersion,
  type CiRule,
  type CiAuditEntry,
  type CiStoreState,
} from "@shared/schema/clinicalIntelligence";

import type {
  CiRuleScope,
  CiAncillaryTarget,
  CiOutputArea,
  CiLearningStatus,
  CiRuleStatus,
} from "@shared/schema/clinicalIntelligence";

export const CI_SCOPE_LABELS: Record<CiRuleScope, string> = {
  patient_only: "Patient only",
  clinic_draft: "Clinic draft",
  provider_draft: "Provider draft",
  global_draft: "Global draft",
};

export const CI_ANCILLARY_LABELS: Record<CiAncillaryTarget, string> = {
  brainwave: "BrainWave",
  vitalwave: "VitalWave",
  ultrasound: "Ultrasound",
  multiple: "Multiple ancillaries",
  general_documentation: "General documentation logic",
};

export const CI_OUTPUT_LABELS: Record<CiOutputArea, string> = {
  diagnosis_mapping: "Diagnosis mapping",
  ancillary_assignment: "Ancillary assignment",
  medical_necessity: "Medical necessity",
  order_note: "Order note",
  audit_support: "Audit support",
  evidence_traceability: "Evidence traceability",
};

export const CI_LEARNING_STATUS_LABELS: Record<CiLearningStatus, string> = {
  draft: "Draft",
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  disabled: "Disabled",
  converted: "Converted to rule",
};

export const CI_RULE_STATUS_LABELS: Record<CiRuleStatus, string> = {
  draft: "Draft",
  pending_physician_review: "Pending physician review",
  pending_compliance_review: "Pending compliance review",
  active: "Active",
  inactive: "Inactive",
  retired: "Retired",
};

export function ciId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Canonical downstream-documentation phrasing (spec wording — do not
// let admins pick clinician vs patient reasoning manually).
export const CI_DOWNSTREAM_LANGUAGE =
  "Approved evidence will be used for downstream documentation, including clinician reasoning, patient explanation, order note support, and audit traceability.";
