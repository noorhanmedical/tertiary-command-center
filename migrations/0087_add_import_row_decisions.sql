-- POSSIBLE_MATCH review decisions for large-file patient ingestion (additive).
--
-- When the classifier flags a row as POSSIBLE_MATCH (weak identity overlap or
-- an intra-file duplicate), it is NEVER auto-imported. A manager resolves each
-- one to: use_existing | import_as_new | skip. This table durably persists
-- those resolutions per (import_job, row) so confirm/retry honors them and
-- never re-prompts. It is decision metadata on the existing import job — NOT a
-- second patient system.
--
-- Idempotent + additive; safe on double-apply. Deploy applies schema via
-- `drizzle-kit push` from shared/schema, so this file is the documented
-- companion (the drizzle table `import_row_decisions` is the source of truth).

CREATE TABLE IF NOT EXISTS import_row_decisions (
  id                   serial PRIMARY KEY,
  import_job_id        integer NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  row_index            integer NOT NULL,
  decision             text NOT NULL,             -- use_existing | import_as_new | skip
  matched_screening_id integer,                   -- existing patient (use_existing only)
  resolved_by_user_id  varchar REFERENCES users(id) ON DELETE SET NULL,
  resolved_at          timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ird_job ON import_row_decisions(import_job_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ird_job_row ON import_row_decisions(import_job_id, row_index);
