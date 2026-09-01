-- Migration 0049: Clinic Onboarding — section templates, checklist items, signoffs.
--
-- Backs the admin-only Clinic Onboarding console
-- (client/src/pages/clinic-onboarding.tsx) via /api/clinic-onboarding/*.
--
-- Three tables:
--   • onboarding_section_templates — canonical 25-section catalog (config data).
--   • onboarding_checklist_items   — per-clinic, per-item state (status,
--     maturity, blocked, owner, evidence). Source of truth for progress /
--     maturity / go-live metrics.
--   • onboarding_signoffs          — dual admin + owner go-live approvals.
--
-- NOTE ON APPLY MECHANISM: this repo syncs the Drizzle schema to the database
-- via `drizzle-kit push --force` at container boot (see Dockerfile CMD), so the
-- tables themselves are created from shared/schema/clinicOnboarding.ts on the
-- next deploy. This numbered file documents the change and is safe to run
-- standalone. All statements are idempotent (IF NOT EXISTS / duplicate_object).

-- ─── 1) Section templates (catalog) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "onboarding_section_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "ordinal" integer NOT NULL,
  "name" text NOT NULL,
  "phase" text DEFAULT 'Implementation' NOT NULL,
  "item_labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_onboarding_section_ordinal"
  ON "onboarding_section_templates" ("ordinal");
CREATE INDEX IF NOT EXISTS "idx_onboarding_section_phase"
  ON "onboarding_section_templates" ("phase");

-- ─── 2) Checklist items (per-clinic state) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS "onboarding_checklist_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "clinic_id" integer,
  "section_ordinal" integer NOT NULL,
  "section_name" text NOT NULL,
  "phase" text DEFAULT 'Implementation' NOT NULL,
  "label" text NOT NULL,
  "status" text DEFAULT 'not_started' NOT NULL,
  "maturity_score" integer DEFAULT 0 NOT NULL,
  "blocked" boolean DEFAULT false NOT NULL,
  "owner_user_id" text,
  "owner_name" text,
  "due_date" text,
  "notes" text,
  "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "onboarding_checklist_items"
    ADD CONSTRAINT "onboarding_checklist_items_clinic_fk"
    FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "onboarding_checklist_items"
    ADD CONSTRAINT "onboarding_checklist_items_owner_fk"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_onboarding_item_clinic"
  ON "onboarding_checklist_items" ("clinic_id");
CREATE INDEX IF NOT EXISTS "idx_onboarding_item_section"
  ON "onboarding_checklist_items" ("section_ordinal");
CREATE INDEX IF NOT EXISTS "idx_onboarding_item_status"
  ON "onboarding_checklist_items" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_onboarding_item_clinic_section_label"
  ON "onboarding_checklist_items" ("clinic_id", "section_ordinal", "label");

-- ─── 3) Go-live signoffs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "onboarding_signoffs" (
  "id" serial PRIMARY KEY NOT NULL,
  "clinic_id" integer,
  "role" text NOT NULL,
  "signed_by_user_id" text,
  "signed_by_name" text,
  "notes" text,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "onboarding_signoffs"
    ADD CONSTRAINT "onboarding_signoffs_clinic_fk"
    FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "onboarding_signoffs"
    ADD CONSTRAINT "onboarding_signoffs_signer_fk"
    FOREIGN KEY ("signed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_onboarding_signoff_clinic"
  ON "onboarding_signoffs" ("clinic_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_onboarding_signoff_clinic_role"
  ON "onboarding_signoffs" ("clinic_id", "role");
