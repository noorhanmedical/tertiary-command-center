-- Phase 2J — Canonical claim, invoice, and payment lifecycle.
-- ADDITIVE-ONLY. DO NOT RUN AUTOMATICALLY. Do NOT amend 0049–0055.
--
-- Adds THREE new canonical tables anchored on the exact Phase 2A–2I canonical
-- identities (clinic + ancillary case + service + Billing Document +
-- billing-readiness + non-empty evidence fingerprint + exact document-reference
-- ids). These are a DIFFERENT entity from the Phase 4 operational invoice desk
-- (execution-case / facility-batch anchored `invoices`/`invoice_payments`) — 2J
-- never rewrites or reads those. NO parallel duplicate of a table whose meaning +
-- constraints already match; claims did not exist, and the canonical invoice/
-- payment differ in identity axis (ancillary-case + evidence-version) and
-- semantics (attempt versioning, append-only ledger, idempotency, currency).
--
--   • canonical_claims            — versioned claim attempts bound to one exact
--                                   Billing Document evidence version; append a new
--                                   attempt on correction (never mutate a submitted
--                                   claim). Money is NUMERIC(12,2) (repo convention);
--                                   totals are computed in integer cents in code.
--   • canonical_invoices          — an ancillary-case, evidence-versioned invoice
--                                   derived from a canonical claim (distinct from the
--                                   Phase 4 operational invoice). Immutable once issued.
--   • canonical_payments          — APPEND-ONLY financial ledger (payment / refund /
--                                   reversal / adjustment events) with idempotency +
--                                   external-txn + currency; balances are DERIVED,
--                                   never a mutable stored truth. Reversals/refunds are
--                                   new rows. NO clinic/Plexus split / partner
--                                   commission / profit distribution.
--
-- Disjoint partial-unique current-row constraints: one current (non-superseded,
-- non-terminal) claim per ancillary case; one current invoice per claim; unique
-- idempotency + external-transaction identity per clinic. Legacy/unlinked rows
-- (ancillary_case_id NULL) are excluded and coexist unchanged — NO screening+service
-- global uniqueness that would merge separate episodes.
--
-- Safe while EVERY Phase 2J flag is OFF: no route/service reads or writes these
-- tables until FEATURE_CANONICAL_CLAIMS/INVOICES/PAYMENTS are ON. All canonical
-- ownership columns are nullable for transitional state. No destructive change, no
-- table truncation, no clinic mutation, no mandatory constraint that breaks a
-- legacy writer, no FK that forces a load-order dependency (FKs to peer canonical
-- tables are declared here only, matching the 0050–0055 pattern).
--
-- ROLLBACK (manual, only if never populated):
--   DROP TABLE IF EXISTS canonical_financial_transitions;
--   DROP TABLE IF EXISTS canonical_payment_allocations;
--   DROP TABLE IF EXISTS canonical_payments;
--   DROP TABLE IF EXISTS canonical_invoices;
--   DROP TABLE IF EXISTS canonical_claims;
-- The three PHI-free reconciliation actions Phase 2J appends to
-- ancillary_document_reconciliation_failures.requested_action need NO migration
-- (that column is free TEXT with no CHECK).

BEGIN;

-- ─── canonical_claims ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS canonical_claims (
  id                                 serial PRIMARY KEY,
  clinic_id                          integer NOT NULL REFERENCES clinics(id) ON DELETE NO ACTION,
  ancillary_case_id                  integer REFERENCES patient_ancillary_cases(id) ON DELETE NO ACTION,
  global_plexus_patient_id           integer,
  patient_clinic_membership_id       integer,
  service_type                       text NOT NULL,
  -- Exact evidence version this claim was built from (real FKs where 0056 order permits).
  billing_document_id                integer REFERENCES billing_document_requests(id) ON DELETE NO ACTION,
  billing_readiness_check_id         integer REFERENCES billing_readiness_checks(id) ON DELETE NO ACTION,
  evidence_fingerprint               text,
  order_note_document_reference_id   integer REFERENCES ancillary_document_references(id) ON DELETE NO ACTION,
  report_document_reference_id       integer REFERENCES ancillary_document_references(id) ON DELETE NO ACTION,
  procedure_note_document_reference_id integer REFERENCES ancillary_document_references(id) ON DELETE NO ACTION,
  procedure_event_id                 integer REFERENCES procedure_events(id) ON DELETE NO ACTION,
  -- Server-owned lifecycle.
  canonical_status                   text NOT NULL DEFAULT 'not_ready',
  attempt_number                     integer NOT NULL DEFAULT 1,
  supersedes_claim_id                integer REFERENCES canonical_claims(id) ON DELETE NO ACTION,
  superseded_at                      timestamp,
  claim_submission_blockers          jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings                           jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Money (repo NUMERIC(12,2); totals computed in integer cents in code).
  currency                           text NOT NULL DEFAULT 'USD',
  charge_amount                      numeric(12,2),
  line_items                         jsonb NOT NULL DEFAULT '[]'::jsonb,
  amount_source                      text,
  -- Submission provenance (only from an exact authorized source / attestation).
  submitted_at                       timestamp,
  submission_source                  text,
  submission_reference               text,
  submission_actor_user_id           varchar,
  submission_reason                  text,
  -- Idempotency + audit.
  idempotency_key                    text,
  actor_user_id                      varchar,
  source_system                      text,
  created_at                         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Exact vocabulary + non-negative money + submission provenance enforced in-DB.
  CONSTRAINT ck_cc_status CHECK (canonical_status IN (
    'not_ready','ready','draft','queued','submitted','accepted','rejected','denied','partially_paid','paid','voided','superseded')),
  CONSTRAINT ck_cc_attempt_positive CHECK (attempt_number > 0),
  CONSTRAINT ck_cc_currency_nonempty CHECK (length(btrim(currency)) > 0),
  CONSTRAINT ck_cc_charge_nonneg CHECK (charge_amount IS NULL OR charge_amount >= 0),
  CONSTRAINT ck_cc_amount_source_vocab CHECK (amount_source IS NULL OR amount_source IN (
    'approved_fee_schedule','canonical_charge_config','imported_charge','authorized_manual_entry')),
  CONSTRAINT ck_cc_submission_source_vocab CHECK (submission_source IS NULL OR submission_source IN (
    'clearinghouse_response','imported_acknowledgment','manual_attestation')),
  -- A submitted (or later) status REQUIRES exact submission provenance.
  CONSTRAINT ck_cc_submitted_provenance CHECK (
    canonical_status NOT IN ('submitted','accepted','rejected','denied','partially_paid','paid')
    OR (submitted_at IS NOT NULL AND submission_source IS NOT NULL AND submission_actor_user_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_cc_clinic ON canonical_claims(clinic_id);
CREATE INDEX IF NOT EXISTS idx_cc_ancillary_case ON canonical_claims(ancillary_case_id);
CREATE INDEX IF NOT EXISTS idx_cc_billing_document ON canonical_claims(billing_document_id);
CREATE INDEX IF NOT EXISTS idx_cc_status ON canonical_claims(canonical_status);
CREATE INDEX IF NOT EXISTS idx_cc_supersedes ON canonical_claims(supersedes_claim_id);
-- One ACTIVE UNSUBMITTED working attempt per exact ancillary case. Submitted (and
-- later) attempts are historical and EXCLUDED here, so a submitted claim coexists
-- with a new correction draft WITHOUT rewriting the submitted row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cc_active_draft
  ON canonical_claims(ancillary_case_id)
  WHERE ancillary_case_id IS NOT NULL AND superseded_at IS NULL
    AND canonical_status IN ('not_ready','ready','draft','queued');
-- Idempotent create/queue per clinic.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cc_idempotency
  ON canonical_claims(clinic_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ─── canonical_invoices ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS canonical_invoices (
  id                                 serial PRIMARY KEY,
  clinic_id                          integer NOT NULL REFERENCES clinics(id) ON DELETE NO ACTION,
  ancillary_case_id                  integer REFERENCES patient_ancillary_cases(id) ON DELETE NO ACTION,
  global_plexus_patient_id           integer,
  patient_clinic_membership_id       integer,
  service_type                       text NOT NULL,
  claim_id                           integer REFERENCES canonical_claims(id) ON DELETE NO ACTION,
  billing_document_id                integer REFERENCES billing_document_requests(id) ON DELETE NO ACTION,
  billing_readiness_check_id         integer REFERENCES billing_readiness_checks(id) ON DELETE NO ACTION,
  evidence_fingerprint               text,
  -- Distinct meaning: never merge patient / payer / clinic / vendor invoices.
  invoice_type                       text NOT NULL DEFAULT 'patient',
  recipient_type                     text,
  recipient_id                       text,
  invoice_number                     text,
  canonical_status                   text NOT NULL DEFAULT 'draft',
  currency                           text NOT NULL DEFAULT 'USD',
  total_amount                       numeric(12,2),
  line_items                         jsonb NOT NULL DEFAULT '[]'::jsonb,
  amount_source                      text,
  supersedes_invoice_id              integer REFERENCES canonical_invoices(id) ON DELETE NO ACTION,
  superseded_at                      timestamp,
  issued_at                          timestamp,
  delivered_at                       timestamp,
  delivery_event_reference           text,
  warnings                           jsonb NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key                    text,
  actor_user_id                      varchar,
  source_system                      text,
  created_at                         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_ci_status CHECK (canonical_status IN (
    'draft','approved','issued','delivered','partially_paid','paid','voided','superseded','delivery_failed')),
  CONSTRAINT ck_ci_type CHECK (invoice_type IN ('patient','payer','clinic')),
  CONSTRAINT ck_ci_recipient_type CHECK (recipient_type IS NULL OR recipient_type IN ('patient_membership','payer','clinic')),
  CONSTRAINT ck_ci_currency_nonempty CHECK (length(btrim(currency)) > 0),
  CONSTRAINT ck_ci_total_nonneg CHECK (total_amount IS NULL OR total_amount >= 0),
  -- Delivered REQUIRES an exact delivery event reference.
  CONSTRAINT ck_ci_delivered_provenance CHECK (canonical_status <> 'delivered' OR delivery_event_reference IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_ci_clinic ON canonical_invoices(clinic_id);
CREATE INDEX IF NOT EXISTS idx_ci_ancillary_case ON canonical_invoices(ancillary_case_id);
CREATE INDEX IF NOT EXISTS idx_ci_claim ON canonical_invoices(claim_id);
CREATE INDEX IF NOT EXISTS idx_ci_status ON canonical_invoices(canonical_status);
-- One ACTIVE working invoice per exact claim (issued/delivered/paid remain as
-- history; a correction is a NEW version, never a rewrite of the issued row).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ci_active_claim
  ON canonical_invoices(claim_id)
  WHERE claim_id IS NOT NULL AND superseded_at IS NULL
    AND canonical_status IN ('draft','approved');
-- Concurrency-safe invoice number per clinic.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ci_number
  ON canonical_invoices(clinic_id, invoice_number)
  WHERE invoice_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ci_idempotency
  ON canonical_invoices(clinic_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ─── canonical_payments (APPEND-ONLY ledger) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS canonical_payments (
  id                                 serial PRIMARY KEY,
  clinic_id                          integer NOT NULL REFERENCES clinics(id) ON DELETE NO ACTION,
  ancillary_case_id                  integer,
  service_type                       text,
  -- Allocation target (exact same clinic + case).
  claim_id                           integer REFERENCES canonical_claims(id) ON DELETE NO ACTION,
  invoice_id                         integer REFERENCES canonical_invoices(id) ON DELETE NO ACTION,
  event_type                         text NOT NULL DEFAULT 'payment', -- payment|refund|reversal|adjustment
  payment_type                       text NOT NULL DEFAULT 'manual',  -- patient|payer|manual|processor_import|remittance_import
  status                             text NOT NULL DEFAULT 'posted',  -- posted|reversed|failed
  currency                           text NOT NULL DEFAULT 'USD',
  amount                             numeric(12,2) NOT NULL,
  external_transaction_id            text,
  -- Refund/reversal lineage (a new ledger event that points at the posted event).
  reverses_payment_id                integer REFERENCES canonical_payments(id) ON DELETE NO ACTION,
  reason                             text,
  received_at                        timestamp,
  posted_at                          timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  idempotency_key                    text,
  actor_user_id                      varchar,
  source_system                      text,
  created_at                         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- NO updated_at: rows are immutable (append-only). Corrections are new events.
  CONSTRAINT ck_cp_event_type CHECK (event_type IN ('payment','refund','reversal','adjustment')),
  CONSTRAINT ck_cp_payment_type CHECK (payment_type IN ('patient','payer','manual','processor_import','remittance_import')),
  CONSTRAINT ck_cp_status CHECK (status IN ('posted','reversed','failed')),
  CONSTRAINT ck_cp_currency_nonempty CHECK (length(btrim(currency)) > 0),
  -- payment/refund/reversal amounts must be positive; adjustment may be signed.
  CONSTRAINT ck_cp_amount_positive CHECK (event_type = 'adjustment' OR amount > 0),
  -- A refund/reversal MUST reference an exact prior posted payment.
  CONSTRAINT ck_cp_reversal_lineage CHECK (event_type NOT IN ('refund','reversal') OR reverses_payment_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_cp_clinic ON canonical_payments(clinic_id);
CREATE INDEX IF NOT EXISTS idx_cp_ancillary_case ON canonical_payments(ancillary_case_id);
CREATE INDEX IF NOT EXISTS idx_cp_claim ON canonical_payments(claim_id);
CREATE INDEX IF NOT EXISTS idx_cp_invoice ON canonical_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_cp_reverses ON canonical_payments(reverses_payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cp_idempotency
  ON canonical_payments(clinic_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
-- Duplicate external transaction ids are idempotent per clinic.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cp_external_txn
  ON canonical_payments(clinic_id, external_transaction_id)
  WHERE external_transaction_id IS NOT NULL;

-- ─── canonical_payment_allocations (APPEND-ONLY) ─────────────────────────────
-- A receipt (canonical_payments) applies to ONE exact target (claim|invoice) per
-- row; one receipt may have many rows (split). Unapplied remainder is explicit.
CREATE TABLE IF NOT EXISTS canonical_payment_allocations (
  id                                 serial PRIMARY KEY,
  payment_id                         integer NOT NULL REFERENCES canonical_payments(id) ON DELETE NO ACTION,
  clinic_id                          integer NOT NULL REFERENCES clinics(id) ON DELETE NO ACTION,
  ancillary_case_id                  integer REFERENCES patient_ancillary_cases(id) ON DELETE NO ACTION,
  service_type                       text,
  target_type                        text NOT NULL,          -- claim | invoice
  target_id                          integer NOT NULL,
  currency                           text NOT NULL DEFAULT 'USD',
  amount                             numeric(12,2) NOT NULL,
  is_overpayment                     integer NOT NULL DEFAULT 0,
  reason                             text,
  idempotency_key                    text,
  actor_user_id                      varchar,
  source_system                      text,
  created_at                         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_cpa_target_type CHECK (target_type IN ('claim','invoice')),
  CONSTRAINT ck_cpa_currency_nonempty CHECK (length(btrim(currency)) > 0),
  CONSTRAINT ck_cpa_amount_positive CHECK (amount > 0),
  CONSTRAINT ck_cpa_overpayment_flag CHECK (is_overpayment IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_cpa_payment ON canonical_payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_cpa_clinic ON canonical_payment_allocations(clinic_id);
CREATE INDEX IF NOT EXISTS idx_cpa_target ON canonical_payment_allocations(target_type, target_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cpa_idempotency
  ON canonical_payment_allocations(clinic_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ─── canonical_financial_transitions (APPEND-ONLY audit) ─────────────────────
-- One row per claim/invoice/payment lifecycle command; the durable provenance for
-- advancing a financial state. PHI-free (codes/ids only).
CREATE TABLE IF NOT EXISTS canonical_financial_transitions (
  id                                 serial PRIMARY KEY,
  entity_type                        text NOT NULL,          -- claim|invoice|payment|allocation
  entity_id                          integer NOT NULL,
  clinic_id                          integer NOT NULL REFERENCES clinics(id) ON DELETE NO ACTION,
  ancillary_case_id                  integer,
  service_type                       text,
  from_status                        text,
  to_status                          text NOT NULL,
  actor_user_id                      varchar,
  actor_role                         text,
  reason                             text,
  source_type                        text,
  source_reference                   text,
  idempotency_key                    text,
  created_at                         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_cft_entity_type CHECK (entity_type IN ('claim','invoice','payment','allocation'))
);
CREATE INDEX IF NOT EXISTS idx_cft_entity ON canonical_financial_transitions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_cft_clinic ON canonical_financial_transitions(clinic_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cft_idempotency
  ON canonical_financial_transitions(entity_type, clinic_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMIT;
