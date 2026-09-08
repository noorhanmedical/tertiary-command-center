-- Phase 4 — ACTIVE-WORK CLAIM / LEASE (additive, backward-compatible).
--
-- Adds a server-authoritative "this team member is ACTIVELY working this case
-- right now" claim to patient_execution_cases. This is DIFFERENT from ownership
-- (assigned_team_member_id) and from disposition state (engagement_status /
-- lifecycle_status): it exists to prevent two employees / automations from
-- concurrently working or redistributing the same patient's case.
--
-- A claim is ACTIVE only while:  active_claim_by IS NOT NULL
--                            AND active_claim_expires_at > now()
-- Expiry is IMPLICIT — a crashed browser's claim simply becomes ignorable and
-- the next claimant overwrites it. No background sweeper / manual cleanup, no
-- permanent lock rows.
--
-- These columns NEVER change engagement_status / lifecycle_status /
-- next_action_at / call_attempt_count. Acquiring/releasing a claim is not a
-- disposition and must never contaminate KPI/attempt metrics.
--
-- All columns are NULLABLE with NO default → every existing row is unclaimed
-- (active_claim_by = NULL) after this migration, so pre-Phase-4 behavior is
-- exactly preserved (no claim == pre-Phase-4).
--
-- active_claim_by mirrors assigned_team_member_id (an outreach_schedulers.id),
-- with ON DELETE SET NULL so a removed roster member cannot leave a dangling
-- claim (an ownership row would simply become unclaimed).

ALTER TABLE patient_execution_cases
  ADD COLUMN IF NOT EXISTS active_claim_by integer
    REFERENCES outreach_schedulers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS active_claim_at timestamp,
  ADD COLUMN IF NOT EXISTS active_claim_expires_at timestamp;

-- Partial index: only the (small) set of currently-claimed cases is indexed.
-- Supports the sibling-claim eligibility subquery and the absence-watcher
-- "does this member hold an active claim right now" lookup without bloating
-- the index for the overwhelmingly-unclaimed majority of rows.
CREATE INDEX IF NOT EXISTS idx_pec_active_claim_by
  ON patient_execution_cases (active_claim_by)
  WHERE active_claim_by IS NOT NULL;
