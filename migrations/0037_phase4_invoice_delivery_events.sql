-- Phase 4 PR 4.5 — invoice_delivery_events.

CREATE TABLE IF NOT EXISTS "invoice_delivery_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "invoice_id" integer NOT NULL,
  "event_type" text NOT NULL,
  "recipient_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "actor_user_id" text,
  "message_id" text,
  "error_message" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "invoice_delivery_events"
    ADD CONSTRAINT "invoice_delivery_events_invoice_fk"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_invoice_delivery_invoice_id" ON "invoice_delivery_events" ("invoice_id");
CREATE INDEX IF NOT EXISTS "idx_invoice_delivery_event_type" ON "invoice_delivery_events" ("event_type");
CREATE INDEX IF NOT EXISTS "idx_invoice_delivery_created_at" ON "invoice_delivery_events" ("created_at");
