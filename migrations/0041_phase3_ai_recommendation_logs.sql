-- Phase 3 PR 3.4 — ai_recommendation_logs.

CREATE TABLE IF NOT EXISTS "ai_recommendation_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "recommendation_key" text NOT NULL,
  "exception_snapshot_id" integer,

  "recommendation_type" text NOT NULL,
  "recommended_action" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,

  "model_provider" text NOT NULL,
  "model_name" text,
  "confidence_label" text NOT NULL,
  "rule_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "rationale" text NOT NULL,
  "inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,

  "status" text DEFAULT 'proposed' NOT NULL,
  "requires_human_review" integer DEFAULT 1 NOT NULL,
  "accepted_at" timestamp,
  "accepted_by_user_id" varchar,
  "rejected_at" timestamp,
  "rejected_by_user_id" varchar,
  "rejection_reason" text,
  "superseded_at" timestamp,

  "policy_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "source_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "detector_version" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,

  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "ai_recommendation_logs"
    ADD CONSTRAINT "ai_recommendation_logs_exception_fk"
    FOREIGN KEY ("exception_snapshot_id") REFERENCES "exception_snapshots"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_recommendation_logs"
    ADD CONSTRAINT "ai_recommendation_logs_accepted_user_fk"
    FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_recommendation_logs"
    ADD CONSTRAINT "ai_recommendation_logs_rejected_user_fk"
    FOREIGN KEY ("rejected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_recommendation_logs_key" ON "ai_recommendation_logs" ("recommendation_key");
CREATE INDEX IF NOT EXISTS "idx_ai_recommendation_logs_status" ON "ai_recommendation_logs" ("status");
CREATE INDEX IF NOT EXISTS "idx_ai_recommendation_logs_provider" ON "ai_recommendation_logs" ("model_provider");
CREATE INDEX IF NOT EXISTS "idx_ai_recommendation_logs_exception" ON "ai_recommendation_logs" ("exception_snapshot_id");
CREATE INDEX IF NOT EXISTS "idx_ai_recommendation_logs_action" ON "ai_recommendation_logs" ("recommended_action");
