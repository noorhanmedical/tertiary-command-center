-- Track when each invoice was last surfaced as overdue so the daily
-- reminder job can throttle and avoid duplicate Plexus tasks.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS last_reminded_at timestamp;

-- Extend Plexus task_type check constraint to include the background-job
-- alert types ('absence_alert' was already in use by absenceWatcher but
-- never added to the constraint, and 'invoice_reminder' is new in #310).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plexus_tasks_task_type_check') THEN
    ALTER TABLE "plexus_tasks" DROP CONSTRAINT "plexus_tasks_task_type_check";
  END IF;
  ALTER TABLE "plexus_tasks" ADD CONSTRAINT "plexus_tasks_task_type_check"
    CHECK (task_type IN (
      'task', 'subtask', 'milestone', 'approval',
      'urgent_call', 'scheduler_assignment', 'tech_assignment',
      'absence_alert', 'invoice_reminder'
    ));
END $$;
