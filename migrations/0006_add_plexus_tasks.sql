-- Plexus Tasks Foundation
-- Adds 6 tables for the task management system: projects, tasks, collaborators, messages, events, reads.

CREATE TABLE IF NOT EXISTS "plexus_projects" (
  "id" serial PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "project_type" text DEFAULT 'operational' NOT NULL,
  "facility" text,
  "status" text DEFAULT 'active' NOT NULL,
  "created_by_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS "plexus_tasks" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer REFERENCES "plexus_projects"("id") ON DELETE SET NULL,
  "parent_task_id" integer REFERENCES "plexus_tasks"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "description" text,
  "task_type" text DEFAULT 'task' NOT NULL,
  "urgency" text DEFAULT 'none' NOT NULL,
  "priority" text DEFAULT 'normal' NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "assigned_to_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "created_by_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "patient_screening_id" integer REFERENCES "patient_screenings"("id") ON DELETE SET NULL,
  "due_date" text,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS "plexus_task_collaborators" (
  "id" serial PRIMARY KEY NOT NULL,
  "task_id" integer NOT NULL REFERENCES "plexus_tasks"("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" text DEFAULT 'collaborator' NOT NULL,
  "added_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS "plexus_task_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "task_id" integer NOT NULL REFERENCES "plexus_tasks"("id") ON DELETE CASCADE,
  "sender_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "body" text NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Immutable audit log: task_id and project_id use SET NULL so events survive deletes
CREATE TABLE IF NOT EXISTS "plexus_task_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "task_id" integer REFERENCES "plexus_tasks"("id") ON DELETE SET NULL,
  "project_id" integer REFERENCES "plexus_projects"("id") ON DELETE SET NULL,
  "user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "event_type" text NOT NULL,
  "payload" jsonb,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS "plexus_task_reads" (
  "id" serial PRIMARY KEY NOT NULL,
  "task_id" integer NOT NULL REFERENCES "plexus_tasks"("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "last_read_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Unique constraint for reads (one row per user per task)
CREATE UNIQUE INDEX IF NOT EXISTS "plexus_task_reads_task_user_idx" ON "plexus_task_reads"("task_id", "user_id");

-- Unique constraint for collaborators (one row per user per task)
CREATE UNIQUE INDEX IF NOT EXISTS "plexus_task_collaborators_task_user_idx" ON "plexus_task_collaborators"("task_id", "user_id");

-- Index for fast task lookups by assignee and creator
CREATE INDEX IF NOT EXISTS "plexus_tasks_assigned_idx" ON "plexus_tasks"("assigned_to_user_id");
CREATE INDEX IF NOT EXISTS "plexus_tasks_created_by_idx" ON "plexus_tasks"("created_by_user_id");
CREATE INDEX IF NOT EXISTS "plexus_tasks_project_idx" ON "plexus_tasks"("project_id");
CREATE INDEX IF NOT EXISTS "plexus_task_messages_task_idx" ON "plexus_task_messages"("task_id");
CREATE INDEX IF NOT EXISTS "plexus_task_events_task_idx" ON "plexus_task_events"("task_id");

-- DB-level check constraints for canonical enum-like fields
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plexus_tasks_task_type_check') THEN
    ALTER TABLE "plexus_tasks" ADD CONSTRAINT "plexus_tasks_task_type_check"
      CHECK (task_type IN ('task', 'subtask', 'milestone', 'approval'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plexus_tasks_urgency_check') THEN
    ALTER TABLE "plexus_tasks" ADD CONSTRAINT "plexus_tasks_urgency_check"
      CHECK (urgency IN ('none', 'EOD', 'within 3 hours', 'within 1 hour'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plexus_tasks_priority_check') THEN
    ALTER TABLE "plexus_tasks" ADD CONSTRAINT "plexus_tasks_priority_check"
      CHECK (priority IN ('low', 'normal', 'high'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plexus_tasks_status_check') THEN
    ALTER TABLE "plexus_tasks" ADD CONSTRAINT "plexus_tasks_status_check"
      CHECK (status IN ('open', 'in_progress', 'done', 'closed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plexus_task_collaborators_role_check') THEN
    ALTER TABLE "plexus_task_collaborators" ADD CONSTRAINT "plexus_task_collaborators_role_check"
      CHECK (role IN ('owner', 'assignee', 'collaborator', 'watcher'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plexus_projects_status_check') THEN
    ALTER TABLE "plexus_projects" ADD CONSTRAINT "plexus_projects_status_check"
      CHECK (status IN ('active', 'archived', 'closed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plexus_projects_type_check') THEN
    ALTER TABLE "plexus_projects" ADD CONSTRAINT "plexus_projects_type_check"
      CHECK (project_type IN ('operational', 'clinical', 'admin', 'training'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plexus_task_events_event_type_check') THEN
    ALTER TABLE "plexus_task_events" ADD CONSTRAINT "plexus_task_events_event_type_check"
      CHECK (event_type IN (
        'created', 'updated', 'deleted', 'status_changed', 'assignment_changed',
        'project_created', 'project_updated', 'project_deleted',
        'collaborator_added', 'collaborator_role_changed',
        'message_sent', 'read'
      ));
  END IF;
END $$;
