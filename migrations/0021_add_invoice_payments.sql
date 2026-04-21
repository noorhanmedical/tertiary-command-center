ALTER TABLE invoices ADD COLUMN IF NOT EXISTS initial_paid numeric(12,2) NOT NULL DEFAULT 0;

UPDATE invoices SET initial_paid = total_paid WHERE initial_paid = 0 AND total_paid <> 0;

CREATE TABLE IF NOT EXISTS invoice_payments (
  id serial PRIMARY KEY,
  invoice_id integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL,
  payment_date text NOT NULL,
  method text NOT NULL DEFAULT 'Check',
  reference text,
  note text,
  recorded_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice_id ON invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_payment_date ON invoice_payments(payment_date);
