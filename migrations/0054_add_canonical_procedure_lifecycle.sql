-- Phase 2F — Canonical procedure lifecycle + Procedure Note foundation.
-- ADDITIVE-ONLY. DO NOT RUN AUTOMATICALLY. Do NOT amend 0049–0053.
--
-- Adds:
--   • procedure_events canonical ancillary-case identity columns
--     (ancillary_case_id, global_plexus_patient_id,
--     patient_clinic_membership_id) — procedure_events REMAINS the canonical
--     procedure execution/completion row; its immutable id + completed_at are
--     the Procedure Note completion evidence. No new procedure-completion
--     table is created.
--   • procedure_notes.report_document_reference_id — the immutable report
--     evidence that satisfied the second Procedure Note eligibility
--     condition (references ancillary_document_references from 0053).
--   • disjoint partial-unique replacement of uq_pn_post_procedure_note so a
--     canonical post_procedure_note is case-scoped (one per ancillary case)
--     while legacy unlinked post-procedure notes keep screening+service
--     uniqueness (same shape as the 0053 order_note treatment).
--   • procedure_note added to the ancillary_document_references document_kind
--     CHECK so the reference index can index a canonical Procedure Note.
--   • link_procedure_note / link_procedure_note_evidence reconciliation
--     actions on the PHI-free retry ledger.
--
-- LEGACY COMPATIBILITY / SAFETY (all required):
--   • Every added column is NULLABLE — legacy procedure_events and
--     procedure_notes writers stay valid while both Phase 2F flags are OFF
--     (createPendingProcedureNotes still inserts legacy unlinked
--     post_procedure_note rows).
--   • No data is deleted. No table is truncated. No clinic is mutated.
--   • No mandatory CHECK is added that would break a legacy INSERT/UPDATE.
--     The two CHECK replacements only WIDEN an allowed set (strict superset),
--     so every pre-existing row already satisfies them.
--   • No case-required CHECK on procedure_events / procedure_notes (a NOT
--     VALID constraint still enforces on every new legacy INSERT — the
--     canonical service layer supplies ancillary_case_id for canonical rows).
--   • No billing_document schema. No Procedure Note body generation.
--   • Twilio / SMS: NEVER. No column supports external messaging.
--
-- Rollback plan (safe while both Phase 2F flags are OFF):
--   ALTER TABLE procedure_notes  DROP COLUMN IF EXISTS report_document_reference_id;
--   ALTER TABLE procedure_events DROP COLUMN IF EXISTS ancillary_case_id,
--     DROP COLUMN IF EXISTS global_plexus_patient_id,
--     DROP COLUMN IF EXISTS patient_clinic_membership_id;
--   -- (restore uq_pn_post_procedure_note / original CHECK definitions from 0053)

-- ═══════════════════════════════════════════════════════════════════
-- 1. procedure_events — canonical ancillary-case identity (additive)
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE procedure_events
  ADD COLUMN IF NOT EXISTS ancillary_case_id            INTEGER REFERENCES patient_ancillary_cases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS global_plexus_patient_id     INTEGER REFERENCES global_plexus_patients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS patient_clinic_membership_id INTEGER REFERENCES patient_clinic_memberships(id) ON DELETE SET NULL,
  -- Phase 2F-B procedure state-machine history — all nullable + server-owned;
  -- legacy rows stay valid (no mandatory constraint / CHECK).
  ADD COLUMN IF NOT EXISTS started_at                   TIMESTAMP,
  ADD COLUMN IF NOT EXISTS paused_at                    TIMESTAMP,
  ADD COLUMN IF NOT EXISTS resumed_at                   TIMESTAMP,
  ADD COLUMN IF NOT EXISTS cancelled_at                 TIMESTAMP,
  ADD COLUMN IF NOT EXISTS cancellation_reason          TEXT,
  ADD COLUMN IF NOT EXISTS no_show_at                   TIMESTAMP,
  ADD COLUMN IF NOT EXISTS unable_to_complete_at        TIMESTAMP,
  ADD COLUMN IF NOT EXISTS unable_to_complete_reason    TEXT,
  ADD COLUMN IF NOT EXISTS last_transition_at           TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_pe_ancillary_case ON procedure_events(ancillary_case_id);

-- Canonical procedure-event identity: at most ONE canonical procedure lifecycle
-- row per ancillary case. Additive + legacy-compatible — every existing row has
-- ancillary_case_id NULL and is excluded by the partial predicate, so no legacy
-- row conflicts. Enforces "a completed procedure belongs to exactly one case"
-- and lets the canonical completion path dedupe/reselect by ancillary case
-- (never by screening+service, which collides across episodes).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pe_canonical_ancillary_case
  ON procedure_events(ancillary_case_id)
  WHERE ancillary_case_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════
-- 2. procedure_notes — Procedure Note report evidence (additive)
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE procedure_notes
  ADD COLUMN IF NOT EXISTS report_document_reference_id INTEGER
    REFERENCES ancillary_document_references(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pn_report_doc_ref ON procedure_notes(report_document_reference_id);

-- ═══════════════════════════════════════════════════════════════════
-- 3. Case-scoped canonical Procedure Note identity
-- ═══════════════════════════════════════════════════════════════════
-- DEFECT corrected (mirrors the 0053 order_note fix): the 0053 uniqueness on
--   uq_pn_post_procedure_note UNIQUE (patient_screening_id, service_type, note_type)
-- collides across separate ancillary EPISODES of the same service — each
-- episode needs its OWN Procedure Note. Canonical current identity must be
--   (ancillary_case_id, note_type='post_procedure_note') WHERE superseded_at IS NULL.
--
-- ADDITIVE / LEGACY-SAFE: DROP INDEX removes only an index definition (never
-- data); legacy unlinked post_procedure_note rows (ancillary_case_id IS NULL)
-- keep their original screening+service uniqueness so createPendingProcedureNotes
-- remains deployable while the Phase 2F flags are OFF.
DROP INDEX IF EXISTS uq_pn_post_procedure_note;

-- A. Canonical CURRENT Procedure Note: one non-superseded post_procedure_note
--    per ancillary case. THIS is the corrected identity.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pn_post_procedure_note_active_case
  ON procedure_notes(ancillary_case_id, note_type)
  WHERE note_type = 'post_procedure_note' AND ancillary_case_id IS NOT NULL AND superseded_at IS NULL;

-- B. Legacy UNLINKED Procedure Notes keep the original screening+service
--    uniqueness while awaiting backfill (prevents duplicate legacy rows).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pn_post_procedure_note_legacy
  ON procedure_notes(patient_screening_id, service_type, note_type)
  WHERE note_type = 'post_procedure_note' AND ancillary_case_id IS NULL AND superseded_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════
-- 4. Widen ancillary_document_references.document_kind to allow procedure_note
-- ═══════════════════════════════════════════════════════════════════
-- Strict superset of the 0053 CHECK — every existing row already satisfies it,
-- so re-adding the constraint validates without breaking any legacy row.
ALTER TABLE ancillary_document_references
  DROP CONSTRAINT IF EXISTS chk_adr_document_kind;
ALTER TABLE ancillary_document_references
  ADD CONSTRAINT chk_adr_document_kind
    CHECK (document_kind IN ('order_note','report','consent','screening_form','procedure_note'));

-- ═══════════════════════════════════════════════════════════════════
-- 5. Widen reconciliation-failure requested_action for Procedure Note retries
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE ancillary_document_reconciliation_failures
  DROP CONSTRAINT IF EXISTS chk_adrf_requested_action;
ALTER TABLE ancillary_document_reconciliation_failures
  ADD CONSTRAINT chk_adrf_requested_action
    CHECK (requested_action IN (
      'create_reference','refresh_projection','link_order_note','link_report',
      'link_consent','link_screening_form','supersede_reference',
      'link_order_note_evidence','link_procedure_note','link_procedure_note_evidence',
      'generate_procedure_note','reconcile_procedure_note_lineage',
      'void_procedure_note','sync_procedure_note_signature'
    ));

-- ═══════════════════════════════════════════════════════════════════
-- 6. Configurable service-specific procedure prerequisites (Phase 2F-B)
-- ═══════════════════════════════════════════════════════════════════
-- Consent / insurance / authorization / coding are NOT universal blockers.
-- Each clinic (or a platform default when clinic_id IS NULL) configures per
-- service + stage whether a requirement is a hard/soft/documentation/billing/
-- claim blocker and whether an authorized role may override it. Additive.
CREATE TABLE IF NOT EXISTS ancillary_service_prerequisite_config (
  id                       SERIAL PRIMARY KEY,
  clinic_id                INTEGER REFERENCES clinics(id) ON DELETE CASCADE,
  service_type             TEXT NOT NULL,
  requirement_code         TEXT NOT NULL,
  blocker_category         TEXT NOT NULL,
  blocks_stage             TEXT NOT NULL,
  required                 BOOLEAN NOT NULL DEFAULT TRUE,
  override_allowed         BOOLEAN NOT NULL DEFAULT FALSE,
  override_roles           TEXT,
  override_audit_required  BOOLEAN NOT NULL DEFAULT TRUE,
  active                   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_aspc_blocker_category CHECK (blocker_category IN (
    'hard_procedure_blocker','soft_operational_warning','documentation_follow_up',
    'billing_blocker','claim_submission_blocker')),
  CONSTRAINT chk_aspc_blocks_stage CHECK (blocks_stage IN (
    'scheduling','check_in','procedure_start','billing','claim_submission'))
);

CREATE INDEX IF NOT EXISTS idx_aspc_service ON ancillary_service_prerequisite_config(service_type);
CREATE INDEX IF NOT EXISTS idx_aspc_clinic  ON ancillary_service_prerequisite_config(clinic_id);

-- Deterministic uniqueness by clinic/default + service + requirement + stage.
-- Two disjoint partial-unique models (a set clinic vs the NULL platform default)
-- so a clinic override and the default never collide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_aspc_clinic
  ON ancillary_service_prerequisite_config(clinic_id, service_type, requirement_code, blocks_stage)
  WHERE clinic_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_aspc_default
  ON ancillary_service_prerequisite_config(service_type, requirement_code, blocks_stage)
  WHERE clinic_id IS NULL;
