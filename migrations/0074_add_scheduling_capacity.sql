-- Scheduling Resource Capacity — per-facility equipment machine counts +
-- service durations + ultrasound turnover, plus temporary (date-range)
-- capacity overrides for machine outages. Read by the capacity-aware
-- scheduling availability engine. No feature flag gate.

CREATE TABLE IF NOT EXISTS facility_resource_capacity (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  machine_count INTEGER NOT NULL DEFAULT 1,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  minutes_per_study INTEGER,
  turnover_minutes INTEGER NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_frc_clinic_resource
  ON facility_resource_capacity(clinic_id, resource_type);
CREATE INDEX IF NOT EXISTS idx_frc_clinic ON facility_resource_capacity(clinic_id);

CREATE TABLE IF NOT EXISTS temporary_capacity_overrides (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  facility_id TEXT,
  resource_type TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  available_capacity INTEGER NOT NULL,
  reason TEXT,
  created_by VARCHAR,
  active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tco_clinic ON temporary_capacity_overrides(clinic_id);
CREATE INDEX IF NOT EXISTS idx_tco_resource ON temporary_capacity_overrides(resource_type);
CREATE INDEX IF NOT EXISTS idx_tco_dates ON temporary_capacity_overrides(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_tco_active ON temporary_capacity_overrides(active);

-- Seed the current operational defaults for every ACTIVE clinic. These mirror
-- shared/scheduling/capacityDefaults.ts (Taylor Family Practice setup). Absent
-- rows fall back to the same defaults in code, so seeding is convenience, not
-- correctness.
INSERT INTO facility_resource_capacity
  (clinic_id, resource_type, machine_count, duration_minutes, minutes_per_study, turnover_minutes)
SELECT c.id, v.resource_type, v.machine_count, v.duration_minutes, v.minutes_per_study, v.turnover_minutes
FROM clinics c
CROSS JOIN (
  VALUES
    ('brainwave',  2, 45, NULL::INTEGER, 0),
    ('vitalwave',  2, 30, NULL::INTEGER, 0),
    ('ultrasound', 1, 15, 15,            5)
) AS v(resource_type, machine_count, duration_minutes, minutes_per_study, turnover_minutes)
WHERE c.active = true
ON CONFLICT (clinic_id, resource_type) DO NOTHING;
