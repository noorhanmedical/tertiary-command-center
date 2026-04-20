-- scheduler_assignments table — engine-driven daily call list ownership.
-- Lineage source/original_scheduler_id columns track redistribution
-- (PTO/absence/manual). Only one row may be active per (patient,day).
CREATE TABLE IF NOT EXISTS scheduler_assignments (
  id serial PRIMARY KEY,
  patient_screening_id integer NOT NULL REFERENCES patient_screenings(id) ON DELETE CASCADE,
  scheduler_id integer NOT NULL REFERENCES outreach_schedulers(id) ON DELETE CASCADE,
  as_of_date text NOT NULL,
  assigned_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source text NOT NULL DEFAULT 'auto',
  original_scheduler_id integer REFERENCES outreach_schedulers(id) ON DELETE SET NULL,
  reason text,
  status text NOT NULL DEFAULT 'active',
  completed_at timestamp
);

CREATE INDEX IF NOT EXISTS idx_scheduler_assignments_scheduler_status
  ON scheduler_assignments (scheduler_id, status);
CREATE INDEX IF NOT EXISTS idx_scheduler_assignments_patient_status
  ON scheduler_assignments (patient_screening_id, status);
CREATE INDEX IF NOT EXISTS idx_scheduler_assignments_as_of_date
  ON scheduler_assignments (as_of_date);

-- Hard invariant: at most one ACTIVE assignment per (patient, day).
-- Released/completed/reassigned rows do not count, so historical lineage
-- is preserved while preventing duplicate active ownership under race.
CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduler_assignments_active_per_patient_day
  ON scheduler_assignments (patient_screening_id, as_of_date)
  WHERE status = 'active';
