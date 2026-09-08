-- 0080 — Deterministic tenant clinic_id backfill for the fail-open legacy tables.
-- ADDITIVE + IDEMPOTENT. Safe to re-run. DOES NOT add NOT NULL constraints:
-- rows whose clinic ownership cannot be established DETERMINISTICALLY are left
-- NULL on purpose — the application reads/writes FAIL CLOSED for non-admin
-- users on NULL-clinic rows (they are never returned to a scoped caller).
--
-- Ownership is derived ONLY from canonical relationships, never guessed:
--   patient_clinic_memberships.clinic_id      (fully populated)
--   patient_ancillary_cases.clinic_id         (fully populated; FK links)
--   clinics.name  ==  <table>.facility(_id)    (exact canonical-name match)
--   patient_screenings.clinic_id               (after its own backfill)
--   patient_execution_cases.clinic_id          (after its own backfill)
--
-- A "single distinct" pattern (min(clinic_id) + HAVING count(DISTINCT)=1) only
-- assigns when every linked canonical row agrees on one clinic; ambiguous
-- groups are skipped (left NULL → fail closed).
--
-- Apply manually (NOT auto-run) with fail-fast:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0080_backfill_tenant_clinic_id.sql
--
-- Rollback: clinic_id backfill is not auto-reversible (prior NULLs are not
-- recorded); the added indexes are droppable:
--   DROP INDEX IF EXISTS idx_pec_clinic_id, idx_gse_clinic_id, idx_pe_clinic_id,
--     idx_cdr_clinic_id, idx_oc_clinic_id, idx_ps_clinic_id;

BEGIN;

-- ── 1. patient_screenings.clinic_id ─────────────────────────────────────────
-- a) canonical clinic membership
UPDATE patient_screenings ps
   SET clinic_id = pcm.clinic_id
  FROM patient_clinic_memberships pcm
 WHERE ps.clinic_id IS NULL
   AND ps.patient_clinic_membership_id = pcm.id
   AND pcm.clinic_id IS NOT NULL;
-- b) exact canonical facility name
UPDATE patient_screenings ps
   SET clinic_id = c.id
  FROM clinics c
 WHERE ps.clinic_id IS NULL
   AND ps.facility = c.name;
-- c) single-distinct ancillary case for the screening
UPDATE patient_screenings ps
   SET clinic_id = sub.clinic_id
  FROM (
        SELECT originating_screening_id, MIN(clinic_id) AS clinic_id
          FROM patient_ancillary_cases
         WHERE originating_screening_id IS NOT NULL
         GROUP BY originating_screening_id
        HAVING COUNT(DISTINCT clinic_id) = 1
       ) sub
 WHERE ps.clinic_id IS NULL
   AND ps.id = sub.originating_screening_id;

-- ── 2. patient_execution_cases.clinic_id ────────────────────────────────────
-- a) single-distinct ancillary case linked to the execution case
UPDATE patient_execution_cases pec
   SET clinic_id = sub.clinic_id
  FROM (
        SELECT execution_case_id, MIN(clinic_id) AS clinic_id
          FROM patient_ancillary_cases
         WHERE execution_case_id IS NOT NULL
         GROUP BY execution_case_id
        HAVING COUNT(DISTINCT clinic_id) = 1
       ) sub
 WHERE pec.clinic_id IS NULL
   AND pec.id = sub.execution_case_id;
-- b) originating screening clinic
UPDATE patient_execution_cases pec
   SET clinic_id = ps.clinic_id
  FROM patient_screenings ps
 WHERE pec.clinic_id IS NULL
   AND pec.patient_screening_id = ps.id
   AND ps.clinic_id IS NOT NULL;
-- c) exact canonical facility name
UPDATE patient_execution_cases pec
   SET clinic_id = c.id
  FROM clinics c
 WHERE pec.clinic_id IS NULL
   AND pec.facility_id = c.name;

-- ── 3. global_schedule_events.clinic_id ─────────────────────────────────────
-- a) ancillary case (exact FK)
UPDATE global_schedule_events g
   SET clinic_id = pac.clinic_id
  FROM patient_ancillary_cases pac
 WHERE g.clinic_id IS NULL
   AND g.ancillary_case_id = pac.id;
-- b) execution case
UPDATE global_schedule_events g
   SET clinic_id = pec.clinic_id
  FROM patient_execution_cases pec
 WHERE g.clinic_id IS NULL
   AND g.execution_case_id = pec.id
   AND pec.clinic_id IS NOT NULL;
-- c) screening
UPDATE global_schedule_events g
   SET clinic_id = ps.clinic_id
  FROM patient_screenings ps
 WHERE g.clinic_id IS NULL
   AND g.patient_screening_id = ps.id
   AND ps.clinic_id IS NOT NULL;
-- d) exact canonical facility name
UPDATE global_schedule_events g
   SET clinic_id = c.id
  FROM clinics c
 WHERE g.clinic_id IS NULL
   AND g.facility_id = c.name;

-- ── 4. procedure_events.clinic_id ───────────────────────────────────────────
UPDATE procedure_events pe
   SET clinic_id = pac.clinic_id
  FROM patient_ancillary_cases pac
 WHERE pe.clinic_id IS NULL
   AND pe.ancillary_case_id = pac.id;
UPDATE procedure_events pe
   SET clinic_id = pec.clinic_id
  FROM patient_execution_cases pec
 WHERE pe.clinic_id IS NULL
   AND pe.execution_case_id = pec.id
   AND pec.clinic_id IS NOT NULL;
UPDATE procedure_events pe
   SET clinic_id = ps.clinic_id
  FROM patient_screenings ps
 WHERE pe.clinic_id IS NULL
   AND pe.patient_screening_id = ps.id
   AND ps.clinic_id IS NOT NULL;
UPDATE procedure_events pe
   SET clinic_id = c.id
  FROM clinics c
 WHERE pe.clinic_id IS NULL
   AND pe.facility_id = c.name;

-- ── 5. case_document_readiness.clinic_id (no ancillary_case_id column) ───────
UPDATE case_document_readiness cdr
   SET clinic_id = pec.clinic_id
  FROM patient_execution_cases pec
 WHERE cdr.clinic_id IS NULL
   AND cdr.execution_case_id = pec.id
   AND pec.clinic_id IS NOT NULL;
UPDATE case_document_readiness cdr
   SET clinic_id = ps.clinic_id
  FROM patient_screenings ps
 WHERE cdr.clinic_id IS NULL
   AND cdr.patient_screening_id = ps.id
   AND ps.clinic_id IS NOT NULL;
UPDATE case_document_readiness cdr
   SET clinic_id = c.id
  FROM clinics c
 WHERE cdr.clinic_id IS NULL
   AND cdr.facility_id = c.name;

-- ── 6. outreach_calls.clinic_id (has ancillary_case_id + patient_screening_id; no facility col) ──
UPDATE outreach_calls oc
   SET clinic_id = pac.clinic_id
  FROM patient_ancillary_cases pac
 WHERE oc.clinic_id IS NULL
   AND oc.ancillary_case_id = pac.id;
UPDATE outreach_calls oc
   SET clinic_id = ps.clinic_id
  FROM patient_screenings ps
 WHERE oc.clinic_id IS NULL
   AND oc.patient_screening_id = ps.id
   AND ps.clinic_id IS NOT NULL;

-- ── 7. Indexes for clinic-scoped reads (none existed prior) ──────────────────
CREATE INDEX IF NOT EXISTS idx_ps_clinic_id  ON patient_screenings(clinic_id);
CREATE INDEX IF NOT EXISTS idx_pec_clinic_id ON patient_execution_cases(clinic_id);
CREATE INDEX IF NOT EXISTS idx_gse_clinic_id ON global_schedule_events(clinic_id);
CREATE INDEX IF NOT EXISTS idx_pe_clinic_id  ON procedure_events(clinic_id);
CREATE INDEX IF NOT EXISTS idx_cdr_clinic_id ON case_document_readiness(clinic_id);
CREATE INDEX IF NOT EXISTS idx_oc_clinic_id  ON outreach_calls(clinic_id);

COMMIT;
