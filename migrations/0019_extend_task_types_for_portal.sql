-- Extend Plexus task_type check constraint to include 'tech_assignment' and
-- 'scheduler_assignment' for the technician/liaison portal (Task #292).
-- These task types are produced by the in-clinic portals when consent or
-- scheduler assignments need attention. Both must be allowed at the DB level
-- so the today-schedule endpoint can side-effect-create them.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plexus_tasks_task_type_check') THEN
    ALTER TABLE "plexus_tasks" DROP CONSTRAINT "plexus_tasks_task_type_check";
  END IF;
  ALTER TABLE "plexus_tasks" ADD CONSTRAINT "plexus_tasks_task_type_check"
    CHECK (task_type IN (
      'task', 'subtask', 'milestone', 'approval',
      'urgent_call', 'scheduler_assignment', 'tech_assignment'
    ));
END $$;
