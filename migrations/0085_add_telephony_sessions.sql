-- Phase 6 — TELEPHONY SESSIONS (provider evidence only; additive).
--
-- A provider-backed call begins BEFORE the employee records a business
-- disposition, and provider events (ringing / answered / ended / duration) may
-- arrive late, duplicated, or out of order. The canonical business record
-- outreach_calls CANNOT hold this: outreach_calls.outcome is NOT NULL + a
-- business enum and drives Call Results / KPIs, so a provisional
-- "ringing/in_progress" row would corrupt metrics and violate "one row per
-- real attempt". This minimal table holds provider TELEPHONY EVIDENCE until
-- disposition; at disposition the ONE outreach_calls row is written and linked
-- to this session's provider id + duration.
--
-- NOT a call-history / disposition / assignment / communication-timeline
-- system. provider_state is a LINE-LEVEL fact (connected != "reached") — it
-- NEVER becomes a business outcome. All columns additive; no existing table is
-- modified, so pre-Phase-6 behavior is exactly preserved.

CREATE TABLE IF NOT EXISTS telephony_sessions (
  id                     serial PRIMARY KEY,
  provider               text NOT NULL,
  provider_session_id    text,
  execution_case_id      integer REFERENCES patient_execution_cases(id) ON DELETE SET NULL,
  patient_screening_id   integer REFERENCES patient_screenings(id) ON DELETE SET NULL,
  acting_scheduler_id    integer REFERENCES outreach_schedulers(id) ON DELETE SET NULL,
  acting_user_id         varchar REFERENCES users(id) ON DELETE SET NULL,
  direction              text NOT NULL DEFAULT 'outbound',
  provider_state         text NOT NULL DEFAULT 'initiated',
  started_at             timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  connected_at           timestamp,
  ended_at               timestamp,
  duration_seconds       integer,
  last_provider_event_at timestamp,
  event_seq              integer,
  created_at             timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Idempotent provider-session correlation. Partial (WHERE NOT NULL) so
-- manual / external-assisted rows without a provider id are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_telephony_sessions_provider_session_id
  ON telephony_sessions (provider, provider_session_id)
  WHERE provider_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_telephony_sessions_execution_case
  ON telephony_sessions (execution_case_id);
CREATE INDEX IF NOT EXISTS idx_telephony_sessions_screening
  ON telephony_sessions (patient_screening_id);
CREATE INDEX IF NOT EXISTS idx_telephony_sessions_scheduler
  ON telephony_sessions (acting_scheduler_id);
