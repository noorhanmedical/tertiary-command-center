-- Clinician Portal action persistence (note signing/amend/draft, call outcomes,
-- schedule additions). Overlays keyed by the aggregator record id; the audit
-- trail itself lives in audit_log.

CREATE TABLE IF NOT EXISTS "clinician_portal_note_states" (
  "id" serial PRIMARY KEY NOT NULL,
  "note_id" text NOT NULL,
  "status" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "soap" jsonb,
  "signed_by_name" text,
  "signed_at" timestamp,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_cp_note_states_note" ON "clinician_portal_note_states" ("note_id");

CREATE TABLE IF NOT EXISTS "clinician_portal_call_states" (
  "id" serial PRIMARY KEY NOT NULL,
  "call_id" text NOT NULL,
  "status" text NOT NULL,
  "last_outcome" text,
  "history" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_cp_call_states_call" ON "clinician_portal_call_states" ("call_id");

CREATE TABLE IF NOT EXISTS "clinician_portal_schedule_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "patient_id" text NOT NULL,
  "patient_name" text DEFAULT '' NOT NULL,
  "service" text NOT NULL,
  "time" text NOT NULL,
  "technician" text NOT NULL,
  "status" text NOT NULL,
  "source" text NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_cp_schedule_patient_service" ON "clinician_portal_schedule_items" ("patient_id", "service");
CREATE INDEX IF NOT EXISTS "idx_cp_schedule_created" ON "clinician_portal_schedule_items" ("created_at");
