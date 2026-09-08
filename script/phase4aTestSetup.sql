-- Minimal schema for the DISPOSABLE Phase 4A access-management runtime test DB.
-- clinics + full users + billing_records stub + a minimal ancillary_service_registry
-- stub (only the columns accessAdminService reads). The 10 access tables +
-- organizations come from migrations/0079 on top. NEVER run against a real DB.

CREATE TABLE IF NOT EXISTS clinics (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Clinic',
  slug TEXT NOT NULL DEFAULT 'clinic',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  timezone TEXT DEFAULT 'America/Chicago',
  address TEXT,
  phone TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  short_name TEXT,
  facility_type TEXT,
  code TEXT
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
  service TEXT, patient_name TEXT
);

-- Minimal ancillary_service_registry stub (only the columns the access
-- service reads: internal_code, display_name, active, category).
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

-- audit_log (from an earlier migration in the real DB; created here for the
-- disposable test so access-mutation audit writes succeed).
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
  user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  username TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  changes JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
