-- Patient Directory: source-file linkage on screening_batches.
--
-- Today screening_batches stores the human-friendly batch name but not
-- the import file name or which user uploaded it. These additive columns
-- let the Patient Directory profile + audit trail show where a patient
-- came from. All columns nullable; no backfill required.

ALTER TABLE screening_batches
  ADD COLUMN IF NOT EXISTS source_file_name text,
  ADD COLUMN IF NOT EXISTS source_import_id text,
  ADD COLUMN IF NOT EXISTS source_importer_user_id varchar
    REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_screening_batches_source_importer
  ON screening_batches(source_importer_user_id);
