-- Phase 4D (Team Ops) — wire plexus_tasks.assigned_team_id to canonical teams.
--
-- The column was added in Phase 2 (migration 0066) without a foreign key
-- (canonical teams did not exist yet). Now that teams exist (0069), add the
-- FK so a team-assigned task references a real team. ON DELETE SET NULL keeps
-- the task if its team is ever removed (task falls back to unassigned/pool).
-- Idempotent: only add the constraint when it is not already present.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'plexus_tasks_assigned_team_id_teams_id_fk'
      AND table_name = 'plexus_tasks'
  ) THEN
    ALTER TABLE plexus_tasks
      ADD CONSTRAINT plexus_tasks_assigned_team_id_teams_id_fk
      FOREIGN KEY (assigned_team_id) REFERENCES teams(id) ON DELETE SET NULL;
  END IF;
END $$;
