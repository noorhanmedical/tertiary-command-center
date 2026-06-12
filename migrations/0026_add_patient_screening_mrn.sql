-- Add Medical Record Number (MRN) to patient_screenings.
--
-- Lets the Patient Directory identity helper use tier 1
-- (facility + MRN + DOB) when the importer carries an MRN. Tier 2
-- (MRN + DOB) and tier 3 (name + DOB + phone) continue to work for
-- rows that don't have an MRN. Nullable + indexed; no backfill
-- required.

ALTER TABLE patient_screenings
  ADD COLUMN IF NOT EXISTS mrn text;

CREATE INDEX IF NOT EXISTS idx_patient_screenings_mrn
  ON patient_screenings(mrn);
