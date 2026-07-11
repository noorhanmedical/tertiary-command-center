-- Phase 3 PR 3.2 — exception_snapshots.

CREATE TABLE IF NOT EXISTS "exception_snapshots" (
  "id" serial PRIMARY KEY NOT NULL,
  "exception_key" text NOT NULL,
  "exception_type" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" integer,
  "patient_screening_id" integer,
  "execution_case_id" integer,
  "invoice_id" integer,
  "facility_id" text,
  "test_type" text,
  "severity" text DEFAULT 'medium' NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "title" text NOT NULL,
  "explanation" text NOT NULL,
  "recommended_owner_role" text,
  "assigned_to_user_id" varchar,
  "assigned_role" text,
  "acknowledged_at" timestamp,
  "acknowledged_by_user_id" varchar,
  "resolution_reason" text,
  "dismissed_reason" text,
  "detected_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "last_seen_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "resolved_at" timestamp,
  "superseded_by_engine" integer DEFAULT 0 NOT NULL,
  "source_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "detector_version" text,
  "policy_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "exception_snapshots"
    ADD CONSTRAINT "exception_snapshots_patient_screening_fk"
    FOREIGN KEY ("patient_screening_id") REFERENCES "patient_screenings"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_snapshots"
    ADD CONSTRAINT "exception_snapshots_execution_case_fk"
    FOREIGN KEY ("execution_case_id") REFERENCES "patient_execution_cases"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_snapshots"
    ADD CONSTRAINT "exception_snapshots_invoice_fk"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_snapshots"
    ADD CONSTRAINT "exception_snapshots_assigned_user_fk"
    FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_snapshots"
    ADD CONSTRAINT "exception_snapshots_acknowledged_by_user_fk"
    FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_exception_snapshots_status" ON "exception_snapshots" ("status");
CREATE INDEX IF NOT EXISTS "idx_exception_snapshots_type" ON "exception_snapshots" ("exception_type");
CREATE INDEX IF NOT EXISTS "idx_exception_snapshots_severity" ON "exception_snapshots" ("severity");
CREATE INDEX IF NOT EXISTS "idx_exception_snapshots_facility_id" ON "exception_snapshots" ("facility_id");
CREATE INDEX IF NOT EXISTS "idx_exception_snapshots_execution_case_id" ON "exception_snapshots" ("execution_case_id");
CREATE INDEX IF NOT EXISTS "idx_exception_snapshots_invoice_id" ON "exception_snapshots" ("invoice_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_exception_snapshots_key" ON "exception_snapshots" ("exception_key");
