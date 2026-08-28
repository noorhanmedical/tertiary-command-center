-- Phase 3C (Team Ops) — first-class call_handoffs entity (decision K6).
--
-- Additive only. A handoff transfers/requests ownership of a specific call
-- case from one team member to another. Live ownership remains on
-- patient_execution_cases.assignedTeamMemberId (K8); this table is the
-- transfer source of truth: priority, deadline, acknowledgement, provenance.
-- Idempotent (IF NOT EXISTS) per the repo migration convention.

CREATE TABLE IF NOT EXISTS call_handoffs (
  id                      SERIAL PRIMARY KEY,
  execution_case_id       INTEGER NOT NULL REFERENCES patient_execution_cases(id) ON DELETE CASCADE,
  patient_screening_id    INTEGER REFERENCES patient_screenings(id) ON DELETE SET NULL,
  from_user_id            VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  to_user_id              VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  facility_id             TEXT,
  priority_level          TEXT NOT NULL DEFAULT 'P3',
  reason                  TEXT NOT NULL,
  note                    TEXT,
  due_at                  TIMESTAMP,
  status                  TEXT NOT NULL DEFAULT 'pending',
  source                  TEXT NOT NULL DEFAULT 'peer',
  manager_override        BOOLEAN NOT NULL DEFAULT FALSE,
  viewed_at               TIMESTAMP,
  acknowledged_at         TIMESTAMP,
  acknowledged_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  completed_at            TIMESTAMP,
  cancelled_at            TIMESTAMP,
  cancelled_by_user_id    VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  created_by_user_id      VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  metadata                JSONB,
  created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_call_handoffs_execution_case ON call_handoffs(execution_case_id);
CREATE INDEX IF NOT EXISTS idx_call_handoffs_to_user ON call_handoffs(to_user_id);
CREATE INDEX IF NOT EXISTS idx_call_handoffs_from_user ON call_handoffs(from_user_id);
CREATE INDEX IF NOT EXISTS idx_call_handoffs_status ON call_handoffs(status);
CREATE INDEX IF NOT EXISTS idx_call_handoffs_priority ON call_handoffs(priority_level);
CREATE INDEX IF NOT EXISTS idx_call_handoffs_facility ON call_handoffs(facility_id);
