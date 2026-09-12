-- Bulk-import correction state (additive). Persists manager-approved column
-- mapping corrections and per-row overrides on the import job so a staged
-- import can be re-normalized deterministically BEFORE any patient is written.
-- The original uploaded file is never mutated. Idempotent; deploy applies
-- schema via drizzle-kit push (this file is the documented companion).

ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS column_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS row_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;
