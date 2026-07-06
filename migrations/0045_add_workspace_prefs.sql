-- Team Portal workspace preferences, persisted per user.
-- See shared/schema/portalPrefs.ts for the typed mirror. One row per user;
-- the prefs object is stored as jsonb and validated with zod at the route.

CREATE TABLE IF NOT EXISTS "workspace_prefs" (
  "user_id" varchar PRIMARY KEY,
  "prefs" jsonb NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "workspace_prefs"
    ADD CONSTRAINT "workspace_prefs_user_id_fk"
    FOREIGN KEY ("user_id")
    REFERENCES "users"("id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
