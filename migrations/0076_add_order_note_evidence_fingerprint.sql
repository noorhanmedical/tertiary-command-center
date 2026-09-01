-- Slice A1 — canonical Order Note evidence fingerprint + evaluated screening
-- version. ADDITIVE-ONLY. DO NOT RUN AUTOMATICALLY.
--
-- Adds two nullable columns to procedure_notes (which holds order_note and
-- post_procedure_note rows). Only the canonical Order Note refresh writes
-- them; legacy/other rows stay NULL.
--
--   • evidence_fingerprint
--       Order Note EVIDENCE fingerprint — a hash of the PROJECTED clinical
--       evidence rendered into the note (distinct from the FULL screening
--       evidence version stored on case_document_readiness.metadata). Same
--       projected evidence ⇒ same fingerprint ⇒ no new version.
--   • evaluated_screening_evidence_version
--       The FULL screening evidence version (screeningEvidenceVersion) that
--       this Order Note was last evaluated against. The signing gate (Slice C)
--       requires this to equal the CURRENT completed screening version — so a
--       clinician can never sign a note that has not been evaluated against
--       the current screening.
--
-- Rollback (safe while FEATURE_ORDER_NOTE_REFRESH is OFF and unused):
--   ALTER TABLE procedure_notes DROP COLUMN IF EXISTS evidence_fingerprint;
--   ALTER TABLE procedure_notes DROP COLUMN IF EXISTS evaluated_screening_evidence_version;

ALTER TABLE procedure_notes
  ADD COLUMN IF NOT EXISTS evidence_fingerprint                 TEXT,
  ADD COLUMN IF NOT EXISTS evaluated_screening_evidence_version TEXT;

CREATE INDEX IF NOT EXISTS idx_pn_evidence_fingerprint ON procedure_notes(evidence_fingerprint);
