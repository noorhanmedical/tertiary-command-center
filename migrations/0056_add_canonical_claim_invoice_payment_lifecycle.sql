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
  ancillary_case_id                  integer,
  global_plexus_patient_id           integer,
  patient_clinic_membership_id       integer,
  service_type                       text NOT NULL,
  -- Exact evidence version this claim was built from.
  billing_document_id                integer,
  billing_readiness_check_id         integer,
  evidence_fingerprint               text,
  order_note_document_reference_id   integer,
  report_document_reference_id       integer,
  procedure_note_document_reference_id integer,
  procedure_event_id                 integer,
  -- Server-owned lifecycle.
  canonical_status                   text NOT NULL DEFAULT 'not_ready',
  attempt_number                     integer NOT NULL DEFAULT 1,
  supersedes_claim_id                integer,
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
  updated_at                         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cc_clinic ON canonical_claims(clinic_id);
CREATE INDEX IF NOT EXISTS idx_cc_ancillary_case ON canonical_claims(ancillary_case_id);
CREATE INDEX IF NOT EXISTS idx_cc_billing_document ON canonical_claims(billing_document_id);
CREATE INDEX IF NOT EXISTS idx_cc_status ON canonical_claims(canonical_status);
CREATE INDEX IF NOT EXISTS idx_cc_supersedes ON canonical_claims(supersedes_claim_id);
-- One CURRENT (non-superseded, non-terminal) claim per exact ancillary case.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cc_current_case
  ON canonical_claims(ancillary_case_id)
  WHERE ancillary_case_id IS NOT NULL AND superseded_at IS NULL
    AND canonical_status NOT IN ('voided','superseded');
-- Idempotent create/queue per clinic.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cc_idempotency
  ON canonical_claims(clinic_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ─── canonical_invoices ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS canonical_invoices (
  id                                 serial PRIMARY KEY,
  clinic_id                          integer NOT NULL REFERENCES clinics(id) ON DELETE NO ACTION,
  ancillary_case_id                  integer,
  global_plexus_patient_id           integer,
  patient_clinic_membership_id       integer,
  service_type                       text NOT NULL,
  claim_id                           integer,
  billing_document_id                integer,
  billing_readiness_check_id         integer,
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
  supersedes_invoice_id              integer,
  superseded_at                      timestamp,
  issued_at                          timestamp,
  delivered_at                       timestamp,
  delivery_event_reference           text,
  warnings                           jsonb NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key                    text,
  actor_user_id                      varchar,
  source_system                      text,
  created_at                         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ci_clinic ON canonical_invoices(clinic_id);
CREATE INDEX IF NOT EXISTS idx_ci_ancillary_case ON canonical_invoices(ancillary_case_id);
CREATE INDEX IF NOT EXISTS idx_ci_claim ON canonical_invoices(claim_id);
CREATE INDEX IF NOT EXISTS idx_ci_status ON canonical_invoices(canonical_status);
-- One CURRENT invoice per exact claim.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ci_current_claim
  ON canonical_invoices(claim_id)
  WHERE claim_id IS NOT NULL AND superseded_at IS NULL
    AND canonical_status NOT IN ('voided','superseded');
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
  claim_id                           integer,
  invoice_id                         integer,
  event_type                         text NOT NULL DEFAULT 'payment', -- payment|refund|reversal|adjustment
  payment_type                       text NOT NULL DEFAULT 'manual',  -- patient|payer|manual|processor_import|remittance_import
  status                             text NOT NULL DEFAULT 'posted',  -- posted|reversed|failed
  currency                           text NOT NULL DEFAULT 'USD',
  amount                             numeric(12,2) NOT NULL,
  external_transaction_id            text,
  -- Refund/reversal lineage (a new ledger event that points at the posted event).
  reverses_payment_id                integer,
  reason                             text,
  received_at                        timestamp,
  posted_at                          timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  idempotency_key                    text,
  actor_user_id                      varchar,
  source_system                      text,
  created_at                         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
  -- NO updated_at: rows are immutable (append-only). Corrections are new events.
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

COMMIT;
