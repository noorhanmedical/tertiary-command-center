-- Internal direct messages — additive migration, DO NOT RUN AUTOMATICALLY.
--
-- This migration adds ONE new table (direct_messages) and three
-- indexes. It is:
--   • Additive-only (no ALTER TABLE on existing tables).
--   • Non-destructive (no truncation, no destructive column change).
--   • Tenant-scoped (clinic_id NOT NULL, FK cascade on clinic delete).
--   • Internal-only (sender + recipient are FK to `users`; the schema
--     provides no path to patients, no external vendor identifiers).
--
-- Rollback plan:
--   DROP TABLE IF EXISTS direct_messages;   -- cascades the 3 indexes
--
-- Backfill plan: none required. Table starts empty; the runtime keeps
-- the direct-messages endpoints disabled via
-- FEATURE_INTERNAL_DIRECT_MESSAGES until the migration is approved.
--
-- Index review:
--   idx_dm_recipient_clinic covers the read-my-inbox query
--   idx_dm_sender covers sender's outbox
--   idx_dm_created_at supports pagination by created_at DESC
--
-- Tenant-scope review: every read/write MUST filter by clinic_id + the
-- session user's clinic membership. The repository/service layer
-- enforces both.
--
-- Twilio / SMS: NEVER. No column supports external routing.

CREATE TABLE IF NOT EXISTS direct_messages (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  sender_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  read_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dm_recipient_clinic
  ON direct_messages(recipient_user_id, clinic_id);
CREATE INDEX IF NOT EXISTS idx_dm_sender
  ON direct_messages(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_dm_created_at
  ON direct_messages(created_at);
