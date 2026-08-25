-- Phase 3 — Plexus Clinical Findings
-- Structured AI-found and human-confirmed clinical findings with full provenance.
-- NOT gated behind a feature flag at the schema level.

CREATE TABLE IF NOT EXISTS plexus_clinical_findings (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
  global_plexus_patient_id INTEGER REFERENCES global_plexus_patients(id) ON DELETE SET NULL,
  patient_screening_id INTEGER REFERENCES patient_screenings(id) ON DELETE SET NULL,
  facility_id TEXT,

  -- Clinical content
  finding_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  normalized_concept TEXT,
  suggested_icd10 TEXT,
  confirmed_icd10 TEXT,

  -- Provenance / source
  source_type TEXT NOT NULL,
  source_record_id TEXT,
  source_date TEXT,
  source_excerpt TEXT,
  source_value TEXT,

  -- AI metadata
  confidence TEXT,
  ai_model TEXT,
  analysis_run_id INTEGER,

  -- Review state
  review_status TEXT NOT NULL DEFAULT 'ai_found',
  reviewed_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP,
  review_note TEXT,

  -- Lifecycle
  created_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pcf_clinic ON plexus_clinical_findings(clinic_id);
CREATE INDEX IF NOT EXISTS idx_pcf_global_patient ON plexus_clinical_findings(global_plexus_patient_id);
CREATE INDEX IF NOT EXISTS idx_pcf_screening ON plexus_clinical_findings(patient_screening_id);
CREATE INDEX IF NOT EXISTS idx_pcf_facility ON plexus_clinical_findings(facility_id);
CREATE INDEX IF NOT EXISTS idx_pcf_finding_type ON plexus_clinical_findings(finding_type);
CREATE INDEX IF NOT EXISTS idx_pcf_source_type ON plexus_clinical_findings(source_type);
CREATE INDEX IF NOT EXISTS idx_pcf_review_status ON plexus_clinical_findings(review_status);
CREATE INDEX IF NOT EXISTS idx_pcf_suggested_icd10 ON plexus_clinical_findings(suggested_icd10);
CREATE INDEX IF NOT EXISTS idx_pcf_analysis_run ON plexus_clinical_findings(analysis_run_id);
