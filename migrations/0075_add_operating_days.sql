-- Operating days for facility scheduling resources.
--
-- Adds a NORMAL weekly service schedule per resource pool. Off-days are a SOFT
-- constraint: the scheduler warns + suggests the next eligible operating day,
-- but an authorized PCS/ACS/admin may override. Stored as a jsonb array of day
-- numbers (0=Sun … 6=Sat). NULL falls back to the code default (Mon–Fri).

ALTER TABLE facility_resource_capacity
  ADD COLUMN IF NOT EXISTS operating_days JSONB;

-- Seed the current operational schedule onto existing rows only where unset:
--   BrainWave / VitalWave — Mon–Fri
--   Ultrasound            — Tue / Thu (specialty day)
UPDATE facility_resource_capacity
  SET operating_days = '[1,2,3,4,5]'::jsonb
  WHERE operating_days IS NULL AND resource_type IN ('brainwave', 'vitalwave');

UPDATE facility_resource_capacity
  SET operating_days = '[2,4]'::jsonb
  WHERE operating_days IS NULL AND resource_type = 'ultrasound';
