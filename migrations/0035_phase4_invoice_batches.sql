-- Phase 4 PR 4.3 — invoice_batches + invoice_batch_items.

CREATE TABLE IF NOT EXISTS "invoice_batches" (
  "id" serial PRIMARY KEY NOT NULL,
  "facility_id" text NOT NULL,
  "invoice_period_start" text NOT NULL,
  "invoice_period_end" text NOT NULL,
  "cutoff_at" timestamp NOT NULL,
  "batch_status" text DEFAULT 'draft_preview' NOT NULL,
  "policy_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "recipient_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "item_count" integer DEFAULT 0 NOT NULL,
  "blocked_count" integer DEFAULT 0 NOT NULL,
  "created_by_user_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_invoice_batches_facility_id" ON "invoice_batches" ("facility_id");
CREATE INDEX IF NOT EXISTS "idx_invoice_batches_status" ON "invoice_batches" ("batch_status");
CREATE INDEX IF NOT EXISTS "idx_invoice_batches_period" ON "invoice_batches" ("invoice_period_start", "invoice_period_end");

CREATE TABLE IF NOT EXISTS "invoice_batch_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "batch_id" integer NOT NULL,
  "invoice_readiness_snapshot_id" integer,
  "execution_case_id" integer,
  "patient_screening_id" integer,
  "procedure_event_id" integer,
  "facility_id" text,
  "test_type" text NOT NULL,
  "patient_name" text,
  "date_of_service" text,
  "price" numeric(12, 2),
  "revenue_split" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "line_status" text DEFAULT 'included' NOT NULL,
  "blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "invoice_batch_items"
    ADD CONSTRAINT "invoice_batch_items_batch_fk"
    FOREIGN KEY ("batch_id") REFERENCES "invoice_batches"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "invoice_batch_items"
    ADD CONSTRAINT "invoice_batch_items_snapshot_fk"
    FOREIGN KEY ("invoice_readiness_snapshot_id") REFERENCES "invoice_readiness_snapshots"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_invoice_batch_items_batch_id" ON "invoice_batch_items" ("batch_id");
CREATE INDEX IF NOT EXISTS "idx_invoice_batch_items_status" ON "invoice_batch_items" ("line_status");
CREATE INDEX IF NOT EXISTS "idx_invoice_batch_items_execution_case_id" ON "invoice_batch_items" ("execution_case_id");
