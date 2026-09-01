-- Phase 2C — Service-specific Admin Review + Engagement list identity.
-- ADDITIVE-ONLY. DO NOT RUN AUTOMATICALLY.
--
-- Adds:
--   • ancillary_case_admin_review_events  (append-only review history)
--   • engagement_lists                    (independent list identity)
--   • engagement_list_memberships         (list × ancillary case)
--   • engagement_reconciliation_failures  (durable retry ledger)
--   • patient_execution_cases.sent_to_engagement_at (nullable)
--   • CHECK constraints on every new status/action column
--   • Real FK constraints
--   • Partial-unique indexes for one-active-membership-per-list-service
--
-- Does NOT do:
--   • No ALTER on any existing column type
--   • No UPDATE / DELETE / TRUNCATE anywhere
--   • No changes to patient_screenings.admin_approval_status
--     (Phase 2C keeps the screening column as a compatibility projection)
--   • No population of the new tables (backfill script tbd)
--   • No feature-flag activation
--
-- Rollback plan (safe while flags are OFF):
--   ALTER TABLE patient_execution_cases DROP COLUMN IF EXISTS sent_to_engagement_at;
--   DROP TABLE IF EXISTS engagement_reconciliation_failures;
--   DROP TABLE IF EXISTS engagement_list_memberships;
--   DROP TABLE IF EXISTS engagement_lists;
--   DROP TABLE IF EXISTS ancillary_case_admin_review_events;
--
-- Twilio / SMS: NEVER. No column supports external routing.

-- ─── ancillary_case_admin_review_events ─────────────────────────
-- Append-only history. Every review decision creates a new row; rows
-- are IMMUTABLE at the application layer (there is no repository
-- helper that UPDATEs or DELETEs this table).
CREATE TABLE IF NOT EXISTS ancillary_case_admin_review_events (
  id                        SERIAL PRIMARY KEY,
  ancillary_case_id         INTEGER NOT NULL,
  service_type              TEXT NOT NULL,
  previous_status           TEXT,
  new_status                TEXT NOT NULL,
  reviewer_user_id          VARCHAR,
  reviewer_role             TEXT,
  actual_reviewed_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  effective_clinical_date   DATE,
  rationale                 TEXT,
  evidence_snapshot         JSONB NOT NULL DEFAULT '{}'::jsonb,
  source                    TEXT NOT NULL DEFAULT 'manual',
  created_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_acare_ancillary_case' AND table_name = 'ancillary_case_admin_review_events'
  ) THEN
    ALTER TABLE ancillary_case_admin_review_events
      ADD CONSTRAINT fk_acare_ancillary_case
      FOREIGN KEY (ancillary_case_id)
      REFERENCES patient_ancillary_cases(id)
      -- NO ACTION: clinical review history must never be silently
      -- deleted by an ancillary-case delete (which itself is
      -- guarded by NO ACTION FKs on identity tables).
      ON DELETE NO ACTION;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_acare_reviewer' AND table_name = 'ancillary_case_admin_review_events'
  ) THEN
    ALTER TABLE ancillary_case_admin_review_events
      ADD CONSTRAINT fk_acare_reviewer
      FOREIGN KEY (reviewer_user_id)
      REFERENCES users(id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_acare_new_status' AND table_name = 'ancillary_case_admin_review_events'
  ) THEN
    ALTER TABLE ancillary_case_admin_review_events
      ADD CONSTRAINT chk_acare_new_status
      CHECK (new_status IN ('pending','approved','needs_info','rejected'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_acare_previous_status' AND table_name = 'ancillary_case_admin_review_events'
  ) THEN
    ALTER TABLE ancillary_case_admin_review_events
      ADD CONSTRAINT chk_acare_previous_status
      CHECK (previous_status IS NULL OR previous_status IN ('pending','approved','needs_info','rejected'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_acare_source' AND table_name = 'ancillary_case_admin_review_events'
  ) THEN
    ALTER TABLE ancillary_case_admin_review_events
      ADD CONSTRAINT chk_acare_source
      CHECK (source IN ('manual','bulk','same_day_retroactive','reanalysis','migration','system_reconciliation'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_acare_case ON ancillary_case_admin_review_events(ancillary_case_id);
CREATE INDEX IF NOT EXISTS idx_acare_reviewed_at ON ancillary_case_admin_review_events(actual_reviewed_at);
CREATE INDEX IF NOT EXISTS idx_acare_new_status ON ancillary_case_admin_review_events(new_status);

-- ─── engagement_lists ────────────────────────────────────────────
-- Each INDEPENDENT SEND creates its own row. A batch/source may be
-- sent to Engagement multiple times (e.g., after a Draft-reset and
-- re-analysis); each real send is a separate immutable transmission
-- with its own sent_to_engagement_at. Idempotency is opt-in via
-- send_idempotency_key: two calls with the same key produce one row;
-- explicit distinct keys produce distinct rows even for the same
-- source. `id` is the stable surrogate PK every reader/UI uses.
CREATE TABLE IF NOT EXISTS engagement_lists (
  id                        SERIAL PRIMARY KEY,
  clinic_id                 INTEGER NOT NULL,
  source_type               TEXT NOT NULL,
  source_id                 TEXT NOT NULL,
  send_idempotency_key      TEXT NOT NULL DEFAULT '',
  label                     TEXT NOT NULL,
  facility                  TEXT,
  service_date              TEXT,
  sent_to_engagement_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id        VARCHAR,
  status                    TEXT NOT NULL DEFAULT 'active',
  metadata                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_el_clinic' AND table_name = 'engagement_lists'
  ) THEN
    ALTER TABLE engagement_lists
      ADD CONSTRAINT fk_el_clinic
      FOREIGN KEY (clinic_id)
      REFERENCES clinics(id)
      -- NO ACTION: multi-list history must not vanish silently.
      ON DELETE NO ACTION;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_el_creator' AND table_name = 'engagement_lists'
  ) THEN
    ALTER TABLE engagement_lists
      ADD CONSTRAINT fk_el_creator
      FOREIGN KEY (created_by_user_id)
      REFERENCES users(id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_el_status' AND table_name = 'engagement_lists'
  ) THEN
    ALTER TABLE engagement_lists
      ADD CONSTRAINT chk_el_status
      CHECK (status IN ('active','archived','cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_el_clinic ON engagement_lists(clinic_id);
CREATE INDEX IF NOT EXISTS idx_el_sent_at ON engagement_lists(sent_to_engagement_at DESC);
CREATE INDEX IF NOT EXISTS idx_el_service_date ON engagement_lists(service_date);
CREATE INDEX IF NOT EXISTS idx_el_source ON engagement_lists(source_type, source_id);

-- One row per (clinic_id, source_type, source_id, send_idempotency_key).
-- Distinct idempotency keys allow the same source to be sent to
-- Engagement multiple times as independent transmissions.
CREATE UNIQUE INDEX IF NOT EXISTS uq_el_source_identity
  ON engagement_lists(clinic_id, source_type, source_id, send_idempotency_key);

-- ─── engagement_list_memberships ─────────────────────────────────
-- Join table: which ancillary cases came in via which lists. One
-- ancillary case may have many memberships across different lists.
-- Membership status is separate from list status.
CREATE TABLE IF NOT EXISTS engagement_list_memberships (
  id                        SERIAL PRIMARY KEY,
  engagement_list_id        INTEGER NOT NULL,
  ancillary_case_id         INTEGER,
  patient_screening_id      INTEGER,
  execution_case_id         INTEGER,
  service_type              TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'active',
  added_at                  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at                TIMESTAMP,
  removal_reason            TEXT
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_elm_list' AND table_name = 'engagement_list_memberships'
  ) THEN
    ALTER TABLE engagement_list_memberships
      ADD CONSTRAINT fk_elm_list
      FOREIGN KEY (engagement_list_id)
      REFERENCES engagement_lists(id)
      ON DELETE NO ACTION;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_elm_ancillary_case' AND table_name = 'engagement_list_memberships'
  ) THEN
    ALTER TABLE engagement_list_memberships
      ADD CONSTRAINT fk_elm_ancillary_case
      FOREIGN KEY (ancillary_case_id)
      REFERENCES patient_ancillary_cases(id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_elm_screening' AND table_name = 'engagement_list_memberships'
  ) THEN
    ALTER TABLE engagement_list_memberships
      ADD CONSTRAINT fk_elm_screening
      FOREIGN KEY (patient_screening_id)
      REFERENCES patient_screenings(id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_elm_execution_case' AND table_name = 'engagement_list_memberships'
  ) THEN
    ALTER TABLE engagement_list_memberships
      ADD CONSTRAINT fk_elm_execution_case
      FOREIGN KEY (execution_case_id)
      REFERENCES patient_execution_cases(id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_elm_status' AND table_name = 'engagement_list_memberships'
  ) THEN
    ALTER TABLE engagement_list_memberships
      ADD CONSTRAINT chk_elm_status
      CHECK (status IN ('active','removed','withdrawn'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_elm_list ON engagement_list_memberships(engagement_list_id);
CREATE INDEX IF NOT EXISTS idx_elm_ancillary_case ON engagement_list_memberships(ancillary_case_id);
CREATE INDEX IF NOT EXISTS idx_elm_screening ON engagement_list_memberships(patient_screening_id);
CREATE INDEX IF NOT EXISTS idx_elm_execution_case ON engagement_list_memberships(execution_case_id);
CREATE INDEX IF NOT EXISTS idx_elm_active ON engagement_list_memberships(engagement_list_id) WHERE status = 'active';

-- One active membership per (list, ancillary_case, service_type).
-- Re-adding an ancillary to the same list after removal creates a
-- new row (previous status='removed' persists as history).
CREATE UNIQUE INDEX IF NOT EXISTS uq_elm_active_by_ancillary
  ON engagement_list_memberships(engagement_list_id, ancillary_case_id, service_type)
  WHERE status = 'active' AND ancillary_case_id IS NOT NULL;
-- Transitional fallback for rows that don't yet have an ancillary_case_id
-- (Phase 2A backfill in progress): dedup by screening + service_type.
CREATE UNIQUE INDEX IF NOT EXISTS uq_elm_active_by_screening
  ON engagement_list_memberships(engagement_list_id, patient_screening_id, service_type)
  WHERE status = 'active' AND ancillary_case_id IS NULL AND patient_screening_id IS NOT NULL;

-- ─── engagement_reconciliation_failures ──────────────────────────
-- Durable retry ledger for engagement eligibility reconciliation.
-- Same shape convention as ancillary_case_reconciliation_failures.
-- No PHI columns.
CREATE TABLE IF NOT EXISTS engagement_reconciliation_failures (
  id                              SERIAL PRIMARY KEY,
  clinic_id                       INTEGER NOT NULL,
  patient_screening_id            INTEGER,
  ancillary_case_id               INTEGER,
  service_type                    TEXT,
  source_list_id                  INTEGER,
  requested_action                TEXT NOT NULL,
  previous_admin_review_status    TEXT,
  new_admin_review_status         TEXT,
  source_system                   TEXT,
  error_code                      TEXT,
  attempt_count                   INTEGER NOT NULL DEFAULT 1,
  first_failed_at                 TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_attempted_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at                     TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_erf_clinic' AND table_name = 'engagement_reconciliation_failures'
  ) THEN
    ALTER TABLE engagement_reconciliation_failures
      ADD CONSTRAINT fk_erf_clinic
      FOREIGN KEY (clinic_id)
      REFERENCES clinics(id)
      ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_erf_screening' AND table_name = 'engagement_reconciliation_failures'
  ) THEN
    ALTER TABLE engagement_reconciliation_failures
      ADD CONSTRAINT fk_erf_screening
      FOREIGN KEY (patient_screening_id)
      REFERENCES patient_screenings(id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_erf_ancillary_case' AND table_name = 'engagement_reconciliation_failures'
  ) THEN
    ALTER TABLE engagement_reconciliation_failures
      ADD CONSTRAINT fk_erf_ancillary_case
      FOREIGN KEY (ancillary_case_id)
      REFERENCES patient_ancillary_cases(id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_erf_source_list' AND table_name = 'engagement_reconciliation_failures'
  ) THEN
    ALTER TABLE engagement_reconciliation_failures
      ADD CONSTRAINT fk_erf_source_list
      FOREIGN KEY (source_list_id)
      REFERENCES engagement_lists(id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_erf_requested_action' AND table_name = 'engagement_reconciliation_failures'
  ) THEN
    ALTER TABLE engagement_reconciliation_failures
      ADD CONSTRAINT chk_erf_requested_action
      CHECK (requested_action IN ('activate','deactivate','restore','refresh_memberships','refresh_projection'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_erf_unresolved
  ON engagement_reconciliation_failures(last_attempted_at)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_erf_clinic ON engagement_reconciliation_failures(clinic_id);
CREATE INDEX IF NOT EXISTS idx_erf_ancillary_case ON engagement_reconciliation_failures(ancillary_case_id);
CREATE INDEX IF NOT EXISTS idx_erf_screening ON engagement_reconciliation_failures(patient_screening_id);

-- Dedup unresolved failures by canonical work request. Multiple keys
-- because ancillary_case_id may be null (pre-backfill rows).
CREATE UNIQUE INDEX IF NOT EXISTS uq_erf_unresolved_by_ancillary_case
  ON engagement_reconciliation_failures(ancillary_case_id, requested_action, service_type)
  WHERE resolved_at IS NULL AND ancillary_case_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_erf_unresolved_by_screening
  ON engagement_reconciliation_failures(patient_screening_id, requested_action, service_type)
  WHERE resolved_at IS NULL AND ancillary_case_id IS NULL AND patient_screening_id IS NOT NULL;

-- ─── patient_execution_cases.sent_to_engagement_at ───────────────
-- Authoritative "list became available in Engagement" timestamp.
-- Nullable for legacy rows; backfill service will populate from
-- committed_at where available.
ALTER TABLE patient_execution_cases
  ADD COLUMN IF NOT EXISTS sent_to_engagement_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_pec_sent_to_engagement_at
  ON patient_execution_cases(sent_to_engagement_at DESC NULLS LAST);
