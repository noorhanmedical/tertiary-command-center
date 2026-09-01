-- Phase 3D (Team Ops) — structured NEEDS COVERAGE state (decision K8).
--
-- Additive only. Records the STRUCTURED reason a case is currently uncovered
-- so a manager can understand WHY. This is NOT a second ownership store — the
-- case stays canonically unassigned (patient_execution_cases.assigned_team_member_id
-- IS NULL); one row per execution case, cleared (resolved_at) when it gets an
-- owner. Idempotent per the repo migration convention.

CREATE TABLE IF NOT EXISTS needs_coverage (
  id                     SERIAL PRIMARY KEY,
  execution_case_id      INTEGER NOT NULL REFERENCES patient_execution_cases(id) ON DELETE CASCADE,
  patient_screening_id   INTEGER REFERENCES patient_screenings(id) ON DELETE SET NULL,
  facility_id            TEXT,
  category               TEXT NOT NULL DEFAULT 'other',
  reason                 TEXT NOT NULL,
  priority_level         TEXT,
  source                 TEXT NOT NULL DEFAULT 'distribution',
  metadata               JSONB,
  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at            TIMESTAMP,
  resolved_by_user_id    VARCHAR REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_needs_coverage_execution_case ON needs_coverage(execution_case_id);
CREATE INDEX IF NOT EXISTS idx_needs_coverage_category ON needs_coverage(category);
CREATE INDEX IF NOT EXISTS idx_needs_coverage_facility ON needs_coverage(facility_id);
CREATE INDEX IF NOT EXISTS idx_needs_coverage_resolved ON needs_coverage(resolved_at);
