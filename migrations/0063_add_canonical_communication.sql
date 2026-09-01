-- Phase 13 — Canonical multi-channel communication on outreach_calls.
-- ADDITIVE ONLY: extends the existing outreach_calls table with the canonical
-- communication fields (channel/direction/service linkage/staff/next action/
-- source/refs). Reuses the existing table + outcome vocabulary; no redundant
-- call system. All columns nullable/defaulted so existing writes are unchanged.

ALTER TABLE outreach_calls ADD COLUMN IF NOT EXISTS clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL;
ALTER TABLE outreach_calls ADD COLUMN IF NOT EXISTS patient_name TEXT;
ALTER TABLE outreach_calls ADD COLUMN IF NOT EXISTS patient_dob TEXT;
ALTER TABLE outreach_calls ADD COLUMN IF NOT EXISTS ancillary_case_id INTEGER;
ALTER TABLE outreach_calls ADD COLUMN IF NOT EXISTS service_type TEXT;
ALTER TABLE outreach_calls ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'phone';
ALTER TABLE outreach_calls ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'outbound';
ALTER TABLE outreach_calls ADD COLUMN IF NOT EXISTS destination TEXT;
ALTER TABLE outreach_calls ADD COLUMN IF NOT EXISTS staff_name TEXT;
ALTER TABLE outreach_calls ADD COLUMN IF NOT EXISTS staff_role TEXT;
ALTER TABLE outreach_calls ADD COLUMN IF NOT EXISTS ended_at TIMESTAMP;
ALTER TABLE outreach_calls ADD COLUMN IF NOT EXISTS disposition TEXT;
ALTER TABLE outreach_calls ADD COLUMN IF NOT EXISTS next_action TEXT;
ALTER TABLE outreach_calls ADD COLUMN IF NOT EXISTS source_system TEXT DEFAULT 'plexus';
ALTER TABLE outreach_calls ADD COLUMN IF NOT EXISTS external_call_id TEXT;
ALTER TABLE outreach_calls ADD COLUMN IF NOT EXISTS recording_ref TEXT;
ALTER TABLE outreach_calls ADD COLUMN IF NOT EXISTS transcript_ref TEXT;
ALTER TABLE outreach_calls ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE outreach_calls ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_outreach_calls_ancillary_case ON outreach_calls(ancillary_case_id);
CREATE INDEX IF NOT EXISTS idx_outreach_calls_channel ON outreach_calls(channel);
