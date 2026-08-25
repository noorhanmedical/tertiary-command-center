-- Phase 10 — Facility timezone + Plexus Bank ledger.

-- Add timezone to clinics (required for facility-local invoice cutoff).
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Chicago';
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

-- Plexus Bank — append-only financial event log.
-- Operational reconciliation ledger (NOT a double-entry accounting system).
-- Every financial event is traceable to patient → service episode → claim → invoice.
CREATE TABLE IF NOT EXISTS plexus_bank_events (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
  facility_id TEXT,

  -- Event classification
  event_type TEXT NOT NULL,
  event_subtype TEXT,

  -- Financial amounts (positive = credit/receipt, negative = debit/payment-out/adjustment)
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',

  -- Lineage
  patient_screening_id INTEGER REFERENCES patient_screenings(id) ON DELETE SET NULL,
  ancillary_case_id INTEGER,
  service_type TEXT,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  invoice_payment_id INTEGER REFERENCES invoice_payments(id) ON DELETE SET NULL,
  billing_record_id INTEGER REFERENCES billing_records(id) ON DELETE SET NULL,

  -- Counterparty
  counterparty_type TEXT,
  counterparty_name TEXT,

  -- Reconciliation
  reconciliation_status TEXT NOT NULL DEFAULT 'pending',
  reconciled_at TIMESTAMP,
  reconciled_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,

  -- Reference / metadata
  reference TEXT,
  description TEXT,
  metadata JSONB DEFAULT '{}',

  -- Transaction date (the business date, may differ from created_at)
  transaction_date TEXT NOT NULL,

  -- Lifecycle (append-only: no updated_at)
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pbe_clinic ON plexus_bank_events(clinic_id);
CREATE INDEX IF NOT EXISTS idx_pbe_facility ON plexus_bank_events(facility_id);
CREATE INDEX IF NOT EXISTS idx_pbe_event_type ON plexus_bank_events(event_type);
CREATE INDEX IF NOT EXISTS idx_pbe_ancillary_case ON plexus_bank_events(ancillary_case_id);
CREATE INDEX IF NOT EXISTS idx_pbe_invoice ON plexus_bank_events(invoice_id);
CREATE INDEX IF NOT EXISTS idx_pbe_reconciliation ON plexus_bank_events(reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_pbe_transaction_date ON plexus_bank_events(transaction_date);
CREATE INDEX IF NOT EXISTS idx_pbe_counterparty ON plexus_bank_events(counterparty_type);

-- Update existing clinic with timezone
UPDATE clinics SET timezone = 'America/Chicago' WHERE timezone IS NULL;
