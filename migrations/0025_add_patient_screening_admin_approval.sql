-- Admin approval gate fields on patient_screenings.
--
-- Sending a patient to Engagement requires admin sign-off. The
-- existing backend `commitPatient` validation (name/dob/phone) stays
-- in place — this adds a second canonical gate so an admin must
-- explicitly approve before the patient can flow into the engagement
-- spine.
--
-- Default `pending` so every newly imported patient requires explicit
-- approval. Existing patients also start as `pending` after this
-- migration; an admin can run a one-time approval pass.

ALTER TABLE patient_screenings
  ADD COLUMN IF NOT EXISTS admin_approval_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS admin_approved_at timestamp,
  ADD COLUMN IF NOT EXISTS admin_approved_by_user_id varchar
    REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_approval_note text;

CREATE INDEX IF NOT EXISTS idx_patient_screenings_admin_approval_status
  ON patient_screenings(admin_approval_status);
