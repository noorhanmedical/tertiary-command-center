-- Soft-delete fields for patient_screenings.
--
-- A patient with deleted_at IS NOT NULL is hidden from every normal
-- workspace/calendar/analysis query. delete_expires_at is the cutoff
-- after which restore is no longer offered (default 14 days from
-- delete time). All four fields are populated together by the
-- soft-delete repository method and cleared together by restore.

ALTER TABLE patient_screenings
  ADD COLUMN IF NOT EXISTS deleted_at timestamp,
  ADD COLUMN IF NOT EXISTS deleted_by_user_id varchar
    REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delete_expires_at timestamp,
  ADD COLUMN IF NOT EXISTS delete_reason text;

CREATE INDEX IF NOT EXISTS idx_patient_screenings_deleted_at
  ON patient_screenings(deleted_at);
CREATE INDEX IF NOT EXISTS idx_patient_screenings_delete_expires_at
  ON patient_screenings(delete_expires_at);
