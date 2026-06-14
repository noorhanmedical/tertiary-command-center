-- Phase 2 hardening item 5 — test-specific admin settings scope.
-- See shared/schema/adminSettings.ts.

ALTER TABLE "admin_settings"
  ADD COLUMN IF NOT EXISTS "test_type" text;

CREATE INDEX IF NOT EXISTS "idx_admin_settings_test_type"
  ON "admin_settings" ("test_type");

-- Drop the old (domain, key, facility, user) unique constraint and
-- replace it with one that also includes test_type. Without this
-- swap, the same (domain, key) could not carry per-test variants.
DROP INDEX IF EXISTS "idx_admin_settings_domain_key_facility_user";

CREATE UNIQUE INDEX IF NOT EXISTS "idx_admin_settings_domain_key_facility_user_test"
  ON "admin_settings" ("setting_domain", "setting_key", "facility_id", "user_id", "test_type");
