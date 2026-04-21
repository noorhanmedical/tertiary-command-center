CREATE TABLE IF NOT EXISTS "pto_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" varchar NOT NULL,
  "start_date" text NOT NULL,
  "end_date" text NOT NULL,
  "note" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "reviewed_by" varchar,
  "reviewed_at" timestamp,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "pto_requests" ADD CONSTRAINT "pto_requests_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "pto_requests" ADD CONSTRAINT "pto_requests_reviewed_by_users_id_fk"
    FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pto_requests_user_id" ON "pto_requests" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_pto_requests_status" ON "pto_requests" ("status");
CREATE INDEX IF NOT EXISTS "idx_pto_requests_dates" ON "pto_requests" ("start_date","end_date");
