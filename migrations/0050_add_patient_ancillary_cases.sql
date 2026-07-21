-- Phase 2B — Canonical per-service ancillary cases.
-- ADDITIVE-ONLY. DO NOT RUN AUTOMATICALLY.
--
-- Adds:
--   • patient_ancillary_cases table
--   • Its indexes (single-column + composite active-lookup)
--   • Real FK constraints (NO ACTION for the identity trio; SET NULL
--     for screening + execution case)
--   • Partial-unique index on (global_patient, clinic, service_type)
--     WHERE lifecycle_status IN ('new','active','on_hold')
--
-- Does NOT do:
--   • No ALTER on any existing table (patient_screenings,
--     patient_execution_cases, clinics, users are untouched)
--   • No UPDATE / DELETE / TRUNCATE anywhere
--   • No unique constraint on (name, dob) — identity is opaque
--   • No population of the new table (backfill is a separate opt-in
--     script — see script/backfillAncillaryCases.ts, dry-run default)
--   • Does not enable any feature flag
--
-- Rollback plan (safe while flags are OFF):
--   DROP TABLE IF EXISTS patient_ancillary_cases;
--
-- FK-delete behavior rationale:
--   global patient → NO ACTION — a live global patient with ancillary
--                    history cannot be silently deleted; Plexus merge
--                    is the only intended path and merges never
--                    hard-delete the merged-away row (see
--                    plexus_id_aliases + patient_identity_merge_events).
--   membership     → NO ACTION — same rationale, tenant-scoped.
--   clinic         → NO ACTION — clinical history is never orphaned
--                    by a clinic deletion. Deleting a clinic requires
--                    an explicit archival workflow.
--   screening      → SET NULL — screening soft-delete (which is the
--                    normal removal path — see patient_screenings
--                    deleted_at columns) preserves the ancillary
--                    episode.
--   execution case → SET NULL — engagement-container archive
--                    preserves the ancillary trail.
--
-- Tenant-scope review: every clinic-facing read MUST filter by
-- clinic_id (denormalized on the row for exactly this purpose). The
-- reconciliation service's integrity validator refuses cross-clinic
-- linkage at write time.
--
-- Twilio / SMS: NEVER. No column supports external routing.

CREATE TABLE IF NOT EXISTS patient_ancillary_cases (
  id                            SERIAL PRIMARY KEY,
  global_plexus_patient_id      INTEGER NOT NULL,
  patient_clinic_membership_id  INTEGER NOT NULL,
  clinic_id                     INTEGER NOT NULL,
  originating_screening_id      INTEGER,
  execution_case_id             INTEGER,
  service_type                  TEXT NOT NULL,
  episode_sequence              INTEGER NOT NULL DEFAULT 1,
  opened_at                     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at                     TIMESTAMP,
  lifecycle_status              TEXT NOT NULL DEFAULT 'new',
  qualification_status          TEXT NOT NULL DEFAULT 'unscreened',
  admin_review_status           TEXT NOT NULL DEFAULT 'pending',
  clinically_completed_at       TIMESTAMP,
  financially_completed_at      TIMESTAMP,
  created_at                    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── FK constraints (all fully validated; table is fresh so ── ──
-- ─── there are no existing rows to re-scan). ─────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_pac_global_patient' AND table_name = 'patient_ancillary_cases'
  ) THEN
    ALTER TABLE patient_ancillary_cases
      ADD CONSTRAINT fk_pac_global_patient
      FOREIGN KEY (global_plexus_patient_id)
      REFERENCES global_plexus_patients(id)
      ON DELETE NO ACTION;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_pac_membership' AND table_name = 'patient_ancillary_cases'
  ) THEN
    ALTER TABLE patient_ancillary_cases
      ADD CONSTRAINT fk_pac_membership
      FOREIGN KEY (patient_clinic_membership_id)
      REFERENCES patient_clinic_memberships(id)
      ON DELETE NO ACTION;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_pac_clinic' AND table_name = 'patient_ancillary_cases'
  ) THEN
    ALTER TABLE patient_ancillary_cases
      ADD CONSTRAINT fk_pac_clinic
      FOREIGN KEY (clinic_id)
      REFERENCES clinics(id)
      ON DELETE NO ACTION;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_pac_screening' AND table_name = 'patient_ancillary_cases'
  ) THEN
    ALTER TABLE patient_ancillary_cases
      ADD CONSTRAINT fk_pac_screening
      FOREIGN KEY (originating_screening_id)
      REFERENCES patient_screenings(id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_pac_execution_case' AND table_name = 'patient_ancillary_cases'
  ) THEN
    ALTER TABLE patient_ancillary_cases
      ADD CONSTRAINT fk_pac_execution_case
      FOREIGN KEY (execution_case_id)
      REFERENCES patient_execution_cases(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pac_global_patient
  ON patient_ancillary_cases(global_plexus_patient_id);
CREATE INDEX IF NOT EXISTS idx_pac_membership
  ON patient_ancillary_cases(patient_clinic_membership_id);
CREATE INDEX IF NOT EXISTS idx_pac_clinic
  ON patient_ancillary_cases(clinic_id);
CREATE INDEX IF NOT EXISTS idx_pac_screening
  ON patient_ancillary_cases(originating_screening_id);
CREATE INDEX IF NOT EXISTS idx_pac_execution_case
  ON patient_ancillary_cases(execution_case_id);
CREATE INDEX IF NOT EXISTS idx_pac_service_type
  ON patient_ancillary_cases(service_type);
CREATE INDEX IF NOT EXISTS idx_pac_lifecycle
  ON patient_ancillary_cases(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_pac_active_lookup
  ON patient_ancillary_cases(global_plexus_patient_id, clinic_id, service_type);

-- One active episode per (global patient, clinic, service_type).
-- Historical rows with lifecycle_status IN ('closed','cancelled',
-- 'archived') may coexist. Restarting the same service after a prior
-- closed/cancelled/archived episode inserts a NEW row (episode_sequence
-- is incremented; the previous rows are preserved).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pac_active_episode
  ON patient_ancillary_cases(global_plexus_patient_id, clinic_id, service_type)
  WHERE lifecycle_status IN ('new', 'active', 'on_hold');
