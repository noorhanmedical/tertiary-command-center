-- Add assigned_scheduler_id to screening_batches for scheduler assignment tracking
ALTER TABLE screening_batches ADD COLUMN IF NOT EXISTS assigned_scheduler_id integer REFERENCES outreach_schedulers(id) ON DELETE SET NULL;

-- Add user_id to outreach_schedulers to link schedulers to platform user accounts
ALTER TABLE outreach_schedulers ADD COLUMN IF NOT EXISTS user_id varchar REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_outreach_schedulers_user_id ON outreach_schedulers(user_id);

-- Add batch_id to plexus_tasks for explicit relational linkage of scheduler assignment tasks to batches
ALTER TABLE plexus_tasks ADD COLUMN IF NOT EXISTS batch_id integer REFERENCES screening_batches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_plexus_tasks_batch_id ON plexus_tasks(batch_id);
