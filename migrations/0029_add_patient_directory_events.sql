-- Patient Directory: dedicated audit event log.
--
-- The PatientAuditTrailModal currently stitches audit_log +
-- patient_journey_events + outreach_calls + cooldown_records at the
-- client. This table lets writes funnel through a single store keyed by
-- patient_screening_id with a typed `kind` matching the audit-event
-- enum on both client and server.

CREATE TABLE IF NOT EXISTS patient_directory_events (
  id                    serial PRIMARY KEY,
  patient_screening_id  integer REFERENCES patient_screenings(id)
                        ON DELETE SET NULL,
  kind                  text NOT NULL,
  occurred_at           timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_user_id         varchar REFERENCES users(id) ON DELETE SET NULL,
  actor_name            text,
  source_module         text,
  related_entity_type   text,
  related_entity_id     integer,
  title                 text,
  description           text,
  payload               jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_patient_directory_events_patient
  ON patient_directory_events (patient_screening_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_directory_events_kind
  ON patient_directory_events (kind);
CREATE INDEX IF NOT EXISTS idx_patient_directory_events_actor
  ON patient_directory_events (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_patient_directory_events_source_module
  ON patient_directory_events (source_module);
