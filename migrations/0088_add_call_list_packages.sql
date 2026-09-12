-- Engagement Call List — FROZEN DISTRIBUTION SNAPSHOT / SHARE PACKAGES.
--
-- Two dedicated, additive tables. These hold the immutable historical record
-- of "what this manager distributed to this employee at this moment". They are
-- NOT the live source of truth (that stays on patient_execution_cases +
-- /api/scheduler-portal/cases) and are never read by the live call list or the
-- distribution allocator. Gated at runtime by
-- FEATURE_ENGAGEMENT_CALL_LIST_PACKAGES (default OFF); this migration is NOT
-- applied automatically.
--
-- SECURITY: only the sha256 HEX HASH of the share bearer token is stored. The
-- plaintext token is returned to the manager once at create/regenerate and is
-- never persisted. No PHI is ever placed in a token or URL.
--
-- ─── REQUIRED DEPLOY ORDER (deploy-blocker) ─────────────────────────────────
--   1. Deploy the backward-compatible server/schema code (flags OFF).
--   2. Apply THIS migration (0088).
--   3. Verify tables/indexes/constraints exist + blob ownerType 'call_list_package'.
--   4. Verify package endpoints in staging.
--   5. Enable server flag FEATURE_ENGAGEMENT_CALL_LIST_PACKAGES.
--   6. Enable client flag VITE_FEATURE_ENGAGEMENT_CALL_LIST_PACKAGES.
-- The server flag is authoritative. If the server flag is ON but this migration
-- is absent, the surface FAILS SAFELY: reads return 503 (repo safeRead) and the
-- confirm write returns 503 (ensureSchemaReady) — never a silent/partial write.
-- Schedule the 90-day snapshot purge: `npm run purge:call-list-packages`.

CREATE TABLE IF NOT EXISTS call_list_packages (
  id                        serial PRIMARY KEY,
  clinic_id                 integer REFERENCES clinics(id) ON DELETE SET NULL,
  facility_id               text NOT NULL,
  -- outreach_schedulers.id — no FK by design (mirrors
  -- patient_execution_cases.assigned_team_member_id) so a roster change never
  -- rewrites frozen history.
  team_member_id            integer NOT NULL,
  team_member_name_snapshot text,
  generated_by_user_id      varchar REFERENCES users(id) ON DELETE SET NULL,
  service_date              text,
  distribution_operation_id text NOT NULL,
  cohort_key                text NOT NULL,
  cohort_label_snapshot     text,
  service_filter_snapshot   jsonb,
  patient_count             integer NOT NULL DEFAULT 0,
  summary_metrics           jsonb NOT NULL DEFAULT '{}'::jsonb,
  generation_status         text NOT NULL DEFAULT 'pending',
  generation_error_code     text,
  pdf_blob_id               integer REFERENCES document_blobs(id) ON DELETE SET NULL,
  share_token_hash          text,
  share_expires_at          timestamp,
  share_revoked_at          timestamp,
  share_regenerated_at      timestamp,
  -- Retention cutoff for the PHI snapshot (APPROVED: 90 days). SEPARATE from
  -- the 72h share-access expiry. Defaulted to created_at + 90 days at insert;
  -- the repository also sets it explicitly. At/after this instant the purge
  -- job removes member PHI + the PDF blob and stamps purged_at.
  snapshot_retention_until  timestamp NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '90 days'),
  -- Set when snapshot PHI + PDF blob have been purged. Null = within retention.
  purged_at                 timestamp,
  status                    text NOT NULL DEFAULT 'active',
  metadata                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_clp_clinic ON call_list_packages (clinic_id);
CREATE INDEX IF NOT EXISTS idx_clp_facility_date ON call_list_packages (facility_id, service_date);
CREATE INDEX IF NOT EXISTS idx_clp_team_member ON call_list_packages (team_member_id);
CREATE INDEX IF NOT EXISTS idx_clp_operation ON call_list_packages (distribution_operation_id);

-- One package per (operation, team member): idempotent Confirm can never create
-- a duplicate package for the same member on retry.
CREATE UNIQUE INDEX IF NOT EXISTS uq_clp_operation_member
  ON call_list_packages (distribution_operation_id, team_member_id);

-- Token hash unique when present (revocation/regeneration invalidate old hash).
CREATE UNIQUE INDEX IF NOT EXISTS uq_clp_share_token_hash
  ON call_list_packages (share_token_hash)
  WHERE share_token_hash IS NOT NULL;

-- Purge scan: due (retention passed), not-yet-purged packages.
CREATE INDEX IF NOT EXISTS idx_clp_retention
  ON call_list_packages (snapshot_retention_until, purged_at);

CREATE TABLE IF NOT EXISTS call_list_package_members (
  id                             serial PRIMARY KEY,
  package_id                     integer NOT NULL REFERENCES call_list_packages(id) ON DELETE CASCADE,
  -- References (NOT owners).
  execution_case_id              integer NOT NULL REFERENCES patient_execution_cases(id) ON DELETE SET NULL,
  patient_screening_id           integer REFERENCES patient_screenings(id) ON DELETE SET NULL,
  order_index                    integer NOT NULL DEFAULT 0,
  patient_name_snapshot          text NOT NULL,
  patient_dob_snapshot           text,
  patient_phone_snapshot         text,
  demographics_snapshot          jsonb,
  services_snapshot              text[],
  reason_for_call_snapshot       text,
  qualification_summary_snapshot jsonb,
  cohort_classification_snapshot text,
  atlas_payload_snapshot         jsonb,
  created_at                     timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_clpm_package ON call_list_package_members (package_id);
CREATE INDEX IF NOT EXISTS idx_clpm_execution_case ON call_list_package_members (execution_case_id);
CREATE INDEX IF NOT EXISTS idx_clpm_screening ON call_list_package_members (patient_screening_id);

-- No duplicate patient/objective within a package (idempotent member create).
CREATE UNIQUE INDEX IF NOT EXISTS uq_clpm_package_execution_case
  ON call_list_package_members (package_id, execution_case_id);
