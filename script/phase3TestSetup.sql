-- Minimal schema for the DISPOSABLE Phase 3 access-control runtime test DB.
-- Creates only what AccessContextService + the catalog seed touch: a `clinics`
-- stub and the full `users` table (matching shared/schema/users.ts). The 10
-- access tables + organizations + the clinics.organization_id column are then
-- created by applying migrations/0079_add_access_control.sql on top of this.
--
-- NEVER run against a real database. Orchestrated only against
-- plexus_access_phase3_test by script/runPhase3DbTest.sh.

CREATE TABLE IF NOT EXISTS clinics (
  id   SERIAL PRIMARY KEY,
  name TEXT
);
INSERT INTO clinics (id, name) VALUES (1, 'Clinic One'), (2, 'Clinic Two')
  ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  username         TEXT NOT NULL UNIQUE,
  password         TEXT NOT NULL,
  role             TEXT NOT NULL DEFAULT 'clinician',
  active           BOOLEAN NOT NULL DEFAULT true,
  clinic_id        INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
  email            TEXT,
  first_name       TEXT,
  last_name        TEXT,
  display_name     TEXT,
  job_title        TEXT,
  status           TEXT NOT NULL DEFAULT 'active',
  default_workspace TEXT,
  mfa_required     BOOLEAN NOT NULL DEFAULT false,
  last_login_at    TIMESTAMP,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by       VARCHAR,
  modified_by      VARCHAR
);
