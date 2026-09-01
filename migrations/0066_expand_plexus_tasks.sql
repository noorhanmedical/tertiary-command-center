-- Phase 2 (Team Ops) — expand canonical plexus_tasks.
--
-- Additive only. Adds canonical case linkage, facility, team assignment,
-- explicit completion provenance, and a canonical P1..P5 priority level
-- (kept alongside the legacy low/normal/high `priority` for backward
-- compatibility). No existing column is dropped or renamed.

ALTER TABLE plexus_tasks ADD COLUMN IF NOT EXISTS priority_level TEXT;
ALTER TABLE plexus_tasks ADD COLUMN IF NOT EXISTS assigned_team_id INTEGER;
ALTER TABLE plexus_tasks ADD COLUMN IF NOT EXISTS execution_case_id INTEGER;
ALTER TABLE plexus_tasks ADD COLUMN IF NOT EXISTS ancillary_case_id INTEGER;
ALTER TABLE plexus_tasks ADD COLUMN IF NOT EXISTS facility_id TEXT;
ALTER TABLE plexus_tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
ALTER TABLE plexus_tasks ADD COLUMN IF NOT EXISTS completed_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_plexus_tasks_assigned_team ON plexus_tasks(assigned_team_id);
CREATE INDEX IF NOT EXISTS idx_plexus_tasks_priority_level ON plexus_tasks(priority_level);
CREATE INDEX IF NOT EXISTS idx_plexus_tasks_facility ON plexus_tasks(facility_id);
CREATE INDEX IF NOT EXISTS idx_plexus_tasks_execution_case ON plexus_tasks(execution_case_id);
CREATE INDEX IF NOT EXISTS idx_plexus_tasks_ancillary_case ON plexus_tasks(ancillary_case_id);

-- Backfill priority_level from the legacy priority so existing rows carry a
-- coherent canonical level (high→P2, normal→P3, low→P4). Only fills NULLs.
UPDATE plexus_tasks
   SET priority_level = CASE lower(coalesce(priority, 'normal'))
     WHEN 'high' THEN 'P2'
     WHEN 'low' THEN 'P4'
     ELSE 'P3'
   END
 WHERE priority_level IS NULL;

-- Backfill completion provenance for already-terminal rows so manager views
-- have a completedAt (best-effort: use updatedAt as the completion time).
UPDATE plexus_tasks
   SET completed_at = updated_at
 WHERE completed_at IS NULL AND status IN ('done', 'closed');
