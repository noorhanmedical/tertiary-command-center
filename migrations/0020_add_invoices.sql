CREATE TABLE IF NOT EXISTS invoices (
  id serial PRIMARY KEY,
  invoice_number varchar(64) NOT NULL UNIQUE,
  facility text NOT NULL,
  invoice_date date NOT NULL,
  from_date date,
  to_date date,
  status varchar(32) NOT NULL DEFAULT 'Draft',
  notes text,
  total_charges numeric(12,2) NOT NULL DEFAULT 0,
  total_paid numeric(12,2) NOT NULL DEFAULT 0,
  total_balance numeric(12,2) NOT NULL DEFAULT 0,
  created_by_user_id varchar,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoices_facility_idx ON invoices(facility);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices(status);
CREATE INDEX IF NOT EXISTS invoices_invoice_date_idx ON invoices(invoice_date);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id serial PRIMARY KEY,
  invoice_id integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  billing_record_id integer,
  patient_name text,
  date_of_service date,
  service text,
  mrn text,
  clinician text,
  total_charges numeric(12,2) NOT NULL DEFAULT 0,
  paid_amount numeric(12,2) NOT NULL DEFAULT 0,
  balance_remaining numeric(12,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS invoice_line_items_invoice_id_idx ON invoice_line_items(invoice_id);
