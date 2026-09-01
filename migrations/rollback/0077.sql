-- Rollback for migration 0049 (Clinic Onboarding).
-- Drops the three onboarding tables. Indexes and FK constraints are removed
-- automatically with the tables. Destructive — all onboarding data is lost.

DROP TABLE IF EXISTS "onboarding_signoffs";
DROP TABLE IF EXISTS "onboarding_checklist_items";
DROP TABLE IF EXISTS "onboarding_section_templates";
