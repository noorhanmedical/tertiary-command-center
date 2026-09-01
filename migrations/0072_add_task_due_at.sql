-- Phase 5B (Team Ops) — real timestamp SLA for tasks.
--
-- Additive, idempotent. plexus_tasks.due_date is TEXT (YYYY-MM-DD), so
-- time-sensitive overdue/P-level SLA relies on string comparison and cannot
-- express a time-of-day deadline. Add a real timestamptz `due_at`. due_date is
-- PRESERVED for backward compatibility; new workflow writes due_at. Backfill
-- due_at from existing due_date (end-of-day UTC) so current rows keep working.

ALTER TABLE plexus_tasks ADD COLUMN IF NOT EXISTS due_at TIMESTAMP;

-- Backfill: interpret an existing YYYY-MM-DD due_date as end-of-day so a task
-- due "today" is not treated as already overdue at 00:00. Only fills NULLs.
UPDATE plexus_tasks
   SET due_at = (due_date || ' 23:59:59')::timestamp
 WHERE due_at IS NULL
   AND due_date IS NOT NULL
   AND due_date ~ '^\d{4}-\d{2}-\d{2}$';

CREATE INDEX IF NOT EXISTS idx_plexus_tasks_due_at ON plexus_tasks(due_at);
