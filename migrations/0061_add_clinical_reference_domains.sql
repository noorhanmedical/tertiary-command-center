-- Phase 11 — Canonical clinical reference domains for the Patient EHR chart.
-- ADDITIVE ONLY: six new tables + additive provenance columns on
-- patient_test_history. No existing column/table is dropped or altered
-- destructively. Safe to run against production (all guards are IF NOT EXISTS).
--
-- These tables replace the client-side demo enrichment (demoPatientData.ts)
-- for providers / allergies / labs / imaging / vitals / encounters with real,
-- DB-backed rows served by GET /api/patients/:screeningId/clinical-data.

-- ── 1. Providers / care team ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_clinical_providers (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
  patient_screening_id INTEGER REFERENCES patient_screenings(id) ON DELETE CASCADE,
  patient_name TEXT NOT NULL,
  patient_dob TEXT,
  name TEXT NOT NULL,
  role TEXT,
  facility TEXT,
  provider_type TEXT,
  source TEXT NOT NULL DEFAULT 'eCW',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_patient_clinical_providers_screening ON patient_clinical_providers(patient_screening_id);
CREATE INDEX IF NOT EXISTS idx_patient_clinical_providers_name ON patient_clinical_providers(patient_name);

-- ── 2. Allergies ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_allergies (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
  patient_screening_id INTEGER REFERENCES patient_screenings(id) ON DELETE CASCADE,
  patient_name TEXT NOT NULL,
  patient_dob TEXT,
  substance TEXT NOT NULL,
  reaction TEXT,
  severity TEXT,
  source TEXT NOT NULL DEFAULT 'eCW',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_patient_allergies_screening ON patient_allergies(patient_screening_id);
CREATE INDEX IF NOT EXISTS idx_patient_allergies_name ON patient_allergies(patient_name);

-- ── 3. Labs (panel-grouped analytes) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_labs (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
  patient_screening_id INTEGER REFERENCES patient_screenings(id) ON DELETE CASCADE,
  patient_name TEXT NOT NULL,
  patient_dob TEXT,
  panel TEXT,
  name TEXT NOT NULL,
  value TEXT,
  unit TEXT,
  reference_range TEXT,
  collected_at TEXT,
  flag TEXT,
  source TEXT NOT NULL DEFAULT 'eCW',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_patient_labs_screening ON patient_labs(patient_screening_id);
CREATE INDEX IF NOT EXISTS idx_patient_labs_name ON patient_labs(patient_name);
CREATE INDEX IF NOT EXISTS idx_patient_labs_panel ON patient_labs(panel);

-- ── 4. Imaging studies ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_imaging_studies (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
  patient_screening_id INTEGER REFERENCES patient_screenings(id) ON DELETE CASCADE,
  patient_name TEXT NOT NULL,
  patient_dob TEXT,
  study TEXT NOT NULL,
  modality TEXT,
  performed_at TEXT,
  status TEXT,
  impression TEXT,
  source TEXT NOT NULL DEFAULT 'eCW',
  report_available BOOLEAN NOT NULL DEFAULT FALSE,
  report_document_reference_id INTEGER,
  service_type TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_patient_imaging_screening ON patient_imaging_studies(patient_screening_id);
CREATE INDEX IF NOT EXISTS idx_patient_imaging_name ON patient_imaging_studies(patient_name);

-- ── 5. Vitals ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_vitals (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
  patient_screening_id INTEGER REFERENCES patient_screenings(id) ON DELETE CASCADE,
  patient_name TEXT NOT NULL,
  patient_dob TEXT,
  label TEXT NOT NULL,
  value TEXT,
  unit TEXT,
  measured_at TEXT,
  source TEXT NOT NULL DEFAULT 'eCW',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_patient_vitals_screening ON patient_vitals(patient_screening_id);
CREATE INDEX IF NOT EXISTS idx_patient_vitals_name ON patient_vitals(patient_name);

-- ── 6. Encounters / clinical notes ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_encounters (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
  patient_screening_id INTEGER REFERENCES patient_screenings(id) ON DELETE CASCADE,
  patient_name TEXT NOT NULL,
  patient_dob TEXT,
  title TEXT NOT NULL,
  kind TEXT,
  occurred_at TEXT,
  provider TEXT,
  summary TEXT,
  note_body TEXT,
  category TEXT,
  tags JSONB,
  source TEXT NOT NULL DEFAULT 'eCW',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_patient_encounters_screening ON patient_encounters(patient_screening_id);
CREATE INDEX IF NOT EXISTS idx_patient_encounters_name ON patient_encounters(patient_name);
CREATE INDEX IF NOT EXISTS idx_patient_encounters_occurred ON patient_encounters(occurred_at);

-- ── Additive provenance columns on patient_test_history ───────────────────
ALTER TABLE patient_test_history ADD COLUMN IF NOT EXISTS service_type TEXT;
ALTER TABLE patient_test_history ADD COLUMN IF NOT EXISTS episode_sequence INTEGER;
ALTER TABLE patient_test_history ADD COLUMN IF NOT EXISTS result_summary TEXT;
ALTER TABLE patient_test_history ADD COLUMN IF NOT EXISTS report_available BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE patient_test_history ADD COLUMN IF NOT EXISTS report_document_reference_id INTEGER;
ALTER TABLE patient_test_history ADD COLUMN IF NOT EXISTS procedure_note_id INTEGER;
ALTER TABLE patient_test_history ADD COLUMN IF NOT EXISTS patient_screening_id INTEGER;
ALTER TABLE patient_test_history ADD COLUMN IF NOT EXISTS execution_case_id INTEGER;
