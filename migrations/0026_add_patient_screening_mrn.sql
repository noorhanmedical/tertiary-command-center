-- Add MRN / Patient ID column to patient_screenings.
--
-- Before this migration the BatchFlow clinical-import parser
-- carried the MRN end-to-end but the backend insert buried it in
-- the notes text blob (buildClinicalImportNotes), making it
-- unqueryable and uneditable. The column promotes MRN to a
-- canonical Plexus IQ demographic field so Edit Patient,
-- PatientCard / PatientListRow, and the Admin Review Directory
-- tab can all read and persist it.
--
-- The notes blob still receives the MRN for backward
-- compatibility with existing rows (we don't backfill the new
-- column from notes here — the parser populates it going forward).
ALTER TABLE patient_screenings ADD COLUMN IF NOT EXISTS mrn text;
CREATE INDEX IF NOT EXISTS idx_patient_screenings_mrn ON patient_screenings(mrn);
