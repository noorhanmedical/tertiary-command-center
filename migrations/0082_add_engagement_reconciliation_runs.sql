-- 0082 — Durable daily reconciliation RUN ledger (Phase 2B).
-- ADDITIVE + IDEMPOTENT. Safe to re-run.
--
-- WHY: the clinic-local 5 AM canonical engagement reconciliation
-- (server/services/engagement/dailyReconciliation.ts) previously tracked
-- run-once state ONLY in an in-memory Set + a transient advisory lock. That
-- gave no DURABLE knowledge of whether a clinic reconciled for its local
-- operational date (lost on restart), no failed/catch-up visibility, and no
-- multi-instance success record. This table records execution STATE only —
-- it is NOT a scheduler/allocator and NOT the legacy scheduler_assignments
-- history snapshot.
--
-- IDENTITY / RETRY: one logical run per (clinic_id, operational_date,
-- job_type), enforced by uq_err_clinic_date_job, with MUTABLE status +
-- attempt_count. A failed/started row is UPDATED in place on retry, so a
-- failure never blocks a later successful retry. "Reconciled today" = a row
-- with status='succeeded'.
--
-- PHI: none. Only clinic id, an operational-date string, a timezone id, run
-- status/attempt/trigger, a PHI-safe failure summary, and non-PHI counts.
--
-- Apply manually (NOT auto-run) with fail-fast:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0082_add_engagement_reconciliation_runs.sql
--
-- Rollback (dev):
--   DROP TABLE IF EXISTS engagement_reconciliation_runs;

BEGIN;

CREATE TABLE IF NOT EXISTS engagement_reconciliation_runs (
  id serial PRIMARY KEY,
  clinic_id integer NOT NULL,
  operational_date text NOT NULL,
  job_type text NOT NULL DEFAULT 'daily_engagement_reconciliation',
  time_zone text,
  trigger_type text,
  status text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  failure_code text,
  failure_summary text,
  candidate_count integer,
  assigned_count integer,
  needs_coverage_count integer,
  skipped_count integer,
  started_at timestamp,
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- FK → clinics(id) ON DELETE CASCADE (guarded / idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'fk_err_clinic'
       AND table_name = 'engagement_reconciliation_runs'
  ) THEN
    ALTER TABLE engagement_reconciliation_runs
      ADD CONSTRAINT fk_err_clinic
      FOREIGN KEY (clinic_id)
      REFERENCES clinics(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ONE logical run per (clinic, operational date, job type) — the retry-safe
-- identity. Mutated across attempts; never blocks a retry after failure.
CREATE UNIQUE INDEX IF NOT EXISTS uq_err_clinic_date_job
  ON engagement_reconciliation_runs(clinic_id, operational_date, job_type);

CREATE INDEX IF NOT EXISTS idx_err_clinic ON engagement_reconciliation_runs(clinic_id);
CREATE INDEX IF NOT EXISTS idx_err_status ON engagement_reconciliation_runs(status);

COMMIT;

-- ── Verification (run after apply) ──────────────────────────────────────────
--  table present:   SELECT to_regclass('engagement_reconciliation_runs');
--  unique index:    SELECT indexname FROM pg_indexes
--                     WHERE tablename='engagement_reconciliation_runs'
--                       AND indexname='uq_err_clinic_date_job';
--  today's runs:    SELECT clinic_id, operational_date, status, attempt_count,
--                          trigger_type, time_zone, assigned_count,
--                          needs_coverage_count, failure_code
--                     FROM engagement_reconciliation_runs
--                    ORDER BY updated_at DESC;
