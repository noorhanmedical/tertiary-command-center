CREATE TABLE IF NOT EXISTS "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "screening_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"clinician_name" text,
	"patient_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "patient_screenings" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"time" text,
	"name" text NOT NULL,
	"age" integer,
	"gender" text,
	"diagnoses" text,
	"history" text,
	"medications" text,
	"notes" text,
	"qualifying_tests" text[],
	"reasoning" jsonb,
	"cooldown_tests" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "patient_test_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_name" text NOT NULL,
	"test_name" text NOT NULL,
	"date_of_service" text NOT NULL,
	"insurance_type" text DEFAULT 'ppo' NOT NULL,
	"clinic" text DEFAULT 'NWPG' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "patient_reference_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_name" text NOT NULL,
	"diagnoses" text,
	"history" text,
	"medications" text,
	"age" text,
	"gender" text,
	"insurance" text,
	"notes" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "patient_screenings" ADD CONSTRAINT "patient_screenings_batch_id_screening_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."screening_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "screening_batches" ADD COLUMN IF NOT EXISTS "clinician_name" text;
