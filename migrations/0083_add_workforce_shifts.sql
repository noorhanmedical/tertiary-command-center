-- 0083 — Workforce shifts + intra-day availability (Phase 3).
-- ADDITIVE + IDEMPOTENT. Safe to re-run.
--
-- WHY: the platform had no team-member shift/working-hours model — working
-- status was a single whole-day boolean (PTO/roster + manual override) and the
-- only capacity "proration" was the whole-day callWorkdayPercent. Phase 3 adds
-- (a) a recurring DEFAULT shift pattern on engagement_call_settings and (b) a
-- minimal per-(member, date) table for date overrides + real-time availability
-- (breaks / meetings / early departure). Full-day PTO stays in pto_requests;
-- the canonical allocator (distributionService) and capacity model
-- (callSettingsService) are extended, not replaced.
--
-- OPT-IN: existing rows get NULL default-shift columns and no shift rows, so
-- behavior is unchanged until an admin configures a shift.
--
-- PHI: none.
--
-- Apply manually (NOT auto-run) with fail-fast:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0083_add_workforce_shifts.sql
--
-- Rollback (dev):
--   DROP TABLE IF EXISTS team_member_shifts;
--   ALTER TABLE engagement_call_settings
--     DROP COLUMN IF EXISTS default_shift_start,
--     DROP COLUMN IF EXISTS default_shift_end,
--     DROP COLUMN IF EXISTS work_weekdays;

BEGIN;

-- (a) Recurring default shift pattern on the existing per-member settings row.
ALTER TABLE engagement_call_settings
  ADD COLUMN IF NOT EXISTS default_shift_start text,
  ADD COLUMN IF NOT EXISTS default_shift_end text,
  ADD COLUMN IF NOT EXISTS work_weekdays jsonb;

-- (b) Per-(member, date) shift override + real-time availability.
CREATE TABLE IF NOT EXISTS team_member_shifts (
  id serial PRIMARY KEY,
  scheduler_id integer NOT NULL,
  clinic_id integer,
  work_date text NOT NULL,
  working boolean NOT NULL DEFAULT true,
  shift_start text,
  shift_end text,
  capacity_override integer,
  availability_state text,
  availability_reason text,
  availability_set_at timestamp,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- FK → outreach_schedulers(id) ON DELETE CASCADE (guarded / idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'fk_tms_scheduler'
       AND table_name = 'team_member_shifts'
  ) THEN
    ALTER TABLE team_member_shifts
      ADD CONSTRAINT fk_tms_scheduler
      FOREIGN KEY (scheduler_id)
      REFERENCES outreach_schedulers(id) ON DELETE CASCADE;
  END IF;
END $$;

-- FK → clinics(id) ON DELETE SET NULL (guarded / idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'fk_tms_clinic'
       AND table_name = 'team_member_shifts'
  ) THEN
    ALTER TABLE team_member_shifts
      ADD CONSTRAINT fk_tms_clinic
      FOREIGN KEY (clinic_id)
      REFERENCES clinics(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ONE shift row per (member, date).
CREATE UNIQUE INDEX IF NOT EXISTS uq_tms_scheduler_date
  ON team_member_shifts(scheduler_id, work_date);
CREATE INDEX IF NOT EXISTS idx_tms_work_date ON team_member_shifts(work_date);

COMMIT;

-- ── Verification ─────────────────────────────────────────────────────────────
--  SELECT to_regclass('team_member_shifts');
--  SELECT column_name FROM information_schema.columns
--    WHERE table_name='engagement_call_settings'
--      AND column_name IN ('default_shift_start','default_shift_end','work_weekdays');
