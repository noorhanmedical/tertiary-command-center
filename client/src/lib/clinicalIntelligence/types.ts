// Clinical Intelligence & Governance — prototype knowledge-layer model.
//
// This is the shared, typed data model behind both:
//   - the "AI Logic for This Patient" drawer inside Admin Review, and
//   - the Clinical Intelligence & Governance tile/page (system AI brain).
//
// Persistence is localStorage-only by design (prototype). Nothing here
// changes the analysis engine's behavior; rules and learning items are
// governance artifacts pending human approval.

export type CiRuleScope =
  | "patient_only"
  | "clinic_draft"
  | "provider_draft"
  | "global_draft";

export const CI_SCOPE_LABELS: Record<CiRuleScope, string> = {
  patient_only: "Patient only",
  clinic_draft: "Clinic draft",
  provider_draft: "Provider draft",
  global_draft: "Global draft",
};

export type CiAncillaryTarget =
  | "brainwave"
  | "vitalwave"
  | "ultrasound"
  | "multiple"
  | "general_documentation";

export const CI_ANCILLARY_LABELS: Record<CiAncillaryTarget, string> = {
  brainwave: "BrainWave",
  vitalwave: "VitalWave",
  ultrasound: "Ultrasound",
  multiple: "Multiple ancillaries",
  general_documentation: "General documentation logic",
};

export type CiOutputArea =
  | "diagnosis_mapping"
  | "ancillary_assignment"
  | "medical_necessity"
  | "order_note"
  | "audit_support"
  | "evidence_traceability";

export const CI_OUTPUT_LABELS: Record<CiOutputArea, string> = {
  diagnosis_mapping: "Diagnosis mapping",
  ancillary_assignment: "Ancillary assignment",
  medical_necessity: "Medical necessity",
  order_note: "Order note",
  audit_support: "Audit support",
  evidence_traceability: "Evidence traceability",
};

export type CiSourceType =
  | "HX"
  | "DX"
  | "RX"
  | "Rule Engine"
  | "AI ICD Search"
  | "Prior Test"
  | "Future EMR Note"
  | "Future Lab"
  | "Future Imaging";

export type CiConfidence = "high" | "medium" | "low";

export type CiLearningStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "rejected"
  | "disabled"
  | "converted";

export const CI_LEARNING_STATUS_LABELS: Record<CiLearningStatus, string> = {
  draft: "Draft",
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  disabled: "Disabled",
  converted: "Converted to rule",
};

export type CiRuleStatus =
  | "draft"
  | "pending_physician_review"
  | "pending_compliance_review"
  | "active"
  | "inactive"
  | "retired";

export const CI_RULE_STATUS_LABELS: Record<CiRuleStatus, string> = {
  draft: "Draft",
  pending_physician_review: "Pending physician review",
  pending_compliance_review: "Pending compliance review",
  active: "Active",
  inactive: "Inactive",
  retired: "Retired",
};

// A clinical evidence item the admin approved (or rejected) during a
// patient review. This is the traceability record: source → approval →
// downstream documentation.
export type CiEvidenceRecord = {
  id: string;
  patientId: number | null;
  patientName: string;
  facility?: string | null;
  scheduleDate?: string | null;
  sourceType: CiSourceType;
  sourceText: string;
  label: string;
  confidence: CiConfidence;
  assignedAncillary?: string | null;
  status: "approved" | "rejected";
  decidedBy: string;
  at: string;
  usedInRuleIds: string[];
};

// A learning item submitted from Admin Review ("teach the AI ...").
export type CiLearningItem = {
  id: string;
  instruction: string;
  ruleName?: string;
  triggerSource?: string;
  scope: CiRuleScope;
  affectedAncillary: CiAncillaryTarget;
  affectedOutputs: CiOutputArea[];
  evidenceRequirement?: string;
  approvalRequirement?: string;
  status: CiLearningStatus;
  sourcePatientId?: number | null;
  sourcePatientName?: string;
  sourceFacility?: string | null;
  sourceDate?: string | null;
  sourceContext?: {
    hx?: string | null;
    dx?: string | null;
    rx?: string | null;
    qualifyingTests?: string[];
    evidenceLabels?: string[];
    adminNotes?: string | null;
    approvalState?: string | null;
  };
  createdAt: string;
  createdBy: string;
  convertedRuleId?: string | null;
};

export type CiRuleVersion = {
  version: number;
  at: string;
  by: string;
  summary: string;
  status: CiRuleStatus;
};

export type CiRule = {
  id: string;
  name: string;
  description: string;
  triggerSource?: string;
  triggerCondition?: string;
  diagnosisTrigger?: string;
  symptomTrigger?: string;
  medicationTrigger?: string;
  findingTrigger?: string;
  futureLabTrigger?: string;
  futureImagingTrigger?: string;
  futureNoteTrigger?: string;
  targetAncillary: CiAncillaryTarget;
  targetOutputs: CiOutputArea[];
  evidenceRequirement?: string;
  confidenceThreshold?: CiConfidence;
  scope: CiRuleScope;
  approvalRequirement?: string;
  effectiveDate?: string | null;
  status: CiRuleStatus;
  version: number;
  usageCount: number;
  conflictFlags: string[];
  sourceLearningItemId?: string | null;
  sourceEvidence?: string[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  history: CiRuleVersion[];
  seeded?: boolean;
};

export type CiAuditEntry = {
  id: string;
  at: string;
  by: string;
  action: string;
  entityType: "rule" | "learning_item" | "evidence";
  entityId: string;
  entityName: string;
  detail?: string;
};

export type CiStoreState = {
  learningItems: CiLearningItem[];
  rules: CiRule[];
  evidence: CiEvidenceRecord[];
  audit: CiAuditEntry[];
};

export function ciId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Canonical downstream-documentation phrasing (spec wording — do not
// let admins pick clinician vs patient reasoning manually).
export const CI_DOWNSTREAM_LANGUAGE =
  "Approved evidence will be used for downstream documentation, including clinician reasoning, patient explanation, order note support, and audit traceability.";
