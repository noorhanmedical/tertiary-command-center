-- 0081 — Occurrence-aware ancillary readiness key.
-- ADDITIVE + IDEMPOTENT. Safe to re-run. Fixes the P0 collision where two
-- occurrences of the SAME service on ONE execution case shared a single
-- case_document_readiness row (old app-level key: execution_case_id +
-- service_type + document_type — NOT occurrence-aware).
--
-- CANONICAL PROCEDURE OCCURRENCE ID = patient_ancillary_cases.id
-- (the per-service ancillary occurrence row — the same identity the READ
-- resolver already prefers and that the canonical appointment/procedure use).
--
-- What this does:
--   1. Adds case_document_readiness.ancillary_case_id (nullable; FK → SET NULL).
--   2. Deterministically backfills it ONLY from the id the write path already
--      stamped into metadata->>'ancillaryCaseId' AND only when that id actually
--      exists in patient_ancillary_cases. No guessing: rows without a stamped,
--      valid occurrence id are left NULL (they keep legacy single-occurrence
--      behavior; the app-level upsert continues to key them by
--      execution_case_id + service_type + document_type when no occurrence id
--      is supplied).
--   3. Adds a supporting index.
--   4. Adds a PARTIAL UNIQUE index enforcing ONE readiness row per
--      (execution_case_id, ancillary_case_id, service_type, document_type) for
--      OCCURRENCE-KEYED rows only (WHERE ancillary_case_id IS NOT NULL). Legacy
--      NULL-occurrence rows are unaffected. clinic_id is intentionally NOT part
--      of the key: ancillary_case_id already anchors the tenant (a
--      patient_ancillary_cases row belongs to exactly one clinic).
--
-- Apply manually (NOT auto-run) with fail-fast:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0081_readiness_occurrence_key.sql
--
-- Rollback (dev): DROP INDEX IF EXISTS uq_cdr_occurrence, idx_cdr_ancillary_case_id;
--   ALTER TABLE case_document_readiness DROP COLUMN IF EXISTS ancillary_case_id;

BEGIN;

ALTER TABLE case_document_readiness
  ADD COLUMN IF NOT EXISTS ancillary_case_id INTEGER;

-- FK → patient_ancillary_cases(id) ON DELETE SET NULL (guarded / idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'fk_cdr_ancillary_case'
       AND table_name = 'case_document_readiness'
  ) THEN
    ALTER TABLE case_document_readiness
      ADD CONSTRAINT fk_cdr_ancillary_case
      FOREIGN KEY (ancillary_case_id)
      REFERENCES patient_ancillary_cases(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Deterministic backfill: ONLY from a previously-stamped, VALID occurrence id.
UPDATE case_document_readiness cdr
   SET ancillary_case_id = (cdr.metadata->>'ancillaryCaseId')::int
 WHERE cdr.ancillary_case_id IS NULL
   AND (cdr.metadata->>'ancillaryCaseId') ~ '^[0-9]+$'
   AND EXISTS (
        SELECT 1 FROM patient_ancillary_cases pac
         WHERE pac.id = (cdr.metadata->>'ancillaryCaseId')::int
       );

CREATE INDEX IF NOT EXISTS idx_cdr_ancillary_case_id
  ON case_document_readiness(ancillary_case_id);

-- One readiness/doc-type per ACTUAL occurrence (occurrence-keyed rows only).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cdr_occurrence
  ON case_document_readiness(execution_case_id, ancillary_case_id, service_type, document_type)
  WHERE ancillary_case_id IS NOT NULL;

COMMIT;

-- ── Verification queries (run after apply) ──────────────────────────────────
--  total rows:            SELECT count(*) FROM case_document_readiness;
--  occurrence-keyed rows: SELECT count(*) FROM case_document_readiness WHERE ancillary_case_id IS NOT NULL;
--  legacy NULL rows:      SELECT count(*) FROM case_document_readiness WHERE ancillary_case_id IS NULL;
--  dup groups (must = 0):
--    SELECT count(*) FROM (
--      SELECT execution_case_id, ancillary_case_id, service_type, document_type
--        FROM case_document_readiness WHERE ancillary_case_id IS NOT NULL
--       GROUP BY 1,2,3,4 HAVING count(*) > 1) d;
--  index present:
--    SELECT indexname FROM pg_indexes WHERE tablename='case_document_readiness'
--      AND indexname IN ('uq_cdr_occurrence','idx_cdr_ancillary_case_id');
