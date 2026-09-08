-- Disposable Phase 4A.5 HTTP-harness schema. Same base as Phase 4A plus billing
-- rows for scope tests. The 10 access tables + organizations come from 0079.
-- NEVER run against a real DB.

CREATE TABLE IF NOT EXISTS clinics (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Clinic',
  slug TEXT NOT NULL DEFAULT 'clinic',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  timezone TEXT DEFAULT 'America/Chicago',
  address TEXT, phone TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  short_name TEXT, facility_type TEXT, code TEXT
);
INSERT INTO clinics (id, name, slug) VALUES (1, 'Clinic One', 'clinic-one'), (2, 'Clinic Two', 'clinic-two')
  ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'clinician',
  active BOOLEAN NOT NULL DEFAULT true,
  clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
  email TEXT, first_name TEXT, last_name TEXT, display_name TEXT, job_title TEXT,
  status TEXT NOT NULL DEFAULT 'active', default_workspace TEXT,
  mfa_required BOOLEAN NOT NULL DEFAULT false, last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR, modified_by VARCHAR
);

CREATE TABLE IF NOT EXISTS billing_records (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
  service TEXT, patient_name TEXT, billing_status TEXT DEFAULT 'Not Billed',
  is_test BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO billing_records (id, clinic_id, service, patient_name)
  VALUES (5001, 1, 'ultrasound', 'Rec Clinic1'), (5002, 2, 'ultrasound', 'Rec Clinic2')
  ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ancillary_service_registry (
  id SERIAL PRIMARY KEY,
  internal_code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  category TEXT
);
INSERT INTO ancillary_service_registry (internal_code, display_name, active, category)
  VALUES ('ultrasound', 'Ultrasound', true, 'imaging'), ('brainwave', 'BrainWave', true, 'neuro')
  ON CONFLICT (internal_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
  user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  username TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT,
  changes JSONB, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- express-session table (connect-pg-simple style) is NOT needed: the harness
-- uses an in-memory session store.
