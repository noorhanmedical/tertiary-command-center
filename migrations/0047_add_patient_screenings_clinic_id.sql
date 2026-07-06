-- Migration 0047: Add clinic_id to patient_screenings (multi-tenancy)
--
-- Mirrors the nullable clinic_id FK that upstream added to screening_batches
-- (and ~30 other tables). The column is intentionally NULLABLE:
--   - "nullable during backfill; filter enforced in repository layer"
--   - a NULL clinic_id means "not yet scoped to a clinic" (admin bypass path in
--     server/repositories/screening.repo.ts clinicFilterScreening()).
--
-- NOTE ON APPLY MECHANISM: this repo syncs the Drizzle schema to the database
-- via `drizzle-kit push --force` at container boot (see Dockerfile CMD), so the
-- column itself is created from shared/schema/screening.ts. This numbered file
-- documents the change and — importantly — carries the BACKFILL that push does
-- not perform. It is written to be idempotent and safe to run standalone.

-- 1) Column + FK (idempotent; push may have already created it).
ALTER TABLE patient_screenings
  ADD COLUMN IF NOT EXISTS clinic_id INTEGER
    REFERENCES clinics (id) ON DELETE SET NULL;

-- 2) Index for tenant-scoped reads.
CREATE INDEX IF NOT EXISTS idx_patient_screenings_clinic_id
  ON patient_screenings (clinic_id);

-- 3) Backfill from the owning batch's clinic_id via the batch_id relationship.
--    Only touches rows that are still unscoped, so existing values are preserved
--    and re-running is a no-op.
UPDATE patient_screenings ps
   SET clinic_id = sb.clinic_id
  FROM screening_batches sb
 WHERE ps.batch_id = sb.id
   AND ps.clinic_id IS NULL
   AND sb.clinic_id IS NOT NULL;
