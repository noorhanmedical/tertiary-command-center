-- Phase 2E — Unified Ancillary Documents reference index + Order Note
-- foundation. ADDITIVE-ONLY. DO NOT RUN AUTOMATICALLY.
--
-- Adds:
--   • ancillary_document_references            (canonical source INDEX;
--     never stores document bytes or full note text)
--   • ancillary_document_reconciliation_failures (durable retry ledger)
--
-- The Order Note canonical content stays in procedure_notes
-- (note_type='order_note'); reports/consent/screening forms stay in the
-- documents / uploaded_documents / case_document_readiness store. This
-- table only indexes their immutable (source_table, source_id) + status.
--
-- Allowed Phase 2E document kinds: order_note, report, consent,
-- screening_form. procedure_note is Phase 2F and billing_document is
-- Phase 2G — NEITHER is added here.
--
-- Rollback plan (safe while both Phase 2E flags are OFF):
--   DROP TABLE IF EXISTS ancillary_document_reconciliation_failures;
--   DROP TABLE IF EXISTS ancillary_document_references;
--
-- Twilio / SMS: NEVER. No column supports external messaging.

CREATE TABLE IF NOT EXISTS ancillary_document_references (
  id                          SERIAL PRIMARY KEY,
  clinic_id                   INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  global_plexus_patient_id    INTEGER REFERENCES global_plexus_patients(id) ON DELETE SET NULL,
  patient_clinic_membership_id INTEGER REFERENCES patient_clinic_memberships(id) ON DELETE SET NULL,
  patient_screening_id        INTEGER REFERENCES patient_screenings(id) ON DELETE SET NULL,
  execution_case_id           INTEGER REFERENCES patient_execution_cases(id) ON DELETE SET NULL,
  -- Every reference belongs to exactly one ancillary case. NO ACTION so
  -- clinical document history is never silently deleted by a case delete
  -- (itself blocked by the Phase 2B NO ACTION identity FKs).
  ancillary_case_id           INTEGER NOT NULL REFERENCES patient_ancillary_cases(id) ON DELETE NO ACTION,
  document_kind               TEXT NOT NULL,
  source_system               TEXT,
  -- Canonical source record. Bytes / full note text NEVER stored here.
  source_table                TEXT NOT NULL,
  source_id                   INTEGER NOT NULL,
  service_type                TEXT,
  document_status             TEXT NOT NULL,
  -- Timeless clinical date, distinct from the actual creation instant.
  effective_clinical_date     TIMESTAMP,
  actual_created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  signed_at                   TIMESTAMP,
  superseded_at               TIMESTAMP,
  created_by_user_id          VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  metadata                    JSONB DEFAULT '{}'::jsonb,
  created_at                  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_adr_document_kind
    CHECK (document_kind IN ('order_note','report','consent','screening_form')),
  CONSTRAINT chk_adr_document_status
    CHECK (document_status IN ('pending','pending_signature','signed','uploaded','superseded','voided'))
);

-- One reference per canonical source record + kind (no duplicate index rows).
CREATE UNIQUE INDEX IF NOT EXISTS uq_adr_source
  ON ancillary_document_references(source_table, source_id, document_kind);

-- At most one ACTIVE (non-superseded, non-voided) reference per
-- (ancillary_case, document_kind) — the current canonical document.
CREATE UNIQUE INDEX IF NOT EXISTS uq_adr_active_per_case_kind
  ON ancillary_document_references(ancillary_case_id, document_kind)
  WHERE superseded_at IS NULL AND document_status <> 'voided';

CREATE INDEX IF NOT EXISTS idx_adr_clinic          ON ancillary_document_references(clinic_id);
CREATE INDEX IF NOT EXISTS idx_adr_ancillary_case  ON ancillary_document_references(ancillary_case_id);
CREATE INDEX IF NOT EXISTS idx_adr_screening       ON ancillary_document_references(patient_screening_id);
CREATE INDEX IF NOT EXISTS idx_adr_execution_case  ON ancillary_document_references(execution_case_id);
CREATE INDEX IF NOT EXISTS idx_adr_global_patient  ON ancillary_document_references(global_plexus_patient_id);
CREATE INDEX IF NOT EXISTS idx_adr_kind            ON ancillary_document_references(document_kind);

-- ─── ancillary_document_reconciliation_failures ─────────────────
-- Durable retry ledger. Never stores PHI.
CREATE TABLE IF NOT EXISTS ancillary_document_reconciliation_failures (
  id                          SERIAL PRIMARY KEY,
  clinic_id                   INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  ancillary_case_id           INTEGER REFERENCES patient_ancillary_cases(id) ON DELETE SET NULL,
  patient_screening_id        INTEGER REFERENCES patient_screenings(id) ON DELETE SET NULL,
  execution_case_id           INTEGER REFERENCES patient_execution_cases(id) ON DELETE SET NULL,
  document_kind               TEXT,
  source_table                TEXT,
  source_id                   INTEGER,
  requested_action            TEXT NOT NULL,
  source_system               TEXT,
  error_code                  TEXT,
  attempt_count               INTEGER NOT NULL DEFAULT 1,
  first_failed_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_attempted_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at                 TIMESTAMP,
  CONSTRAINT chk_adrf_requested_action
    CHECK (requested_action IN (
      'create_reference','refresh_projection','link_order_note','link_report',
      'link_consent','link_screening_form','supersede_reference'
    ))
);

CREATE INDEX IF NOT EXISTS idx_adrf_clinic          ON ancillary_document_reconciliation_failures(clinic_id);
CREATE INDEX IF NOT EXISTS idx_adrf_ancillary_case  ON ancillary_document_reconciliation_failures(ancillary_case_id);
CREATE INDEX IF NOT EXISTS idx_adrf_screening       ON ancillary_document_reconciliation_failures(patient_screening_id);
CREATE INDEX IF NOT EXISTS idx_adrf_execution_case  ON ancillary_document_reconciliation_failures(execution_case_id);
CREATE INDEX IF NOT EXISTS idx_adrf_unresolved
  ON ancillary_document_reconciliation_failures(last_attempted_at)
  WHERE resolved_at IS NULL;

-- One unresolved row per document work request.
CREATE UNIQUE INDEX IF NOT EXISTS uq_adrf_unresolved_by_case_kind_action
  ON ancillary_document_reconciliation_failures(ancillary_case_id, document_kind, requested_action)
  WHERE resolved_at IS NULL AND ancillary_case_id IS NOT NULL;
