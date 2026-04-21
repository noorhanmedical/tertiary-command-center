CREATE TABLE IF NOT EXISTS analysis_jobs (
  id serial PRIMARY KEY,
  batch_id integer NOT NULL REFERENCES screening_batches(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running',
  total_patients integer NOT NULL,
  completed_patients integer NOT NULL DEFAULT 0,
  error_message text,
  started_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  completed_at timestamp
);
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_batch_id ON analysis_jobs(batch_id);
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_status ON analysis_jobs(status);
