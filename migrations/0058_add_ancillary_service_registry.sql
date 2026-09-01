-- Phase 4 — Ancillary Service Registry + Facility Service Settings
-- Centralizes all service definitions. No feature flag gate.

CREATE TABLE IF NOT EXISTS ancillary_service_registry (
  id SERIAL PRIMARY KEY,
  internal_code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  anatomic_region TEXT,
  active BOOLEAN NOT NULL DEFAULT true,

  -- Billing / coding
  cpt_code TEXT,
  hcpcs_code TEXT,
  cpt_confirmed BOOLEAN NOT NULL DEFAULT false,

  -- Qualification criteria (structured JSON arrays)
  qualifying_diagnoses JSONB DEFAULT '[]',
  relevant_icd10_codes JSONB DEFAULT '[]',
  relevant_medications JSONB DEFAULT '[]',
  relevant_symptoms JSONB DEFAULT '[]',
  relevant_lab_findings JSONB DEFAULT '[]',
  relevant_imaging_findings JSONB DEFAULT '[]',
  relevant_encounter_findings JSONB DEFAULT '[]',
  inclusion_criteria JSONB DEFAULT '[]',
  exclusion_criteria JSONB DEFAULT '[]',

  -- AI instructions per qualification mode
  ai_instructions_permissive TEXT,
  ai_instructions_standard TEXT,
  ai_instructions_conservative TEXT,

  -- Cooldown rules
  cooldown_months_medicare INTEGER,
  cooldown_months_ppo INTEGER,
  cooldown_months_other INTEGER,

  -- Document requirements
  requires_consent BOOLEAN NOT NULL DEFAULT true,
  requires_screening_form BOOLEAN NOT NULL DEFAULT true,
  requires_report BOOLEAN NOT NULL DEFAULT true,
  requires_order_signature BOOLEAN NOT NULL DEFAULT true,
  requires_procedure_note_signature BOOLEAN NOT NULL DEFAULT true,

  -- Billing blockers
  billing_blockers JSONB DEFAULT '[]',

  -- Display
  sort_order INTEGER NOT NULL DEFAULT 0,

  -- Lifecycle
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_asr_internal_code ON ancillary_service_registry(internal_code);
CREATE INDEX IF NOT EXISTS idx_asr_category ON ancillary_service_registry(category);
CREATE INDEX IF NOT EXISTS idx_asr_active ON ancillary_service_registry(active);
CREATE INDEX IF NOT EXISTS idx_asr_cpt ON ancillary_service_registry(cpt_code);

-- Facility-level service enablement
CREATE TABLE IF NOT EXISTS facility_service_settings (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  service_code TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  qualification_mode_override TEXT,
  cooldown_months_override INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fss_clinic_service ON facility_service_settings(clinic_id, service_code);
CREATE INDEX IF NOT EXISTS idx_fss_clinic ON facility_service_settings(clinic_id);
CREATE INDEX IF NOT EXISTS idx_fss_service ON facility_service_settings(service_code);

-- Seed the registry with all 11 current Plexus ancillary services.
-- CPT codes listed per spec; cpt_confirmed=false until coding team validates.
INSERT INTO ancillary_service_registry (internal_code, display_name, category, anatomic_region, cpt_code, cooldown_months_medicare, cooldown_months_ppo, sort_order) VALUES
  ('BrainWave', 'BrainWave', 'neurocognitive', 'brain', NULL, 12, 6, 1),
  ('VitalWave', 'VitalWave', 'autonomic', 'autonomic', NULL, 12, 6, 2),
  ('Bilateral Carotid Duplex', 'Bilateral Carotid Duplex', 'vascular_carotid', 'carotid', '93880', 12, 6, 3),
  ('Echocardiogram TTE', 'Complete Transthoracic Echocardiogram', 'cardiac', 'heart', '93306', 12, 6, 4),
  ('Renal Artery Doppler', 'Renal Artery Duplex — Complete', 'vascular_renal', 'renal', '93975', 12, 6, 5),
  ('Lower Extremity Arterial Doppler', 'Lower Extremity Arterial Duplex — Complete Bilateral', 'vascular_lower_arterial', 'lower_extremity', '93925', 12, 6, 6),
  ('Upper Extremity Arterial Doppler', 'Upper Extremity Arterial Duplex — Complete Bilateral', 'vascular_upper_arterial', 'upper_extremity', '93930', 12, 6, 7),
  ('Lower Extremity Venous Duplex', 'Lower Extremity Venous Duplex — Complete Bilateral', 'vascular_lower_venous', 'lower_extremity', '93970', 12, 6, 8),
  ('Upper Extremity Venous Duplex', 'Upper Extremity Venous Duplex — Complete Bilateral', 'vascular_upper_venous', 'upper_extremity', '93970', 12, 6, 9),
  ('Stress Echocardiogram', 'Stress Echocardiogram', 'stress_cardiac', 'heart', '93350', 12, 6, 10),
  ('Abdominal Aortic Aneurysm Duplex', 'Complete Aortoiliac / AAA Duplex', 'vascular_aortic', 'aorta', '93978', 12, 6, 11)
ON CONFLICT (internal_code) DO NOTHING;
