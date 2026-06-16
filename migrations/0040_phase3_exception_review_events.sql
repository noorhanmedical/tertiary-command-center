-- Phase 3 PR 3.3 — exception_review_events.

CREATE TABLE IF NOT EXISTS "exception_review_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "exception_snapshot_id" integer NOT NULL,
  "event_type" text NOT NULL,
  "actor_user_id" varchar,
  "assigned_to_user_id" varchar,
  "assigned_role" text,
  "reason" text,
  "note" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "exception_review_events"
    ADD CONSTRAINT "exception_review_events_snapshot_fk"
    FOREIGN KEY ("exception_snapshot_id") REFERENCES "exception_snapshots"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_review_events"
    ADD CONSTRAINT "exception_review_events_actor_user_fk"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_review_events"
    ADD CONSTRAINT "exception_review_events_assigned_user_fk"
    FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_exception_review_events_snapshot_id" ON "exception_review_events" ("exception_snapshot_id");
CREATE INDEX IF NOT EXISTS "idx_exception_review_events_event_type" ON "exception_review_events" ("event_type");
