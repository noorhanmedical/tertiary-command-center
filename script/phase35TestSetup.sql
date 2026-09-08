-- Minimal schema for the DISPOSABLE Phase 3.5 access-control runtime test DB.
-- Same base as Phase 3 (clinics + full users) PLUS a billing_records stub so
-- resource-ownership (clinic) scope can be exercised. The 10 access tables +
-- organizations are then created by migrations/0079 on top of this.
-- NEVER run against a real database.

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

-- Minimal billing_records stub for resource-ownership scope tests. Only the
-- columns the scope resolver reads are needed (id + clinic_id).
CREATE TABLE IF NOT EXISTS billing_records (
  id         SERIAL PRIMARY KEY,
  clinic_id  INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
  service    TEXT,
  patient_name TEXT
);
INSERT INTO billing_records (id, clinic_id, service, patient_name)
  VALUES (1001, 1, 'ultrasound', 'Test A'), (1002, 2, 'ultrasound', 'Test B')
  ON CONFLICT (id) DO NOTHING;
