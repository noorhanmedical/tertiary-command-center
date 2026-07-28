-- Phase 2G — Canonical billing readiness + Billing Document lifecycle.
-- ADDITIVE-ONLY. DO NOT RUN AUTOMATICALLY. Do NOT amend 0049–0054.
--
-- Adds (reusing the EXISTING billing_readiness_checks and
-- billing_document_requests tables — NO parallel duplicate billing store):
--   • billing_readiness_checks canonical case-scoped identity + snapshot columns
--     (ancillary_case_id, global_plexus_patient_id, patient_clinic_membership_id,
--      exact report/order-note/procedure-note document_reference ids,
--      canonical_status, structured billing/claim blockers + warnings +
--      applied_overrides + evidence_snapshot, requirement/evidence/evaluator
--      versions, evaluated_at, superseded_at, actor/source metadata).
--   • billing_document_requests canonical case-scoped identity + packet columns
--     (ancillary_case_id, identity, exact evidence reference ids, canonical_status,
--      deterministic generated_body + source_data + generation_version +
--      evidence_fingerprint, structured claim/billing blockers + warnings,
--      error_code, supersedes_billing_document_id, superseded_at, generated_at,
--      actor/source metadata). The Billing Document is an operational billing
--      packet — NEVER a claim/invoice/remittance/payment/allocation.
--   • Disjoint partial-unique current-row constraints: one current canonical
--     readiness evaluation per ancillary case and one current canonical Billing
--     Document per ancillary case. Legacy unlinked rows (ancillary_case_id NULL)
--     are excluded and coexist unchanged — NO screening+service global
--     uniqueness that would merge separate episodes.
--   • 'billing_document' added to the ancillary_document_references document_kind
--     CHECK (strict superset) so the unified index can index a Billing Document.
--   • Five Phase 2G reconciliation actions widened onto the PHI-free retry ledger.
--   • 'billing_readiness' added to the prerequisite-config blocks_stage CHECK so
--     configured billing/claim blockers can be authored per service (strict
--     superset — every existing row already satisfies it).
--
-- LEGACY COMPATIBILITY / SAFETY (all required):
--   • Every added column is NULLABLE — legacy billing_readiness_checks and
--     billing_document_requests writers stay valid while all Phase 2G flags are
--     OFF (they never populate the canonical columns).
--   • No data is deleted. No table is truncated. No clinic is mutated.
--   • No mandatory NOT NULL / CHECK is added that would break a legacy
--     INSERT/UPDATE. The three CHECK replacements only WIDEN an allowed set
--     (strict superset), so every pre-existing row already satisfies them.
--   • The partial-unique current-row indexes apply ONLY to canonical rows
--     (ancillary_case_id IS NOT NULL AND canonical_status IS NOT NULL AND
--     superseded_at IS NULL). Legacy rows (ancillary_case_id NULL) are never
--     constrained — no screening+service uniqueness is introduced.
--   • Signed/generated historical documents are immutable: supersession sets a
--     new current row + stamps superseded_at on the prior; no destructive rewrite.
--   • No claim / invoice / remittance / payment / allocation schema.
--   • No Billing Document body generation happens in this migration.
--   • Twilio / SMS: NEVER. No column supports external messaging.
--   • No migration 0056.
--
-- Rollback plan (safe while all Phase 2G flags are OFF):
--   DROP INDEX IF EXISTS uq_brc_canonical_current_case;
--   DROP INDEX IF EXISTS uq_bdr_canonical_current_case;
--   ALTER TABLE billing_readiness_checks DROP COLUMN IF EXISTS ancillary_case_id, ... ;
--   ALTER TABLE billing_document_requests DROP COLUMN IF EXISTS ancillary_case_id, ... ;
--   (restore the 0053/0054 CHECK definitions for document_kind / requested_action / blocks_stage)

BEGIN;

-- 1. Canonical case-scoped identity + snapshot on billing_readiness_checks.
ALTER TABLE billing_readiness_checks
  ADD COLUMN IF NOT EXISTS ancillary_case_id                    INTEGER REFERENCES patient_ancillary_cases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS global_plexus_patient_id             INTEGER REFERENCES global_plexus_patients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS patient_clinic_membership_id         INTEGER REFERENCES patient_clinic_memberships(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS report_document_reference_id         INTEGER REFERENCES ancillary_document_references(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_note_document_reference_id     INTEGER REFERENCES ancillary_document_references(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS procedure_note_document_reference_id INTEGER REFERENCES ancillary_document_references(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS canonical_status                     TEXT,
  ADD COLUMN IF NOT EXISTS billing_blockers                     JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS claim_blockers                       JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS warnings                             JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS applied_overrides                    JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS evidence_snapshot                    JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS requirement_version                  TEXT,
  ADD COLUMN IF NOT EXISTS evidence_fingerprint                 TEXT,
  ADD COLUMN IF NOT EXISTS evaluator_version                    TEXT,
  ADD COLUMN IF NOT EXISTS evaluated_at                         TIMESTAMP,
  ADD COLUMN IF NOT EXISTS superseded_at                        TIMESTAMP,
  ADD COLUMN IF NOT EXISTS actor_user_id                        TEXT,
  ADD COLUMN IF NOT EXISTS source_system                        TEXT;

CREATE INDEX IF NOT EXISTS idx_brc_ancillary_case ON billing_readiness_checks(ancillary_case_id);
CREATE INDEX IF NOT EXISTS idx_brc_clinic         ON billing_readiness_checks(clinic_id);

-- One CURRENT canonical readiness evaluation per ancillary case. Legacy rows
-- (ancillary_case_id NULL) are excluded; superseded/invalidated rows stamp
-- superseded_at and drop out — repeated same-service episodes have distinct
-- ancillary_case_id values, so they get distinct current evaluations.
CREATE UNIQUE INDEX IF NOT EXISTS uq_brc_canonical_current_case
  ON billing_readiness_checks(ancillary_case_id)
  WHERE ancillary_case_id IS NOT NULL AND canonical_status IS NOT NULL AND superseded_at IS NULL;

-- 2. Canonical case-scoped identity + packet on billing_document_requests.
ALTER TABLE billing_document_requests
  ADD COLUMN IF NOT EXISTS ancillary_case_id                    INTEGER REFERENCES patient_ancillary_cases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS global_plexus_patient_id             INTEGER REFERENCES global_plexus_patients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS patient_clinic_membership_id         INTEGER REFERENCES patient_clinic_memberships(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS report_document_reference_id         INTEGER REFERENCES ancillary_document_references(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_note_document_reference_id     INTEGER REFERENCES ancillary_document_references(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS procedure_note_document_reference_id INTEGER REFERENCES ancillary_document_references(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS canonical_status                     TEXT,
  ADD COLUMN IF NOT EXISTS generated_body                       TEXT,
  ADD COLUMN IF NOT EXISTS source_data                          JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS generation_version                   TEXT,
  ADD COLUMN IF NOT EXISTS evidence_fingerprint                 TEXT,
  ADD COLUMN IF NOT EXISTS claim_blockers                       JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS billing_blockers                     JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS warnings                             JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS error_code                           TEXT,
  ADD COLUMN IF NOT EXISTS supersedes_billing_document_id       INTEGER,
  ADD COLUMN IF NOT EXISTS superseded_at                        TIMESTAMP,
  ADD COLUMN IF NOT EXISTS generated_at                         TIMESTAMP,
  ADD COLUMN IF NOT EXISTS actor_user_id                        TEXT,
  ADD COLUMN IF NOT EXISTS source_system                        TEXT;

CREATE INDEX IF NOT EXISTS idx_bdr_ancillary_case ON billing_document_requests(ancillary_case_id);
CREATE INDEX IF NOT EXISTS idx_bdr_clinic         ON billing_document_requests(clinic_id);

-- One CURRENT canonical Billing Document per ancillary case. Only ACTIVE
-- canonical rows count (superseded/voided/failed stamp superseded_at or a
-- terminal canonical_status and drop out). Legacy rows (ancillary_case_id NULL)
-- are never constrained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bdr_canonical_current_case
  ON billing_document_requests(ancillary_case_id)
  WHERE ancillary_case_id IS NOT NULL
    AND canonical_status IN ('pending','generating','generated','approved')
    AND superseded_at IS NULL;

-- 3. Widen ancillary_document_references.document_kind to allow billing_document
-- (strict superset of the 0054 CHECK — every existing row already satisfies it).
ALTER TABLE ancillary_document_references
  DROP CONSTRAINT IF EXISTS chk_adr_document_kind;
ALTER TABLE ancillary_document_references
  ADD CONSTRAINT chk_adr_document_kind
    CHECK (document_kind IN ('order_note','report','consent','screening_form','procedure_note','billing_document'));

-- 4. Widen reconciliation-failure requested_action for the five Phase 2G actions.
ALTER TABLE ancillary_document_reconciliation_failures
  DROP CONSTRAINT IF EXISTS chk_adrf_requested_action;
ALTER TABLE ancillary_document_reconciliation_failures
  ADD CONSTRAINT chk_adrf_requested_action
    CHECK (requested_action IN (
      'create_reference','refresh_projection','link_order_note','link_report',
      'link_consent','link_screening_form','supersede_reference','link_order_note_evidence',
      'link_procedure_note','link_procedure_note_evidence','generate_procedure_note',
      'reconcile_procedure_note_lineage','void_procedure_note','sync_procedure_note_signature',
      'evaluate_billing_readiness','generate_billing_document','link_billing_document',
      'supersede_billing_document','sync_billing_document_reference'));

-- 5. Widen prerequisite-config blocks_stage to allow the billing_readiness stage
-- (strict superset — configured billing/claim blockers are authored per service).
ALTER TABLE ancillary_service_prerequisite_config
  DROP CONSTRAINT IF EXISTS chk_aspc_blocks_stage;
ALTER TABLE ancillary_service_prerequisite_config
  ADD CONSTRAINT chk_aspc_blocks_stage
    CHECK (blocks_stage IN ('scheduling','check_in','procedure_start','billing','billing_readiness','claim_submission'));

COMMIT;
