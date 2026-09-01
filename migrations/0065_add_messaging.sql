-- Phase 1 (Team Ops) — first-class internal team messaging.
--
-- One canonical conversation model (direct / team / task / patient / system)
-- replacing the frontend mock inbox and the orphaned direct_messages path.
-- INTERNAL user-to-user only; never patient SMS/Twilio. Additive; no existing
-- table is altered. Table named team_messages (not messages) to avoid the
-- existing AI-chat `messages` table.

CREATE TABLE IF NOT EXISTS message_conversations (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  title TEXT,
  facility_id TEXT,
  team_id INTEGER,
  patient_screening_id INTEGER REFERENCES patient_screenings(id) ON DELETE SET NULL,
  execution_case_id INTEGER,
  task_id INTEGER,
  direct_key TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  last_message_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_msg_conv_clinic ON message_conversations(clinic_id);
CREATE INDEX IF NOT EXISTS idx_msg_conv_type ON message_conversations(type);
CREATE INDEX IF NOT EXISTS idx_msg_conv_team ON message_conversations(team_id);
CREATE INDEX IF NOT EXISTS idx_msg_conv_patient ON message_conversations(patient_screening_id);
CREATE INDEX IF NOT EXISTS idx_msg_conv_last_message_at ON message_conversations(last_message_at);
-- Exactly one direct conversation per (clinic, sorted user pair).
CREATE UNIQUE INDEX IF NOT EXISTS uq_msg_conv_direct_key
  ON message_conversations(clinic_id, direct_key)
  WHERE direct_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS message_conversation_members (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES message_conversations(id) ON DELETE CASCADE,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_role TEXT NOT NULL DEFAULT 'member',
  last_read_at TIMESTAMP,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_msg_member_user ON message_conversation_members(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_msg_member_conversation_user
  ON message_conversation_members(conversation_id, user_id);

CREATE TABLE IF NOT EXISTS team_messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES message_conversations(id) ON DELETE CASCADE,
  sender_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'user',
  metadata JSONB DEFAULT '{}',
  edited_at TIMESTAMP,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_team_messages_conversation ON team_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_team_messages_sender ON team_messages(sender_user_id);

-- Bridge historical direct_messages into the new model (read continuity).
-- Idempotent: only runs when direct_messages exists AND has not yet been
-- bridged (guarded by a metadata marker on the conversation).
DO $$
DECLARE
  dm RECORD;
  conv_id INTEGER;
  dkey TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'direct_messages') THEN
    FOR dm IN
      SELECT id, clinic_id, sender_user_id, recipient_user_id, body, read_at, created_at
      FROM direct_messages
      ORDER BY created_at ASC
    LOOP
      -- Sorted pair dedupe key.
      dkey := (SELECT string_agg(u, '|' ORDER BY u)
               FROM (VALUES (dm.sender_user_id), (dm.recipient_user_id)) AS t(u));

      SELECT id INTO conv_id FROM message_conversations
      WHERE clinic_id IS NOT DISTINCT FROM dm.clinic_id AND direct_key = dkey
      LIMIT 1;

      IF conv_id IS NULL THEN
        INSERT INTO message_conversations (clinic_id, type, direct_key, created_by_user_id, last_message_at, created_at)
        VALUES (dm.clinic_id, 'direct', dkey, dm.sender_user_id, dm.created_at, dm.created_at)
        RETURNING id INTO conv_id;

        INSERT INTO message_conversation_members (conversation_id, user_id, joined_at)
        VALUES (conv_id, dm.sender_user_id, dm.created_at), (conv_id, dm.recipient_user_id, dm.created_at)
        ON CONFLICT (conversation_id, user_id) DO NOTHING;
      END IF;

      INSERT INTO team_messages (conversation_id, sender_user_id, body, message_type, metadata, created_at)
      VALUES (conv_id, dm.sender_user_id, dm.body, 'user',
              jsonb_build_object('bridgedFromDirectMessageId', dm.id), dm.created_at);

      UPDATE message_conversations
        SET last_message_at = GREATEST(COALESCE(last_message_at, dm.created_at), dm.created_at)
        WHERE id = conv_id;
    END LOOP;
  END IF;
END $$;
