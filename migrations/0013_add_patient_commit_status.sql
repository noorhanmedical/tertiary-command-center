-- Hybrid commit flow for patient screenings (Task #266).
--
-- Status pipeline: Draft → Ready → WithScheduler → Scheduled.
--   Draft         — added to schedule, not yet committed; never visible
--                   to outreach schedulers.
--   Ready         — committed (auto on AI analyze, or manual "Send to
--                   Schedulers"); visible in scheduler call lists.
--   WithScheduler — scheduler has touched the patient (called, left
--                   message, etc.) but no appointment yet.
--   Scheduled    — appointment booked.
--
-- A short recall window (5 minutes) lets the adder undo a commit; the
-- window is enforced server-side using committed_at.

ALTER TABLE patient_screenings
  ADD COLUMN IF NOT EXISTS commit_status TEXT NOT NULL DEFAULT 'Draft',
  ADD COLUMN IF NOT EXISTS committed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS committed_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL;

-- Backfill commit_status for existing rows so legacy patients don't
-- vanish from scheduler views the moment this ships.
UPDATE patient_screenings
SET commit_status = CASE
  WHEN LOWER(COALESCE(appointment_status, '')) IN ('scheduled', 'booked')
    THEN 'Scheduled'
  WHEN LOWER(COALESCE(appointment_status, '')) <> 'pending'
    AND COALESCE(appointment_status, '') <> ''
    THEN 'WithScheduler'
  WHEN status = 'completed'
    THEN 'Ready'
  ELSE 'Draft'
END,
committed_at = CASE
  WHEN status = 'completed' OR LOWER(COALESCE(appointment_status, '')) <> 'pending'
    THEN COALESCE(committed_at, created_at)
  ELSE committed_at
END
WHERE commit_status = 'Draft';

CREATE INDEX IF NOT EXISTS idx_patient_screenings_commit_status
  ON patient_screenings (commit_status);
CREATE INDEX IF NOT EXISTS idx_patient_screenings_committed_at
  ON patient_screenings (committed_at);
