-- Phase 12 — Per-episode canonical document set + note version/diff lineage.
-- ADDITIVE ONLY. Two new tables; nothing existing is altered destructively.
--
-- patient_episode_documents: one row per document (order note, screening
-- addendum, procedure note, consent, screening form, test report, billing
-- document) scoped to a single service EPISODE (episode_key) so the Plexus
-- Notes & Documents section renders with zero cross-episode leakage.
--
-- patient_document_versions: append-only edit lineage + structured diff for
-- clinician-editable notes (AI-generated -> admin -> clinician -> signed).

CREATE TABLE IF NOT EXISTS patient_episode_documents (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
  patient_screening_id INTEGER REFERENCES patient_screenings(id) ON DELETE CASCADE,
  patient_name TEXT NOT NULL,
  service_type TEXT NOT NULL,
  episode_key TEXT NOT NULL,
  episode_label TEXT,
  episode_date TEXT,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  document_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT,
  body_text TEXT,
  structured_data JSONB,
  created_date TEXT,
  sent_date TEXT,
  completed_date TEXT,
  signed_date TEXT,
  finalized_date TEXT,
  author_name TEXT,
  completed_by_name TEXT,
  signer_name TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ped_screening ON patient_episode_documents(patient_screening_id);
CREATE INDEX IF NOT EXISTS idx_ped_service_episode ON patient_episode_documents(service_type, episode_key);
CREATE INDEX IF NOT EXISTS idx_ped_doc_type ON patient_episode_documents(document_type);

CREATE TABLE IF NOT EXISTS patient_document_versions (
  id SERIAL PRIMARY KEY,
  episode_document_id INTEGER REFERENCES patient_episode_documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  author_role TEXT,
  author_name TEXT,
  label TEXT NOT NULL,
  body_text TEXT,
  changes JSONB,
  is_signed BOOLEAN NOT NULL DEFAULT FALSE,
  created_date TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pdv_document ON patient_document_versions(episode_document_id);
