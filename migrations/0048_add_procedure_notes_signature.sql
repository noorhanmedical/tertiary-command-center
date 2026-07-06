-- Physician Owner Portal signature state machine — additive, nullable.
--
-- Adds four columns + one index to `procedure_notes` so the dormant
-- signingService.ts state machine has real columns to write into. The
-- signing flow lives in the same table as note generation / billing
-- readiness (no parallel store), per the canonical-spine rule.
--
-- See shared/schema/generatedNotes.ts (SIGNATURE_STATUSES enum) and
-- server/routes/physicianPortal.ts.
--
-- Every column is nullable so legacy rows stay valid:
--   - signature_status     text       (NULL = not yet in the signing pipeline)
--   - signed_at            timestamp  (NULL until signed)
--   - signed_by_user_id    varchar    (NULL until signed; FK → users.id ON DELETE SET NULL)
--   - return_reason        text       (NULL unless `returned_for_correction`)
--
-- The status string is constrained at the application layer to one of
-- the SignatureStatus enum values:
--   needs_signature · ready_to_sign · signed · returned_for_correction
-- No DB CHECK constraint is added because the existing patterns in this
-- codebase enforce statuses in TypeScript / drizzle, not in SQL.
--
-- One-way safe: dropping the columns would lose signing-state history
-- but does not break any other table or query (signing reads default to
-- NULL meaning "not yet in pipeline").

ALTER TABLE "procedure_notes"
  ADD COLUMN IF NOT EXISTS "signature_status"    text,
  ADD COLUMN IF NOT EXISTS "signed_at"           timestamp,
  ADD COLUMN IF NOT EXISTS "signed_by_user_id"   varchar
    REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "return_reason"       text;

CREATE INDEX IF NOT EXISTS "idx_pn_signature_status"
  ON "procedure_notes" ("signature_status");
