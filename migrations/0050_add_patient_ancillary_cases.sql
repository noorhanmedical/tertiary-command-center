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
--   DROP TABLE IF EXISTS ancillary_case_reconciliation_failures;
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

-- ─── CHECK constraints ────────────────────────────────────────────
-- Enforce the enum set at the DB layer AND require closed_at on
-- terminal statuses. Wrapped in DO $$ ... $$ blocks for idempotent
-- re-application.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_pac_lifecycle_status' AND table_name = 'patient_ancillary_cases'
  ) THEN
    ALTER TABLE patient_ancillary_cases
      ADD CONSTRAINT chk_pac_lifecycle_status
      CHECK (lifecycle_status IN ('new','active','on_hold','closed','cancelled','archived'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_pac_qualification_status' AND table_name = 'patient_ancillary_cases'
  ) THEN
    ALTER TABLE patient_ancillary_cases
      ADD CONSTRAINT chk_pac_qualification_status
      CHECK (qualification_status IN ('unscreened','qualified','not_qualified','pending_review'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_pac_admin_review_status' AND table_name = 'patient_ancillary_cases'
  ) THEN
    ALTER TABLE patient_ancillary_cases
      ADD CONSTRAINT chk_pac_admin_review_status
      CHECK (admin_review_status IN ('pending','approved','needs_info','rejected'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_pac_episode_sequence' AND table_name = 'patient_ancillary_cases'
  ) THEN
    ALTER TABLE patient_ancillary_cases
      ADD CONSTRAINT chk_pac_episode_sequence
      CHECK (episode_sequence >= 1);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_pac_closed_at_required' AND table_name = 'patient_ancillary_cases'
  ) THEN
    -- Terminal statuses (closed / cancelled / archived) require closed_at.
    -- Compatible with current service behavior: each of those
    -- lifecycle transitions in the reconciler + repo helpers sets
    -- closed_at at the same moment.
    ALTER TABLE patient_ancillary_cases
      ADD CONSTRAINT chk_pac_closed_at_required
      CHECK (
        lifecycle_status NOT IN ('closed','cancelled','archived')
        OR closed_at IS NOT NULL
      );
  END IF;
END $$;

-- ─── ancillary_case_reconciliation_failures ──────────────────────
-- Durable retry ledger for Phase 2B. Populated when the ancillary-
-- case reconciler cannot commit successfully (missing Phase 2A
-- identity links, integrity failures, race, DB errors). Retried by
-- server/services/ancillaryCases/failureLedger.ts.
--
-- NEVER stores PHI: no name / DOB / phone / email / MRN / insurance /
-- diagnosis / medication / clinical reasoning. Only ids, timestamps,
-- action, source, and error code.
CREATE TABLE IF NOT EXISTS ancillary_case_reconciliation_failures (
  id                              SERIAL PRIMARY KEY,
  patient_screening_id            INTEGER,
  execution_case_id               INTEGER,
  clinic_id                       INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  global_plexus_patient_id        INTEGER,
  patient_clinic_membership_id    INTEGER,
  service_type                    TEXT NOT NULL,
  requested_action                TEXT NOT NULL,
  source_system                   TEXT,
  error_code                      TEXT,
  attempt_count                   INTEGER NOT NULL DEFAULT 1,
  first_failed_at                 TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_attempted_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at                     TIMESTAMP
);

-- FKs added via ALTER (fresh table; nothing to re-scan).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_acrf_screening' AND table_name = 'ancillary_case_reconciliation_failures'
  ) THEN
    ALTER TABLE ancillary_case_reconciliation_failures
      ADD CONSTRAINT fk_acrf_screening
      FOREIGN KEY (patient_screening_id)
      REFERENCES patient_screenings(id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_acrf_execution_case' AND table_name = 'ancillary_case_reconciliation_failures'
  ) THEN
    ALTER TABLE ancillary_case_reconciliation_failures
      ADD CONSTRAINT fk_acrf_execution_case
      FOREIGN KEY (execution_case_id)
      REFERENCES patient_execution_cases(id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_acrf_global_patient' AND table_name = 'ancillary_case_reconciliation_failures'
  ) THEN
    ALTER TABLE ancillary_case_reconciliation_failures
      ADD CONSTRAINT fk_acrf_global_patient
      FOREIGN KEY (global_plexus_patient_id)
      REFERENCES global_plexus_patients(id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_acrf_membership' AND table_name = 'ancillary_case_reconciliation_failures'
  ) THEN
    ALTER TABLE ancillary_case_reconciliation_failures
      ADD CONSTRAINT fk_acrf_membership
      FOREIGN KEY (patient_clinic_membership_id)
      REFERENCES patient_clinic_memberships(id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_acrf_requested_action' AND table_name = 'ancillary_case_reconciliation_failures'
  ) THEN
    ALTER TABLE ancillary_case_reconciliation_failures
      ADD CONSTRAINT chk_acrf_requested_action
      CHECK (requested_action IN ('ensure_active','place_on_hold','cancel','archive','refresh_projection'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_acrf_unresolved
  ON ancillary_case_reconciliation_failures(last_attempted_at)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_acrf_screening
  ON ancillary_case_reconciliation_failures(patient_screening_id);
CREATE INDEX IF NOT EXISTS idx_acrf_execution_case
  ON ancillary_case_reconciliation_failures(execution_case_id);
CREATE INDEX IF NOT EXISTS idx_acrf_clinic
  ON ancillary_case_reconciliation_failures(clinic_id);

-- One unresolved row per canonical work request
-- (execution_case_id, service_type, requested_action) — a retry
-- UPDATES the existing row instead of accumulating dupes. Rows
-- without an execution_case_id (walk-in quick-schedule use case) fall
-- back to (patient_screening_id, service_type, requested_action).
CREATE UNIQUE INDEX IF NOT EXISTS uq_acrf_unresolved_by_execution_case
  ON ancillary_case_reconciliation_failures(execution_case_id, service_type, requested_action)
  WHERE resolved_at IS NULL AND execution_case_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_acrf_unresolved_by_screening
  ON ancillary_case_reconciliation_failures(patient_screening_id, service_type, requested_action)
  WHERE resolved_at IS NULL AND execution_case_id IS NULL AND patient_screening_id IS NOT NULL;
