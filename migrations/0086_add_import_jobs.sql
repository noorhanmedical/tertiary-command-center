-- Large-file patient ingestion — durable import job ledger (additive).
--
-- A 128 MB+ patient-source file cannot be processed inside a single HTTP
-- request (memory + timeout + one enormous transaction). This table is the
-- DURABLE JOB LEDGER that lets the upload return immediately with a job id,
-- while a background runner streams/parses/validates/imports the file and
-- records progress + counts + errors that the frontend can poll.
--
-- This is NOT a second patient system. Patients still land in the canonical
-- `patient_screenings` (one batch per job via `screening_batches`). This table
-- only tracks the *processing* of an uploaded artifact. It mirrors the shape
-- of `analysis_jobs` / `engagement_reconciliation_runs` (a run/job ledger).
--
-- All columns additive; no existing table's semantics change. Safe to apply
-- independently — nothing reads it until the large-import routes are wired.

CREATE TABLE IF NOT EXISTS import_jobs (
  id                    serial PRIMARY KEY,
  -- Tenant + actor. clinic_id is the authoritative facility/tenant boundary.
  clinic_id             integer REFERENCES clinics(id) ON DELETE SET NULL,
  created_by_user_id    varchar REFERENCES users(id) ON DELETE SET NULL,

  -- Lifecycle: uploaded → parsing → validating → preview_ready →
  --            importing → completed | failed | cancelled
  status                text NOT NULL DEFAULT 'uploaded',
  kind                  text NOT NULL DEFAULT 'large_file',

  -- Idempotency: a client-supplied stable key collapses accidental
  -- double-submits of the same upload to ONE job (partial-unique below).
  idempotency_key       text,

  -- Uploaded artifact metadata (the file itself is staged on disk, NOT in DB).
  original_filename     text,
  mime_type             text,
  byte_size             bigint,
  file_format           text,            -- csv | tsv | xlsx | pdf | image | unknown
  temp_path             text,            -- server-side staged temp file path

  -- Facility attribution: from an explicit file column, or import-level pick.
  facility              text,
  facility_source       text,            -- 'column' | 'import_selection'

  -- Detected structure (for XLSX especially): which sheet holds patients,
  -- the header→field column mapping, and a workbook structure summary
  -- (sheet list, media/embedded-asset count, useful data size).
  detected_sheet        text,
  detected_columns      jsonb NOT NULL DEFAULT '{}'::jsonb,
  workbook_info         jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Chunking / progress cursor (resumable).
  chunk_size            integer NOT NULL DEFAULT 500,
  total_chunks          integer NOT NULL DEFAULT 0,
  processed_chunks      integer NOT NULL DEFAULT 0,
  cursor_row            integer NOT NULL DEFAULT 0,

  -- Counts (validation + import outcome).
  total_rows            integer NOT NULL DEFAULT 0,
  valid_rows            integer NOT NULL DEFAULT 0,
  invalid_rows          integer NOT NULL DEFAULT 0,
  duplicate_rows        integer NOT NULL DEFAULT 0,
  new_rows              integer NOT NULL DEFAULT 0,
  existing_rows         integer NOT NULL DEFAULT 0,
  possible_rows         integer NOT NULL DEFAULT 0,
  imported_rows         integer NOT NULL DEFAULT 0,

  -- Small bounded preview (first N normalized+classified rows) — NEVER the
  -- full dataset, so polling the browser stays cheap at 15k rows.
  preview               jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings              jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Failure surface (visible, never a silent 0).
  error_type            text,            -- e.g. parse_failed | validation_failed | write_failed
  error_message         text,
  retryable             boolean NOT NULL DEFAULT true,

  -- The canonical batch created for this import (one batch per job).
  batch_id              integer REFERENCES screening_batches(id) ON DELETE SET NULL,

  -- Retention: temp artifact + job row are eligible for cleanup after this.
  expires_at            timestamp,
  is_test               boolean NOT NULL DEFAULT false,

  started_at            timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at          timestamp
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status);
CREATE INDEX IF NOT EXISTS idx_import_jobs_clinic ON import_jobs(clinic_id);
CREATE INDEX IF NOT EXISTS idx_import_jobs_created_by ON import_jobs(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_import_jobs_batch ON import_jobs(batch_id);

-- Idempotency: at most one job per (clinic, idempotency_key) when supplied.
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_jobs_idempotency
  ON import_jobs (clinic_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- MRN dependency: bulk dedup uses the facility+MRN+DOB / MRN+DOB tiers, so the
-- mrn column (originally migration 0026) MUST exist. Guarded so this migration
-- is self-sufficient on any database where 0026 was never applied.
ALTER TABLE patient_screenings
  ADD COLUMN IF NOT EXISTS mrn text;
CREATE INDEX IF NOT EXISTS idx_patient_screenings_mrn ON patient_screenings(mrn);

-- Row-level idempotency on re-run: stamp each imported patient with the
-- owning import job + its source row index. A retry that re-processes a
-- chunk can skip rows already written for (import_job_id, import_row_index).
ALTER TABLE patient_screenings
  ADD COLUMN IF NOT EXISTS import_job_id integer REFERENCES import_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS import_row_index integer;

CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_screenings_import_job_row
  ON patient_screenings (import_job_id, import_row_index)
  WHERE import_job_id IS NOT NULL AND import_row_index IS NOT NULL;
