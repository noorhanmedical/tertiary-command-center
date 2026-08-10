-- Rollback for migration 0041: EMR Encounter ingestion on global_schedule_events
--
-- Per migration-policy ADR §5: rollback scripts are NOT auto-applied. An
-- operator runs this manually to revert the 0041 additive change if a slice
-- causes a regression in staging.
--
-- Safe to run: only removes the EMR-sourced rows and the columns/indexes
-- added by 0041. All manual / screening_commit / ancillary rows are untouched
-- (they carry external_source_system = NULL and a different source).
--
-- Order matters: delete EMR rows first, then drop indexes, then columns.

-- 1. Remove only the rows this feature wrote (EMR + healow-booking sourced).
DELETE FROM global_schedule_events
  WHERE external_source_system IN ('ecw_fhir_bulk', 'healow_booking');

-- 2. Drop the indexes added by 0041.
DROP INDEX IF EXISTS gse_external_encounter_idx;
DROP INDEX IF EXISTS gse_patient_directory_id_idx;

-- 3. Drop the columns added by 0041.
ALTER TABLE global_schedule_events
  DROP COLUMN IF EXISTS external_source_system,
  DROP COLUMN IF EXISTS external_encounter_id,
  DROP COLUMN IF EXISTS patient_directory_id;

-- NOTE: after running this, also revert the Drizzle schema in
-- shared/schema/globalSchedule.ts (remove the three columns, the two indexes,
-- and the 'ecw_fhir_bulk' / 'healow_booking' source values) so that a future
-- `drizzle-kit push` does not re-add them. Code + SQL must stay in lockstep.
