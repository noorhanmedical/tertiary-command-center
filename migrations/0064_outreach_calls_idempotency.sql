-- Canonical call-record closeout — idempotency key on outreach_calls.
--
-- Every real PCS call attempt must create exactly ONE durable outreach_calls
-- row (Call Results reads only this table), regardless of originating surface
-- (Right Rail / CallWorkspace / Engagement workflow / Outreach workflow).
--
-- When a caller supplies a stable external_call_id (client-minted UUID or a
-- phone-provider session id), a repeat submission of the SAME attempt resolves
-- the existing row instead of inserting a duplicate. This partial unique index
-- enforces that at the database level. Partial (WHERE external_call_id IS NOT
-- NULL) so legacy rows without a key are unaffected. Mirrors the
-- uq_cpa_idempotency / uq_cft_idempotency pattern.

CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_calls_external_call_id
  ON outreach_calls (external_call_id)
  WHERE external_call_id IS NOT NULL;
