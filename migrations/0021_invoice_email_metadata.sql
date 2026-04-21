ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_to text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_at timestamp;
