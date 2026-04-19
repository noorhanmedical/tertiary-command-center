-- Add capacity_percent to outreach_schedulers and backfill existing rows to 100%.
ALTER TABLE "outreach_schedulers"
  ADD COLUMN IF NOT EXISTS "capacity_percent" integer NOT NULL DEFAULT 100;

UPDATE "outreach_schedulers"
SET "capacity_percent" = 100
WHERE "capacity_percent" IS NULL;
