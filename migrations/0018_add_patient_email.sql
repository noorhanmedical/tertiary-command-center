-- Add email column to patient_screenings so the scheduler portal's
-- communication hub can deliver real outbound email to patients.
ALTER TABLE patient_screenings
  ADD COLUMN IF NOT EXISTS email text;
