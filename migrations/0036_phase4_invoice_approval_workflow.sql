-- Phase 4 PR 4.4 — invoice approval workflow columns.
-- Legacy "status" stays. Approval + delivery + provenance columns
-- are added alongside.

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "invoice_batch_id" integer,
  ADD COLUMN IF NOT EXISTS "approval_status" text DEFAULT 'draft' NOT NULL,
  ADD COLUMN IF NOT EXISTS "approved_by_user_id" varchar,
  ADD COLUMN IF NOT EXISTS "approved_at" timestamp,
  ADD COLUMN IF NOT EXISTS "voided_at" timestamp,
  ADD COLUMN IF NOT EXISTS "void_reason" text,
  ADD COLUMN IF NOT EXISTS "policy_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "recipient_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "delivery_status" text DEFAULT 'pending' NOT NULL,
  ADD COLUMN IF NOT EXISTS "due_date" text,
  ADD COLUMN IF NOT EXISTS "payment_terms" text;

DO $$ BEGIN
  ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_invoice_batch_fk"
    FOREIGN KEY ("invoice_batch_id") REFERENCES "invoice_batches"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_approved_by_user_fk"
    FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_invoices_approval_status" ON "invoices" ("approval_status");
CREATE INDEX IF NOT EXISTS "idx_invoices_delivery_status" ON "invoices" ("delivery_status");
CREATE INDEX IF NOT EXISTS "idx_invoices_invoice_batch_id" ON "invoices" ("invoice_batch_id");
