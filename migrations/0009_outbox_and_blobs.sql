CREATE TABLE IF NOT EXISTS "document_blobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "owner_type" text NOT NULL,
  "owner_id" integer NOT NULL,
  "filename" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "sha256" text NOT NULL,
  "storage_path" text NOT NULL,
  "is_test" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_document_blobs_owner" ON "document_blobs" ("owner_type","owner_id");
CREATE INDEX IF NOT EXISTS "idx_document_blobs_is_test" ON "document_blobs" ("is_test");

CREATE TABLE IF NOT EXISTS "outbox_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "blob_id" integer,
  "facility" text,
  "patient_name" text,
  "ancillary_type" text,
  "doc_kind" text,
  "target_folder_id" text,
  "target_sheet_id" text,
  "filename" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "error_text" text,
  "result_id" text,
  "result_url" text,
  "is_test" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "last_attempt_at" timestamp,
  "completed_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_outbox_items_status" ON "outbox_items" ("status");
CREATE INDEX IF NOT EXISTS "idx_outbox_items_kind" ON "outbox_items" ("kind");
CREATE INDEX IF NOT EXISTS "idx_outbox_items_is_test" ON "outbox_items" ("is_test");

ALTER TABLE "screening_batches"  ADD COLUMN IF NOT EXISTS "is_test" boolean DEFAULT false NOT NULL;
ALTER TABLE "patient_screenings" ADD COLUMN IF NOT EXISTS "is_test" boolean DEFAULT false NOT NULL;
ALTER TABLE "generated_notes"    ADD COLUMN IF NOT EXISTS "is_test" boolean DEFAULT false NOT NULL;
ALTER TABLE "billing_records"    ADD COLUMN IF NOT EXISTS "is_test" boolean DEFAULT false NOT NULL;
ALTER TABLE "uploaded_documents" ADD COLUMN IF NOT EXISTS "is_test" boolean DEFAULT false NOT NULL;
