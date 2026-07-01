-- Direct (1:1) team-member messages for the Team Portal messaging tray.
-- See shared/schema/directMessages.ts for the typed mirror. Sender is always
-- taken from the server session, so attribution cannot be forged.

CREATE TABLE IF NOT EXISTS "direct_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "sender_user_id" varchar NOT NULL,
  "recipient_user_id" varchar NOT NULL,
  "body" text NOT NULL,
  "read_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "direct_messages"
    ADD CONSTRAINT "direct_messages_sender_user_id_fk"
    FOREIGN KEY ("sender_user_id")
    REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "direct_messages"
    ADD CONSTRAINT "direct_messages_recipient_user_id_fk"
    FOREIGN KEY ("recipient_user_id")
    REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "direct_messages_pair_idx" ON "direct_messages" ("sender_user_id", "recipient_user_id");
CREATE INDEX IF NOT EXISTS "direct_messages_recipient_idx" ON "direct_messages" ("recipient_user_id");
