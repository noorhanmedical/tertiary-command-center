-- Phase 2 PR 2.6 — canonical patient notes table.
-- See shared/schema/patientNotes.ts for the typed mirror.

CREATE TABLE IF NOT EXISTS "patient_notes" (
  "id" serial PRIMARY KEY NOT NULL,
  "patient_screening_id" integer NOT NULL,
  "execution_case_id" integer,
  "note_type" text DEFAULT 'quick_note' NOT NULL,
  "body" text NOT NULL,
  "author_user_id" varchar,
  "is_internal" boolean DEFAULT true NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "archived_at" timestamp,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "patient_notes"
    ADD CONSTRAINT "patient_notes_patient_screening_id_fk"
    FOREIGN KEY ("patient_screening_id")
    REFERENCES "patient_screenings"("id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "patient_notes"
    ADD CONSTRAINT "patient_notes_execution_case_id_fk"
    FOREIGN KEY ("execution_case_id")
    REFERENCES "patient_execution_cases"("id")
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "patient_notes"
    ADD CONSTRAINT "patient_notes_author_user_id_fk"
    FOREIGN KEY ("author_user_id")
    REFERENCES "users"("id")
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_patient_notes_patient_screening_id"
  ON "patient_notes" ("patient_screening_id");
CREATE INDEX IF NOT EXISTS "idx_patient_notes_execution_case_id"
  ON "patient_notes" ("execution_case_id");
CREATE INDEX IF NOT EXISTS "idx_patient_notes_author_user_id"
  ON "patient_notes" ("author_user_id");
CREATE INDEX IF NOT EXISTS "idx_patient_notes_note_type"
  ON "patient_notes" ("note_type");
CREATE INDEX IF NOT EXISTS "idx_patient_notes_created_at"
  ON "patient_notes" ("created_at");
