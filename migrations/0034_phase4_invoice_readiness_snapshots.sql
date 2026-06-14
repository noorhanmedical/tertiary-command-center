-- Phase 4 PR 4.2 — invoice_readiness_snapshots.
-- Per-(case, serviceType) snapshot written by the readiness engine.

CREATE TABLE IF NOT EXISTS "invoice_readiness_snapshots" (
  "id" serial PRIMARY KEY NOT NULL,
  "execution_case_id" integer,
  "patient_screening_id" integer,
  "procedure_event_id" integer,
  "facility_id" text,
  "service_type" text NOT NULL,
  "patient_name" text,
  "patient_dob" text,
  "readiness_status" text DEFAULT 'not_ready' NOT NULL,
  "blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "price_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "policy_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "unit_price" numeric(12, 2),
  "evaluated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "invoice_id" integer,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "invoice_readiness_snapshots"
    ADD CONSTRAINT "invoice_readiness_execution_case_fk"
    FOREIGN KEY ("execution_case_id") REFERENCES "patient_execution_cases"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "invoice_readiness_snapshots"
    ADD CONSTRAINT "invoice_readiness_patient_screening_fk"
    FOREIGN KEY ("patient_screening_id") REFERENCES "patient_screenings"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "invoice_readiness_snapshots"
    ADD CONSTRAINT "invoice_readiness_procedure_event_fk"
    FOREIGN KEY ("procedure_event_id") REFERENCES "procedure_events"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "invoice_readiness_snapshots"
    ADD CONSTRAINT "invoice_readiness_invoice_fk"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_invoice_readiness_facility_id" ON "invoice_readiness_snapshots" ("facility_id");
CREATE INDEX IF NOT EXISTS "idx_invoice_readiness_service_type" ON "invoice_readiness_snapshots" ("service_type");
CREATE INDEX IF NOT EXISTS "idx_invoice_readiness_status" ON "invoice_readiness_snapshots" ("readiness_status");
CREATE INDEX IF NOT EXISTS "idx_invoice_readiness_execution_case_id" ON "invoice_readiness_snapshots" ("execution_case_id");
CREATE INDEX IF NOT EXISTS "idx_invoice_readiness_patient_screening_id" ON "invoice_readiness_snapshots" ("patient_screening_id");

CREATE UNIQUE INDEX IF NOT EXISTS "idx_invoice_readiness_case_service"
  ON "invoice_readiness_snapshots" ("execution_case_id", "service_type");
