-- Phase 4A (Team Ops) — canonical teams, memberships, manager relationships,
-- and a relationship-change audit ledger (decisions K4, K25, K26).
--
-- Additive only. Idempotent (IF NOT EXISTS). Concurrency-safe: PARTIAL UNIQUE
-- indexes enforce one ACTIVE membership per (team,user), one ACTIVE team
-- manager per (manager,team), and one ACTIVE user-scoped manager override per
-- (manager,subordinate) — historical inactive rows may accumulate freely.

CREATE TABLE IF NOT EXISTS teams (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'custom',
  facility_id TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_teams_slug ON teams(slug);
CREATE INDEX IF NOT EXISTS idx_teams_type ON teams(type);
CREATE INDEX IF NOT EXISTS idx_teams_active ON teams(active);

CREATE TABLE IF NOT EXISTS team_memberships (
  id              SERIAL PRIMARY KEY,
  team_id         INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id         VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membership_role TEXT NOT NULL DEFAULT 'member',
  primary_team    BOOLEAN NOT NULL DEFAULT FALSE,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  start_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_at          TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_team_memberships_team ON team_memberships(team_id);
CREATE INDEX IF NOT EXISTS idx_team_memberships_user ON team_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_team_memberships_active ON team_memberships(active);
-- One ACTIVE membership per (team,user); history rows (active=false) unrestricted.
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_memberships_active
  ON team_memberships(team_id, user_id) WHERE active;

CREATE TABLE IF NOT EXISTS manager_relationships (
  id                  SERIAL PRIMARY KEY,
  manager_user_id     VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_type          TEXT NOT NULL DEFAULT 'team',
  team_id             INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  subordinate_user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
  facility_id         TEXT,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  start_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_at              TIMESTAMP,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_manager_rel_manager ON manager_relationships(manager_user_id);
CREATE INDEX IF NOT EXISTS idx_manager_rel_team ON manager_relationships(team_id);
CREATE INDEX IF NOT EXISTS idx_manager_rel_subordinate ON manager_relationships(subordinate_user_id);
CREATE INDEX IF NOT EXISTS idx_manager_rel_active ON manager_relationships(active);
-- One ACTIVE team-scoped manager row per (manager, team).
CREATE UNIQUE INDEX IF NOT EXISTS uq_manager_rel_team_active
  ON manager_relationships(manager_user_id, team_id)
  WHERE active AND scope_type = 'team';
-- One ACTIVE user-scoped override per (manager, subordinate).
CREATE UNIQUE INDEX IF NOT EXISTS uq_manager_rel_user_active
  ON manager_relationships(manager_user_id, subordinate_user_id)
  WHERE active AND scope_type = 'user';

CREATE TABLE IF NOT EXISTS team_relationship_events (
  id              SERIAL PRIMARY KEY,
  event_type      TEXT NOT NULL,
  actor_user_id   VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  subject_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  team_id         INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  facility_id     TEXT,
  summary         TEXT NOT NULL,
  metadata        JSONB,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_team_rel_events_type ON team_relationship_events(event_type);
CREATE INDEX IF NOT EXISTS idx_team_rel_events_subject ON team_relationship_events(subject_user_id);
CREATE INDEX IF NOT EXISTS idx_team_rel_events_team ON team_relationship_events(team_id);
CREATE INDEX IF NOT EXISTS idx_team_rel_events_created ON team_relationship_events(created_at);
