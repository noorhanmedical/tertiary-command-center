-- Phase 5 — Note Addenda table.
-- Supports traceable addenda (e.g., Screening Form findings appended to a
-- signed Order Note) without mutating the signed parent document.
-- The parent_note_id references procedure_notes (the canonical document
-- lifecycle table that holds both order_notes and post_procedure_notes).

CREATE TABLE IF NOT EXISTS note_addenda (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
  parent_note_id INTEGER NOT NULL REFERENCES procedure_notes(id) ON DELETE CASCADE,
  ancillary_case_id INTEGER,
  patient_screening_id INTEGER REFERENCES patient_screenings(id) ON DELETE SET NULL,

  -- Content
  addendum_type TEXT NOT NULL DEFAULT 'screening_addendum',
  title TEXT,
  content TEXT NOT NULL,
  structured_data JSONB DEFAULT '{}',

  -- Source provenance
  source_type TEXT,
  source_record_id TEXT,

  -- Authorship
  author_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,

  -- Signature (optional — some addenda may require clinician sign-off)
  requires_signature BOOLEAN NOT NULL DEFAULT false,
  signature_status TEXT,
  signed_at TIMESTAMP,
  signed_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,

  -- Lifecycle
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_na_parent_note ON note_addenda(parent_note_id);
CREATE INDEX IF NOT EXISTS idx_na_ancillary_case ON note_addenda(ancillary_case_id);
CREATE INDEX IF NOT EXISTS idx_na_screening ON note_addenda(patient_screening_id);
CREATE INDEX IF NOT EXISTS idx_na_addendum_type ON note_addenda(addendum_type);
CREATE INDEX IF NOT EXISTS idx_na_signature_status ON note_addenda(signature_status);
