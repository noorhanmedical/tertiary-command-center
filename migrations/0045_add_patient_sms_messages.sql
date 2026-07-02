-- Patient SMS messages — real two-way texting threads (Task #648).
-- See shared/schema/patientSms.ts for the typed mirror. Outbound rows are
-- only recorded after Twilio accepts the send (or as status "failed" with
-- the provider error); inbound rows come from the Twilio webhook.

CREATE TABLE IF NOT EXISTS "patient_sms_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "patient_phone" text NOT NULL,
  "patient_name" text,
  "patient_screening_id" integer,
  "direction" text NOT NULL,
  "body" text NOT NULL,
  "sender_user_id" varchar,
  "provider_sid" text,
  "status" text NOT NULL,
  "error_message" text,
  "read_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "patient_sms_messages"
    ADD CONSTRAINT "patient_sms_messages_sender_user_id_fk"
    FOREIGN KEY ("sender_user_id")
    REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "patient_sms_messages_phone_idx" ON "patient_sms_messages" ("patient_phone");
CREATE INDEX IF NOT EXISTS "patient_sms_messages_created_idx" ON "patient_sms_messages" ("created_at");
