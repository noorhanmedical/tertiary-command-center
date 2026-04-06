-- Add explicit indexes on frequently queried columns
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_screening_batches_status" ON "screening_batches" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_screening_batches_schedule_date" ON "screening_batches" ("schedule_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_patient_screenings_batch_id" ON "patient_screenings" ("batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_patient_screenings_status" ON "patient_screenings" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_patient_screenings_appointment_status" ON "patient_screenings" ("appointment_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_patient_test_history_patient_name" ON "patient_test_history" ("patient_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_patient_test_history_date_of_service" ON "patient_test_history" ("date_of_service");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_patient_reference_data_patient_name" ON "patient_reference_data" ("patient_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_generated_notes_patient_id" ON "generated_notes" ("patient_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_generated_notes_batch_id" ON "generated_notes" ("batch_id");
