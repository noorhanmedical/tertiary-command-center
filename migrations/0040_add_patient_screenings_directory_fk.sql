-- Migration 0040: Add patient_directory_id FK to patient_screenings (Batch 5b)
--
-- Adds a nullable FK from patient_screenings → patient_directory.
-- NULL = "not yet linked". The backfill script populates this for all
-- existing rows; new rows are linked at write time once dual-write is active.
--
-- Apply AFTER 0039. Run the backfill script after both migrations are applied.

ALTER TABLE patient_screenings
  ADD COLUMN IF NOT EXISTS patient_directory_id INTEGER
    REFERENCES patient_directory (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_patient_screenings_patient_directory_id
  ON patient_screenings (patient_directory_id);
