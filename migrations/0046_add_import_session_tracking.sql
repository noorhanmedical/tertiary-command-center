-- Patient Directory import-session tracking.
--
-- Stamps each Patient Directory bulk-import run onto its
-- screening_batches row so the Recent Imports panel can show what was
-- imported, by whom, and with which columns — and so minimal-field
-- ("service") imports can park a preview payload while waiting for
-- admin approval.

ALTER TABLE screening_batches
  ADD COLUMN IF NOT EXISTS import_source_fields jsonb,
  ADD COLUMN IF NOT EXISTS import_kind text,
  ADD COLUMN IF NOT EXISTS import_created_by varchar,
  ADD COLUMN IF NOT EXISTS pending_import_payload jsonb;

-- Partial index: the Recent Imports query only touches import batches.
CREATE INDEX IF NOT EXISTS idx_screening_batches_import_sessions
  ON screening_batches (created_at DESC)
  WHERE import_source_fields IS NOT NULL OR pending_import_payload IS NOT NULL;
