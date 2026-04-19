-- Compound indexes to keep patient lookups fast as data grows.
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_patient_screenings_name_dob" ON "patient_screenings" ("name", "dob");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_patient_test_history_name_dob_test_dos" ON "patient_test_history" ("patient_name", "dob", "test_name", "date_of_service");
