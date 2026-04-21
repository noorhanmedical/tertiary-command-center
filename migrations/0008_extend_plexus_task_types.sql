-- Extend Plexus task_type and event_type check constraints
-- Adds 'urgent_call' to task types and 'call_logged' to event types
-- for the scheduler communication layer (Task #176).

DO $$
BEGIN
  -- Drop and recreate task_type check to include 'urgent_call'
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plexus_tasks_task_type_check') THEN
    ALTER TABLE "plexus_tasks" DROP CONSTRAINT "plexus_tasks_task_type_check";
  END IF;
  ALTER TABLE "plexus_tasks" ADD CONSTRAINT "plexus_tasks_task_type_check"
    CHECK (task_type IN ('task', 'subtask', 'milestone', 'approval', 'urgent_call'));

  -- Drop and recreate event_type check to include 'call_logged'
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plexus_task_events_event_type_check') THEN
    ALTER TABLE "plexus_task_events" DROP CONSTRAINT "plexus_task_events_event_type_check";
  END IF;
  ALTER TABLE "plexus_task_events" ADD CONSTRAINT "plexus_task_events_event_type_check"
    CHECK (event_type IN (
      'created', 'updated', 'deleted', 'status_changed', 'assignment_changed',
      'project_created', 'project_updated', 'project_deleted',
      'collaborator_added', 'collaborator_role_changed',
      'message_sent', 'read', 'call_logged'
    ));
END $$;
