-- Phase 2 PR 2.7 — canonical internal contacts directory.
-- See shared/schema/contacts.ts for the typed mirror.

CREATE TABLE IF NOT EXISTS "contacts" (
  "id" serial PRIMARY KEY NOT NULL,
  "category" text NOT NULL,
  "name" text NOT NULL,
  "role" text,
  "organization" text,
  "facility_id" text,
  "phone" text NOT NULL,
  "email" text,
  "notes" text,
  "user_id" varchar,
  "is_on_call" boolean DEFAULT false NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "archived_at" timestamp,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "contacts"
    ADD CONSTRAINT "contacts_user_id_fk"
    FOREIGN KEY ("user_id")
    REFERENCES "users"("id")
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_contacts_category" ON "contacts" ("category");
CREATE INDEX IF NOT EXISTS "idx_contacts_facility_id" ON "contacts" ("facility_id");
CREATE INDEX IF NOT EXISTS "idx_contacts_user_id" ON "contacts" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_contacts_archived" ON "contacts" ("archived_at");
