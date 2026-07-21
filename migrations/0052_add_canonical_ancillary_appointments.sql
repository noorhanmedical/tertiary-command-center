-- Phase 2D — Canonical ancillary appointments in global_schedule_events.
-- ADDITIVE-ONLY. DO NOT RUN AUTOMATICALLY.
--
-- Adds:
--   • global_schedule_events.ancillary_case_id  (nullable, FK)
--   • global_schedule_events.parent_event_id    (nullable self-FK; reschedule lineage)
--   • global_schedule_events.cancellation_reason  text
--   • global_schedule_events.no_show_reason       text
--   • ancillary_appointments.global_schedule_event_id  (nullable compat back-pointer)
--   • canonical_appointment_reconciliation_failures    (durable retry ledger)
--   • CHECK constraints:
--       chk_gse_ancillary_requires_case
--       chk_gse_cancelled_requires_reason
--       chk_gse_no_show_requires_reason
--   • Partial UNIQUE index for one active scheduled canonical ancillary
--     appointment per ancillary case (excludes doctor_visit AND every
--     non-scheduled status).
--
-- Rollback plan (safe while FEATURE_CANONICAL_APPOINTMENT is OFF):
--   DROP TABLE IF EXISTS canonical_appointment_reconciliation_failures;
--   ALTER TABLE ancillary_appointments DROP COLUMN IF EXISTS global_schedule_event_id;
--   ALTER TABLE global_schedule_events DROP CONSTRAINT IF EXISTS chk_gse_no_show_requires_reason;
--   ALTER TABLE global_schedule_events DROP CONSTRAINT IF EXISTS chk_gse_cancelled_requires_reason;
--   ALTER TABLE global_schedule_events DROP CONSTRAINT IF EXISTS chk_gse_ancillary_requires_case;
--   DROP INDEX IF EXISTS uq_gse_active_ancillary_appointment;
--   ALTER TABLE global_schedule_events DROP COLUMN IF EXISTS no_show_reason;
--   ALTER TABLE global_schedule_events DROP COLUMN IF EXISTS cancellation_reason;
--   ALTER TABLE global_schedule_events DROP COLUMN IF EXISTS parent_event_id;
--   ALTER TABLE global_schedule_events DROP CONSTRAINT IF EXISTS fk_gse_ancillary_case;
--   ALTER TABLE global_schedule_events DROP COLUMN IF EXISTS ancillary_case_id;
--
-- Twilio / SMS: NEVER. No column supports external messaging.

-- ─── global_schedule_events additions ────────────────────────────
ALTER TABLE global_schedule_events
  ADD COLUMN IF NOT EXISTS ancillary_case_id INTEGER,
  ADD COLUMN IF NOT EXISTS parent_event_id   INTEGER,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS no_show_reason      TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_gse_ancillary_case' AND table_name = 'global_schedule_events'
  ) THEN
    ALTER TABLE global_schedule_events
      ADD CONSTRAINT fk_gse_ancillary_case
      FOREIGN KEY (ancillary_case_id)
      REFERENCES patient_ancillary_cases(id)
      -- NO ACTION: clinical scheduling history must not be silently
      -- deleted by an ancillary-case delete (which itself is blocked
      -- by the Phase 2B NO ACTION FKs on identity tables).
      ON DELETE NO ACTION
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_gse_parent_event' AND table_name = 'global_schedule_events'
  ) THEN
    ALTER TABLE global_schedule_events
      ADD CONSTRAINT fk_gse_parent_event
      FOREIGN KEY (parent_event_id)
      REFERENCES global_schedule_events(id)
      -- SET NULL: the prior (rescheduled) event is preserved by the
      -- reschedule contract; the FK never triggers a delete.
      ON DELETE SET NULL
      NOT VALID;
  END IF;

  -- CHECK: canonical ancillary events require ancillary_case_id.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_gse_ancillary_requires_case' AND table_name = 'global_schedule_events'
  ) THEN
    ALTER TABLE global_schedule_events
      ADD CONSTRAINT chk_gse_ancillary_requires_case
      CHECK (
        event_type NOT IN ('ancillary_appointment', 'same_day_add')
        OR ancillary_case_id IS NOT NULL
      )
      NOT VALID;
  END IF;

  -- CHECK: cancelled requires reason.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_gse_cancelled_requires_reason' AND table_name = 'global_schedule_events'
  ) THEN
    ALTER TABLE global_schedule_events
      ADD CONSTRAINT chk_gse_cancelled_requires_reason
      CHECK (
        status <> 'cancelled'
        OR cancellation_reason IS NOT NULL
      )
      NOT VALID;
  END IF;

  -- CHECK: no_show requires reason.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_gse_no_show_requires_reason' AND table_name = 'global_schedule_events'
  ) THEN
    ALTER TABLE global_schedule_events
      ADD CONSTRAINT chk_gse_no_show_requires_reason
      CHECK (
        status <> 'no_show'
        OR no_show_reason IS NOT NULL
      )
      NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_gse_ancillary_case ON global_schedule_events(ancillary_case_id);
CREATE INDEX IF NOT EXISTS idx_gse_parent_event   ON global_schedule_events(parent_event_id);

-- One active scheduled canonical ancillary appointment per case.
-- Excludes doctor_visit + every non-scheduled status by construction.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gse_active_ancillary_appointment
  ON global_schedule_events(ancillary_case_id)
  WHERE event_type IN ('ancillary_appointment', 'same_day_add')
    AND status = 'scheduled'
    AND ancillary_case_id IS NOT NULL;

-- ─── ancillary_appointments compatibility back-pointer ──────────
ALTER TABLE ancillary_appointments
  ADD COLUMN IF NOT EXISTS global_schedule_event_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_aa_global_schedule_event' AND table_name = 'ancillary_appointments'
  ) THEN
    ALTER TABLE ancillary_appointments
      ADD CONSTRAINT fk_aa_global_schedule_event
      FOREIGN KEY (global_schedule_event_id)
      REFERENCES global_schedule_events(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_aa_global_schedule_event
  ON ancillary_appointments(global_schedule_event_id);

-- ─── canonical_appointment_reconciliation_failures ──────────────
-- Durable retry ledger. Populated when the canonical appointment
-- writer or transition cannot commit successfully. Never stores PHI.
CREATE TABLE IF NOT EXISTS canonical_appointment_reconciliation_failures (
  id                          SERIAL PRIMARY KEY,
  clinic_id                   INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  ancillary_case_id           INTEGER REFERENCES patient_ancillary_cases(id) ON DELETE SET NULL,
  patient_screening_id        INTEGER REFERENCES patient_screenings(id) ON DELETE SET NULL,
  execution_case_id           INTEGER REFERENCES patient_execution_cases(id) ON DELETE SET NULL,
  provisional_event_id        INTEGER REFERENCES global_schedule_events(id) ON DELETE SET NULL,
  requested_action            TEXT NOT NULL,
  source_system               TEXT,
  error_code                  TEXT,
  attempt_count               INTEGER NOT NULL DEFAULT 1,
  first_failed_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_attempted_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at                 TIMESTAMP,
  CONSTRAINT chk_carf_requested_action
    CHECK (requested_action IN (
      'create','complete','cancel','no_show','reschedule',
      'link_quick_schedule','refresh_projection'
    ))
);

CREATE INDEX IF NOT EXISTS idx_carf_clinic          ON canonical_appointment_reconciliation_failures(clinic_id);
CREATE INDEX IF NOT EXISTS idx_carf_ancillary_case  ON canonical_appointment_reconciliation_failures(ancillary_case_id);
CREATE INDEX IF NOT EXISTS idx_carf_screening       ON canonical_appointment_reconciliation_failures(patient_screening_id);
CREATE INDEX IF NOT EXISTS idx_carf_execution_case  ON canonical_appointment_reconciliation_failures(execution_case_id);
CREATE INDEX IF NOT EXISTS idx_carf_unresolved
  ON canonical_appointment_reconciliation_failures(last_attempted_at)
  WHERE resolved_at IS NULL;

-- One unresolved row per canonical work request. Two variants to
-- handle the ancillary-case-not-yet-linked case.
CREATE UNIQUE INDEX IF NOT EXISTS uq_carf_unresolved_by_ancillary
  ON canonical_appointment_reconciliation_failures(ancillary_case_id, requested_action)
  WHERE resolved_at IS NULL AND ancillary_case_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_carf_unresolved_by_execution_case
  ON canonical_appointment_reconciliation_failures(execution_case_id, requested_action)
  WHERE resolved_at IS NULL AND ancillary_case_id IS NULL AND execution_case_id IS NOT NULL;
