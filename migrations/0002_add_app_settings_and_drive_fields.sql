CREATE TABLE IF NOT EXISTS "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generated_notes" ADD COLUMN IF NOT EXISTS "drive_file_id" text;
--> statement-breakpoint
ALTER TABLE "generated_notes" ADD COLUMN IF NOT EXISTS "drive_web_view_link" text;
