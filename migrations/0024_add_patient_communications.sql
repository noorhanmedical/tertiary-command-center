-- Canonical patient_communications table.
--
-- Unified read-model entry for every team-member touch on a patient
-- that isn't already captured elsewhere as a dedicated domain row:
-- call, sms, email, marketing_email, marketing_sms, internal_note,
-- system_note. outreach_calls remains the system of record for
-- outreach metrics; this row is the timeline entry for the patient.

CREATE TABLE IF NOT EXISTS patient_communications (
  id serial PRIMARY KEY,
  patient_screening_id integer
    REFERENCES patient_screenings(id) ON DELETE SET NULL,
  execution_case_id integer
    REFERENCES patient_execution_cases(id) ON DELETE SET NULL,
  communication_type text NOT NULL,
  direction text NOT NULL DEFAULT 'outbound',
  status text NOT NULL DEFAULT 'completed',
  outcome text,
  subject text,
  summary text NOT NULL,
  body_preview text,
  body_full text,
  to_address text,
  from_address text,
  phone_number text,
  actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  actor_name_snapshot text,
  facility text,
  related_document_ids jsonb DEFAULT '[]'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  occurred_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  is_test boolean DEFAULT false NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_patient_communications_patient_screening_id
  ON patient_communications(patient_screening_id);
CREATE INDEX IF NOT EXISTS idx_patient_communications_execution_case_id
  ON patient_communications(execution_case_id);
CREATE INDEX IF NOT EXISTS idx_patient_communications_type
  ON patient_communications(communication_type);
CREATE INDEX IF NOT EXISTS idx_patient_communications_actor_user_id
  ON patient_communications(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_patient_communications_occurred_at
  ON patient_communications(occurred_at);
CREATE INDEX IF NOT EXISTS idx_patient_communications_status
  ON patient_communications(status);
