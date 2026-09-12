-- First-class source provenance for patient_screenings (additive).
--
-- Records which intake path created a patient row (manual, manual_paste,
-- bulk_import, plexus_iq, api, emr_import) as a proper column instead of
-- overloading `notes`. Source is provenance, NEVER identity — the same person
-- from Manual + Plexus IQ is ONE canonical patient. Nullable so every existing
-- row is unaffected; stamped going forward by the canonical patient write
-- service. Deploy applies schema via `drizzle-kit push` from shared/schema; this
-- file is the documented companion. Idempotent + safe on double-apply.

ALTER TABLE patient_screenings
  ADD COLUMN IF NOT EXISTS source_type text;

CREATE INDEX IF NOT EXISTS idx_patient_screenings_source_type
  ON patient_screenings(source_type);
