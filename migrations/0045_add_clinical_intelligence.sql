-- Clinical Intelligence & Governance knowledge layer (task #667).
-- Server-backed replacement for the browser localStorage prototype store
-- (`plexusIq.clinicalIntelligence.v1`) so AI Logic knowledge survives across
-- devices and team members. See shared/schema/clinicalIntelligence.ts for
-- the typed mirror.
--
-- Ids are text (`learn_…`, `rule_…`, `ev_…`, `aud_…`) — generated server-side
-- for new writes; legacy client-generated ids are preserved by the one-time
-- localStorage import. Timestamps are ISO-8601 text to match the entity
-- shapes the UI renders directly.

CREATE TABLE IF NOT EXISTS "ci_learning_items" (
  "id" text PRIMARY KEY,
  "instruction" text NOT NULL,
  "rule_name" text,
  "trigger_source" text,
  "scope" text NOT NULL,
  "affected_ancillary" text NOT NULL,
  "affected_outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "evidence_requirement" text,
  "approval_requirement" text,
  "status" text NOT NULL,
  "source_patient_id" integer,
  "source_patient_name" text,
  "source_facility" text,
  "source_date" text,
  "source_context" jsonb,
  "created_at" text NOT NULL,
  "created_by" text NOT NULL,
  "converted_rule_id" text
);

CREATE INDEX IF NOT EXISTS "idx_ci_learning_items_status" ON "ci_learning_items" ("status");
CREATE INDEX IF NOT EXISTS "idx_ci_learning_items_created_at" ON "ci_learning_items" ("created_at");

CREATE TABLE IF NOT EXISTS "ci_rules" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "description" text NOT NULL,
  "trigger_source" text,
  "trigger_condition" text,
  "diagnosis_trigger" text,
  "symptom_trigger" text,
  "medication_trigger" text,
  "finding_trigger" text,
  "future_lab_trigger" text,
  "future_imaging_trigger" text,
  "future_note_trigger" text,
  "target_ancillary" text NOT NULL,
  "target_outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "evidence_requirement" text,
  "confidence_threshold" text,
  "scope" text NOT NULL,
  "approval_requirement" text,
  "effective_date" text,
  "status" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "usage_count" integer DEFAULT 0 NOT NULL,
  "conflict_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "source_learning_item_id" text,
  "source_evidence" jsonb,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "created_by" text NOT NULL,
  "seeded" boolean DEFAULT false NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ci_rules_status" ON "ci_rules" ("status");
CREATE INDEX IF NOT EXISTS "idx_ci_rules_created_at" ON "ci_rules" ("created_at");

CREATE TABLE IF NOT EXISTS "ci_rule_versions" (
  "id" serial PRIMARY KEY,
  "rule_id" text NOT NULL,
  "version" integer NOT NULL,
  "at" text NOT NULL,
  "by" text NOT NULL,
  "summary" text NOT NULL,
  "status" text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_ci_rule_versions_rule_version" ON "ci_rule_versions" ("rule_id", "version");

CREATE TABLE IF NOT EXISTS "ci_evidence_records" (
  "id" text PRIMARY KEY,
  "patient_id" integer,
  "patient_name" text NOT NULL,
  "facility" text,
  "schedule_date" text,
  "source_type" text NOT NULL,
  "source_text" text NOT NULL,
  "label" text NOT NULL,
  "confidence" text NOT NULL,
  "assigned_ancillary" text,
  "status" text NOT NULL,
  "decided_by" text NOT NULL,
  "at" text NOT NULL,
  "used_in_rule_ids" jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ci_evidence_patient_id" ON "ci_evidence_records" ("patient_id");
CREATE INDEX IF NOT EXISTS "idx_ci_evidence_at" ON "ci_evidence_records" ("at");

CREATE TABLE IF NOT EXISTS "ci_audit_entries" (
  "id" text PRIMARY KEY,
  "at" text NOT NULL,
  "by" text NOT NULL,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "entity_name" text NOT NULL,
  "detail" text
);

CREATE INDEX IF NOT EXISTS "idx_ci_audit_entries_at" ON "ci_audit_entries" ("at");
