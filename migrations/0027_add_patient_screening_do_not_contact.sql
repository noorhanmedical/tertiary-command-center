-- Patient Directory: explicit DNC + cooldown columns on patient_screenings.
--
-- Today the runtime infers DNC from `outreach_calls.outcome = 'refused_dnc'`
-- and reads cooldown from the separate `cooldown_records` table. These
-- additive columns let the Patient Directory profile + duplicate-warning
-- engine read a single authoritative per-patient flag instead of stitching
-- two sources at read time. Existing rows keep `do_not_contact = false`
-- and `cooldown_*` NULL; no backfill required for compatibility.

ALTER TABLE patient_screenings
  ADD COLUMN IF NOT EXISTS do_not_contact boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS do_not_contact_reason text,
  ADD COLUMN IF NOT EXISTS do_not_contact_set_at timestamp,
  ADD COLUMN IF NOT EXISTS do_not_contact_set_by_user_id varchar
    REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cooldown_start_at timestamp,
  ADD COLUMN IF NOT EXISTS cooldown_until timestamp,
  ADD COLUMN IF NOT EXISTS cooldown_reason text,
  ADD COLUMN IF NOT EXISTS cooldown_set_at timestamp,
  ADD COLUMN IF NOT EXISTS cooldown_set_by_user_id varchar
    REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_patient_screenings_do_not_contact
  ON patient_screenings(do_not_contact);
CREATE INDEX IF NOT EXISTS idx_patient_screenings_cooldown_until
  ON patient_screenings(cooldown_until);
