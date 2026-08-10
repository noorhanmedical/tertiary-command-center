-- Migration 0041: EMR Encounter ingestion support on global_schedule_events
--
-- Adds the columns needed to ingest FHIR Encounter resources from the bulk
-- export into the existing global_schedule_events table (eventType
-- 'doctor_visit', source 'ecw_fhir_bulk') idempotently.
--
-- Fully additive: all columns are nullable, no existing column/constraint
-- changes, and the unique index is PARTIAL (only applies to rows that carry
-- an external_encounter_id), so existing rows (all NULL there) are untouched
-- and cannot collide.
--
-- Apply AFTER 0040.

ALTER TABLE global_schedule_events
  ADD COLUMN IF NOT EXISTS external_source_system TEXT,         -- e.g. 'ecw_fhir_bulk'
  ADD COLUMN IF NOT EXISTS external_encounter_id  TEXT,         -- FHIR Encounter.id (stable)
  ADD COLUMN IF NOT EXISTS patient_directory_id   INTEGER
    REFERENCES patient_directory (id) ON DELETE SET NULL;

-- Idempotent re-import: one row per (source system, external encounter id).
-- Partial index so it only governs EMR-sourced rows; all pre-existing rows
-- have external_encounter_id = NULL and are excluded.
CREATE UNIQUE INDEX IF NOT EXISTS gse_external_encounter_idx
  ON global_schedule_events (external_source_system, external_encounter_id)
  WHERE external_encounter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gse_patient_directory_id_idx
  ON global_schedule_events (patient_directory_id);
