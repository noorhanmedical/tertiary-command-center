-- Team Portal Playground sticky notes / widgets, persisted per user.
-- See shared/schema/portalWidgets.ts for the typed mirror. The owning user is
-- always taken from the server session, so widgets cannot bleed across users.
--
-- `id` is the CLIENT-generated widget id (`w{timestamp}_{seq}`) and is only
-- unique WITHIN a user's set, so the primary key is composite on (user_id, id).

CREATE TABLE IF NOT EXISTS "portal_widgets" (
  "id" text NOT NULL,
  "user_id" varchar NOT NULL,
  "type" text NOT NULL,
  "x" integer DEFAULT 0 NOT NULL,
  "y" integer DEFAULT 0 NOT NULL,
  "color" text DEFAULT 'yellow' NOT NULL,
  "text" text DEFAULT '' NOT NULL,
  "collapsed" boolean DEFAULT false NOT NULL,
  "patient_context" jsonb,
  "created_by" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "portal_widgets_user_id_id_pk" PRIMARY KEY ("user_id", "id")
);

DO $$ BEGIN
  ALTER TABLE "portal_widgets"
    ADD CONSTRAINT "portal_widgets_user_id_fk"
    FOREIGN KEY ("user_id")
    REFERENCES "users"("id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_portal_widgets_user_id" ON "portal_widgets" ("user_id");
