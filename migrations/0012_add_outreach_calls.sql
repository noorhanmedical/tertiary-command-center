-- Persistent log of every outreach call attempt — drives the scheduler
-- portal's call list, priority sort, header metrics and per-row timeline.
-- Created by Task #259.

CREATE TABLE IF NOT EXISTS outreach_calls (
  id SERIAL PRIMARY KEY,
  patient_screening_id INTEGER NOT NULL
    REFERENCES patient_screenings(id) ON DELETE CASCADE,
  scheduler_user_id VARCHAR
    REFERENCES users(id) ON DELETE SET NULL,
  outcome TEXT NOT NULL,
  notes TEXT,
  callback_at TIMESTAMP,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  duration_seconds INTEGER,
  started_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outreach_calls_patient_started
  ON outreach_calls (patient_screening_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_outreach_calls_scheduler_started
  ON outreach_calls (scheduler_user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_outreach_calls_callback_due
  ON outreach_calls (callback_at)
  WHERE callback_at IS NOT NULL;
