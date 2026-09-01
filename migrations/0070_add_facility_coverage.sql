-- Phase 4B (Team Ops) — canonical facility coverage.
--
-- Additive only, idempotent. ONE source for which facilities a team member
-- serves. Converges outreach_schedulers.facility (primary) +
-- engagement_call_settings.facilitiesCovered[] (regular). Keyed by users.id.
-- Concurrency-safe: partial unique index → one ACTIVE row per (user,facility).

CREATE TABLE IF NOT EXISTS team_member_facility_coverage (
  id               SERIAL PRIMARY KEY,
  user_id          VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  facility_id      TEXT NOT NULL,
  coverage_type    TEXT NOT NULL DEFAULT 'regular',
  primary_coverage BOOLEAN NOT NULL DEFAULT FALSE,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  temporary_start  TIMESTAMP,
  temporary_end    TIMESTAMP,
  source           TEXT NOT NULL DEFAULT 'manual',
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tmfc_user ON team_member_facility_coverage(user_id);
CREATE INDEX IF NOT EXISTS idx_tmfc_facility ON team_member_facility_coverage(facility_id);
CREATE INDEX IF NOT EXISTS idx_tmfc_active ON team_member_facility_coverage(active);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tmfc_user_facility_active
  ON team_member_facility_coverage(user_id, facility_id) WHERE active;
