-- Phase 6A (Team Ops resilience) — unified operational NOTIFICATIONS.
--
-- Additive only. A lightweight canonical DELIVERY/SIGNAL layer — NOT a second
-- source of truth for messages, tasks, handoffs, or calls. Each row points at
-- the canonical business record (taskId / handoffId / conversationId /
-- executionCaseId / patientScreeningId) so a click-through opens the real
-- workspace; the notification itself carries only minimal PHI (a short,
-- operator-facing title/body). One recipient per row.
--
-- Read/ack lifecycle: readAt (seen in the center), acknowledgedAt (explicit
-- ack for high-signal items like P1/P2 handoffs). expiresAt lets low-value
-- rows self-expire. Idempotent per the repo migration convention.

CREATE TABLE IF NOT EXISTS notifications (
  id                    SERIAL PRIMARY KEY,
  recipient_user_id     VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                  TEXT NOT NULL,
  -- HIGH | NORMAL | LOW — drives fatigue rules + center ordering.
  severity              TEXT NOT NULL DEFAULT 'NORMAL',
  title                 TEXT NOT NULL,
  -- Short operator-facing context line. Keep PHI minimal.
  short_body            TEXT,
  -- Canonical record pointers (all optional; a click-through uses whichever
  -- is present to open the right workspace). We DO NOT duplicate the record.
  patient_screening_id  INTEGER REFERENCES patient_screenings(id) ON DELETE SET NULL,
  execution_case_id     INTEGER,
  task_id               INTEGER,
  handoff_id            INTEGER,
  conversation_id       INTEGER,
  facility_id           TEXT,
  priority_level        TEXT,
  -- Dedupe key so the same operational signal (e.g. one handoff) does not spawn
  -- duplicate rows on ret/re-emit. NULL = never deduped.
  dedupe_key            TEXT,
  metadata              JSONB,
  read_at               TIMESTAMP,
  acknowledged_at       TIMESTAMP,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at            TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
  ON notifications(recipient_user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
-- Dedupe: at most one live (unexpired) row per (recipient, dedupe_key).
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe
  ON notifications(recipient_user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
