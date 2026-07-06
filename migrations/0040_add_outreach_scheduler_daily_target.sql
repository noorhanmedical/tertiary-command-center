-- Add daily_target to outreach_schedulers.
--
-- capacity_percent is a relative load % (added in 0015); daily_target is an
-- absolute target count of patients/day for a roster member. It is nullable
-- (NULL = "no absolute target set", code falls back to capacity_percent), so
-- this column is safe to roll forward and back with no data backfill.
--
-- Aligns the DB with shared/schema/outreach.ts (`dailyTarget: integer("daily_target")`)
-- and the /api/engagement/assignment-board/.../daily-target endpoint.

ALTER TABLE "outreach_schedulers"
  ADD COLUMN IF NOT EXISTS "daily_target" integer;
