ALTER TABLE patient_screenings ADD COLUMN IF NOT EXISTS no_previous_tests boolean NOT NULL DEFAULT false;
