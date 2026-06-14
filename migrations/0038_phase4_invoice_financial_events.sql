-- Phase 4 PR 4.6 — invoice_adjustments + invoice_denials + remittance_events.

CREATE TABLE IF NOT EXISTS "invoice_adjustments" (
  "id" serial PRIMARY KEY NOT NULL,
  "invoice_id" integer NOT NULL,
  "line_item_id" integer,
  "adjustment_type" text NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "reason" text,
  "actor_user_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "invoice_adjustments"
    ADD CONSTRAINT "invoice_adjustments_invoice_fk"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "invoice_adjustments"
    ADD CONSTRAINT "invoice_adjustments_line_item_fk"
    FOREIGN KEY ("line_item_id") REFERENCES "invoice_line_items"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_invoice_adjustments_invoice_id" ON "invoice_adjustments" ("invoice_id");
CREATE INDEX IF NOT EXISTS "idx_invoice_adjustments_type" ON "invoice_adjustments" ("adjustment_type");

CREATE TABLE IF NOT EXISTS "invoice_denials" (
  "id" serial PRIMARY KEY NOT NULL,
  "invoice_id" integer NOT NULL,
  "line_item_id" integer,
  "denial_code" text,
  "denial_reason" text,
  "payer" text,
  "status" text DEFAULT 'open' NOT NULL,
  "next_action_at" timestamp,
  "actor_user_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "invoice_denials"
    ADD CONSTRAINT "invoice_denials_invoice_fk"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "invoice_denials"
    ADD CONSTRAINT "invoice_denials_line_item_fk"
    FOREIGN KEY ("line_item_id") REFERENCES "invoice_line_items"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_invoice_denials_invoice_id" ON "invoice_denials" ("invoice_id");
CREATE INDEX IF NOT EXISTS "idx_invoice_denials_status" ON "invoice_denials" ("status");

CREATE TABLE IF NOT EXISTS "remittance_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "invoice_id" integer NOT NULL,
  "payer" text,
  "reference" text,
  "amount" numeric(12, 2),
  "event_type" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "actor_user_id" text,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "remittance_events"
    ADD CONSTRAINT "remittance_events_invoice_fk"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_remittance_events_invoice_id" ON "remittance_events" ("invoice_id");
CREATE INDEX IF NOT EXISTS "idx_remittance_events_event_type" ON "remittance_events" ("event_type");
