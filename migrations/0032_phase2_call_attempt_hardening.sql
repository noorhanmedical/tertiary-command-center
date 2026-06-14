-- Phase 2 hardening — canonical call-attempt tracking on
-- patient_execution_cases. See shared/schema/executionCase.ts.

ALTER TABLE "patient_execution_cases"
  ADD COLUMN IF NOT EXISTS "call_attempt_count" integer NOT NULL DEFAULT 0;

ALTER TABLE "patient_execution_cases"
  ADD COLUMN IF NOT EXISTS "last_attempt_at" timestamp;

ALTER TABLE "patient_execution_cases"
  ADD COLUMN IF NOT EXISTS "last_call_outcome" text;

ALTER TABLE "patient_execution_cases"
  ADD COLUMN IF NOT EXISTS "unable_to_reach_at" timestamp;

CREATE INDEX IF NOT EXISTS "idx_execution_cases_call_attempt_count"
  ON "patient_execution_cases" ("call_attempt_count");

CREATE INDEX IF NOT EXISTS "idx_execution_cases_unable_to_reach_at"
  ON "patient_execution_cases" ("unable_to_reach_at");
