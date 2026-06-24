-- Configurable Call Settings: additive per-member override columns on
-- engagement_call_settings. All nullable so existing rows/behavior are
-- unchanged (null = fall back to the tier/global formula). The global config
-- and workday-tier table are stored as JSON in app_settings (no schema here).
ALTER TABLE "engagement_call_settings"
  ADD COLUMN IF NOT EXISTS "explicit_completed_kpi" integer,
  ADD COLUMN IF NOT EXISTS "explicit_scheduled_kpi" integer,
  ADD COLUMN IF NOT EXISTS "outreach_percent" integer,
  ADD COLUMN IF NOT EXISTS "facilities_covered" text[];
