// clinicalIntelligence — Clinical Intelligence & Governance knowledge layer.
//
// Server-backed replacement for the localStorage prototype store
// (`plexusIq.clinicalIntelligence.v1`). Learning items, governance rules
// (+ version history), evidence decisions, and audit entries now live in
// PostgreSQL so knowledge survives across devices and team members.
//
// Entity ids are text (`learn_…`, `rule_…`, `ev_…`, `aud_…`) — generated
// server-side for new writes, but client-generated legacy ids are accepted
// verbatim by the one-time localStorage import so traceability links
// (convertedRuleId, usedInRuleIds, audit entityId) stay intact.
//
// Timestamps are stored as ISO-8601 text to match the client-side entity
// shapes exactly (the UI renders these strings directly).

import { pgTable, text, integer, jsonb, boolean, serial, index, uniqueIndex, z } from "./_common";

// ───── Core enums (shared source of truth for client + server) ──────────

export const CI_RULE_SCOPES = ["patient_only", "clinic_draft", "provider_draft", "global_draft"] as const;
export type CiRuleScope = (typeof CI_RULE_SCOPES)[number];

export const CI_ANCILLARY_TARGETS = ["brainwave", "vitalwave", "ultrasound", "multiple", "general_documentation"] as const;
export type CiAncillaryTarget = (typeof CI_ANCILLARY_TARGETS)[number];

export const CI_OUTPUT_AREAS = [
  "diagnosis_mapping",
  "ancillary_assignment",
  "medical_necessity",
  "order_note",
  "audit_support",
  "evidence_traceability",
] as const;
export type CiOutputArea = (typeof CI_OUTPUT_AREAS)[number];

export const CI_SOURCE_TYPES = [
  "HX",
  "DX",
  "RX",
  "Rule Engine",
  "AI ICD Search",
  "Prior Test",
  "Future EMR Note",
  "Future Lab",
  "Future Imaging",
] as const;
export type CiSourceType = (typeof CI_SOURCE_TYPES)[number];

export const CI_CONFIDENCES = ["high", "medium", "low"] as const;
export type CiConfidence = (typeof CI_CONFIDENCES)[number];

export const CI_LEARNING_STATUSES = ["draft", "pending_review", "approved", "rejected", "disabled", "converted"] as const;
export type CiLearningStatus = (typeof CI_LEARNING_STATUSES)[number];

export const CI_RULE_STATUSES = [
  "draft",
  "pending_physician_review",
  "pending_compliance_review",
  "active",
  "inactive",
  "retired",
] as const;
export type CiRuleStatus = (typeof CI_RULE_STATUSES)[number];

// ───── Entity shapes (what the API returns / the UI consumes) ───────────

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

export type CiLearningSourceContext = {
  hx?: string | null;
  dx?: string | null;
  rx?: string | null;
  qualifyingTests?: string[];
  evidenceLabels?: string[];
  adminNotes?: string | null;
  approvalState?: string | null;
};

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
  sourceContext?: CiLearningSourceContext;
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

// ───── Tables ────────────────────────────────────────────────────────────

export const ciLearningItems = pgTable("ci_learning_items", {
  id: text("id").primaryKey(),
  instruction: text("instruction").notNull(),
  ruleName: text("rule_name"),
  triggerSource: text("trigger_source"),
  scope: text("scope").$type<CiRuleScope>().notNull(),
  affectedAncillary: text("affected_ancillary").$type<CiAncillaryTarget>().notNull(),
  affectedOutputs: jsonb("affected_outputs").$type<CiOutputArea[]>().notNull().default([]),
  evidenceRequirement: text("evidence_requirement"),
  approvalRequirement: text("approval_requirement"),
  status: text("status").$type<CiLearningStatus>().notNull(),
  sourcePatientId: integer("source_patient_id"),
  sourcePatientName: text("source_patient_name"),
  sourceFacility: text("source_facility"),
  sourceDate: text("source_date"),
  sourceContext: jsonb("source_context").$type<CiLearningSourceContext | null>(),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull(),
  convertedRuleId: text("converted_rule_id"),
}, (t) => [
  index("idx_ci_learning_items_status").on(t.status),
  index("idx_ci_learning_items_created_at").on(t.createdAt),
]);

export const ciRules = pgTable("ci_rules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  triggerSource: text("trigger_source"),
  triggerCondition: text("trigger_condition"),
  diagnosisTrigger: text("diagnosis_trigger"),
  symptomTrigger: text("symptom_trigger"),
  medicationTrigger: text("medication_trigger"),
  findingTrigger: text("finding_trigger"),
  futureLabTrigger: text("future_lab_trigger"),
  futureImagingTrigger: text("future_imaging_trigger"),
  futureNoteTrigger: text("future_note_trigger"),
  targetAncillary: text("target_ancillary").$type<CiAncillaryTarget>().notNull(),
  targetOutputs: jsonb("target_outputs").$type<CiOutputArea[]>().notNull().default([]),
  evidenceRequirement: text("evidence_requirement"),
  confidenceThreshold: text("confidence_threshold").$type<CiConfidence>(),
  scope: text("scope").$type<CiRuleScope>().notNull(),
  approvalRequirement: text("approval_requirement"),
  effectiveDate: text("effective_date"),
  status: text("status").$type<CiRuleStatus>().notNull(),
  version: integer("version").notNull().default(1),
  usageCount: integer("usage_count").notNull().default(0),
  conflictFlags: jsonb("conflict_flags").$type<string[]>().notNull().default([]),
  sourceLearningItemId: text("source_learning_item_id"),
  sourceEvidence: jsonb("source_evidence").$type<string[]>(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdBy: text("created_by").notNull(),
  seeded: boolean("seeded").notNull().default(false),
}, (t) => [
  index("idx_ci_rules_status").on(t.status),
  index("idx_ci_rules_created_at").on(t.createdAt),
]);

export const ciRuleVersions = pgTable("ci_rule_versions", {
  id: serial("id").primaryKey(),
  ruleId: text("rule_id").notNull(),
  version: integer("version").notNull(),
  at: text("at").notNull(),
  by: text("by").notNull(),
  summary: text("summary").notNull(),
  status: text("status").$type<CiRuleStatus>().notNull(),
}, (t) => [
  uniqueIndex("uq_ci_rule_versions_rule_version").on(t.ruleId, t.version),
]);

export const ciEvidenceRecords = pgTable("ci_evidence_records", {
  id: text("id").primaryKey(),
  patientId: integer("patient_id"),
  patientName: text("patient_name").notNull(),
  facility: text("facility"),
  scheduleDate: text("schedule_date"),
  sourceType: text("source_type").$type<CiSourceType>().notNull(),
  sourceText: text("source_text").notNull(),
  label: text("label").notNull(),
  confidence: text("confidence").$type<CiConfidence>().notNull(),
  assignedAncillary: text("assigned_ancillary"),
  status: text("status").$type<"approved" | "rejected">().notNull(),
  decidedBy: text("decided_by").notNull(),
  at: text("at").notNull(),
  usedInRuleIds: jsonb("used_in_rule_ids").$type<string[]>().notNull().default([]),
}, (t) => [
  index("idx_ci_evidence_patient_id").on(t.patientId),
  index("idx_ci_evidence_at").on(t.at),
]);

export const ciAuditEntries = pgTable("ci_audit_entries", {
  id: text("id").primaryKey(),
  at: text("at").notNull(),
  by: text("by").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").$type<"rule" | "learning_item" | "evidence">().notNull(),
  entityId: text("entity_id").notNull(),
  entityName: text("entity_name").notNull(),
  detail: text("detail"),
}, (t) => [
  index("idx_ci_audit_entries_at").on(t.at),
]);

// ───── Zod input schemas (API request validation) ────────────────────────

const zScope = z.enum(CI_RULE_SCOPES);
const zAncillary = z.enum(CI_ANCILLARY_TARGETS);
const zOutputs = z.array(z.enum(CI_OUTPUT_AREAS));
const zSourceType = z.enum(CI_SOURCE_TYPES);
const zConfidence = z.enum(CI_CONFIDENCES);
const zLearningStatus = z.enum(CI_LEARNING_STATUSES);
const zRuleStatus = z.enum(CI_RULE_STATUSES);

export const ciLearningSourceContextSchema = z.object({
  hx: z.string().nullish(),
  dx: z.string().nullish(),
  rx: z.string().nullish(),
  qualifyingTests: z.array(z.string()).optional(),
  evidenceLabels: z.array(z.string()).optional(),
  adminNotes: z.string().nullish(),
  approvalState: z.string().nullish(),
});

export const ciCreateLearningItemSchema = z.object({
  instruction: z.string().min(1),
  ruleName: z.string().optional(),
  triggerSource: z.string().optional(),
  scope: zScope,
  affectedAncillary: zAncillary,
  affectedOutputs: zOutputs,
  evidenceRequirement: z.string().optional(),
  approvalRequirement: z.string().optional(),
  status: zLearningStatus,
  sourcePatientId: z.number().nullish(),
  sourcePatientName: z.string().optional(),
  sourceFacility: z.string().nullish(),
  sourceDate: z.string().nullish(),
  sourceContext: ciLearningSourceContextSchema.optional(),
  createdBy: z.string().min(1),
  convertedRuleId: z.string().nullish(),
});
export type CiCreateLearningItemInput = z.infer<typeof ciCreateLearningItemSchema>;

export const ciUpdateLearningItemSchema = z.object({
  by: z.string().min(1),
  patch: ciCreateLearningItemSchema.partial(),
});

export const ciLearningStatusSchema = z.object({
  by: z.string().min(1),
  status: zLearningStatus,
});

export const ciCreateRuleSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  triggerSource: z.string().optional(),
  triggerCondition: z.string().optional(),
  diagnosisTrigger: z.string().optional(),
  symptomTrigger: z.string().optional(),
  medicationTrigger: z.string().optional(),
  findingTrigger: z.string().optional(),
  futureLabTrigger: z.string().optional(),
  futureImagingTrigger: z.string().optional(),
  futureNoteTrigger: z.string().optional(),
  targetAncillary: zAncillary,
  targetOutputs: zOutputs,
  evidenceRequirement: z.string().optional(),
  confidenceThreshold: zConfidence.optional(),
  scope: zScope,
  approvalRequirement: z.string().optional(),
  effectiveDate: z.string().nullish(),
  status: zRuleStatus,
  conflictFlags: z.array(z.string()).optional(),
  sourceLearningItemId: z.string().nullish(),
  sourceEvidence: z.array(z.string()).optional(),
  createdBy: z.string().min(1),
});
export type CiCreateRuleInput = z.infer<typeof ciCreateRuleSchema>;

export const ciUpdateRuleSchema = z.object({
  by: z.string().min(1),
  patch: ciCreateRuleSchema.partial(),
  changeSummary: z.string().optional(),
});

export const ciConvertLearningSchema = z.object({
  by: z.string().min(1),
  overrides: ciCreateRuleSchema.partial().optional(),
});

export const ciRecordEvidenceSchema = z.object({
  patientId: z.number().nullable(),
  patientName: z.string().min(1),
  facility: z.string().nullish(),
  scheduleDate: z.string().nullish(),
  sourceType: zSourceType,
  sourceText: z.string(),
  label: z.string().min(1),
  confidence: zConfidence,
  assignedAncillary: z.string().nullish(),
  status: z.enum(["approved", "rejected"]),
  decidedBy: z.string().min(1),
});
export type CiRecordEvidenceInput = z.infer<typeof ciRecordEvidenceSchema>;

export const ciMarkEvidenceUsedSchema = z.object({
  ruleId: z.string().min(1),
});

// One-time localStorage import payload — lenient by design (legacy data
// shapes come straight from browsers). Items without a string id are
// dropped server-side; unknown fields are ignored.
export const ciImportSchema = z.object({
  learningItems: z.array(z.record(z.unknown())).max(2000).optional(),
  rules: z.array(z.record(z.unknown())).max(2000).optional(),
  evidence: z.array(z.record(z.unknown())).max(5000).optional(),
  audit: z.array(z.record(z.unknown())).max(10000).optional(),
});
export type CiImportPayload = z.infer<typeof ciImportSchema>;
