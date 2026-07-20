-- Phase 2A — Global Plexus patient identity.
-- ADDITIVE-ONLY. DO NOT RUN AUTOMATICALLY.
--
-- Adds:
--   • 6 new tables (global_plexus_patients, patient_clinic_memberships,
--     patient_external_identifiers, patient_identity_match_candidates,
--     patient_identity_merge_events, plexus_id_aliases)
--   • Their indexes + one partial-unique-index each on
--     patient_clinic_memberships (per-clinic MRN uniqueness where
--     provided; one active membership per (patient, clinic))
--   • 2 nullable transitional columns on patient_screenings
--     (patient_clinic_membership_id, global_plexus_patient_id) — both
--     added without NOT NULL and without default so the column addition
--     is a metadata-only change on Postgres 11+.
--
-- What it DOES NOT do:
--   • No ALTER on any existing column
--   • No UPDATE / DELETE / TRUNCATE anywhere
--   • No unique constraint on (name, dob) or any demographic combo
--   • No population of the new tables (backfill is a separate opt-in
--     step — see script/backfillPlexusIdentity.ts, dry-run default)
--   • Does not enable any feature flag
--
-- Rollback plan (safe while flags are OFF):
--   ALTER TABLE patient_screenings DROP COLUMN IF EXISTS global_plexus_patient_id;
--   ALTER TABLE patient_screenings DROP COLUMN IF EXISTS patient_clinic_membership_id;
--   DROP TABLE IF EXISTS plexus_id_aliases;
--   DROP TABLE IF EXISTS patient_identity_merge_events;
--   DROP TABLE IF EXISTS patient_identity_match_candidates;
--   DROP TABLE IF EXISTS patient_external_identifiers;
--   DROP TABLE IF EXISTS patient_clinic_memberships;
--   DROP TABLE IF EXISTS global_plexus_patients;
--
-- Tenant-scope review: every clinic-facing endpoint MUST join through
-- patient_clinic_memberships filtered by req.clinicId. Direct reads of
-- global_plexus_patients from a clinic-facing route are prohibited by
-- the requirePlexusIdentityAccess guard.
--
-- Twilio / SMS: NEVER. No column supports external messaging.

-- ─── global_plexus_patients ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS global_plexus_patients (
  id                              SERIAL PRIMARY KEY,
  plexus_id                       TEXT NOT NULL UNIQUE,
  display_name                    TEXT,
  normalized_name                 TEXT,
  dob                             TEXT,
  phone                           TEXT,
  email                           TEXT,
  address                         TEXT,
  identity_status                 TEXT NOT NULL DEFAULT 'active',
  merged_into_patient_id          INTEGER,
  has_plexus_ancillary_history    BOOLEAN NOT NULL DEFAULT FALSE,
  first_ancillary_completed_at    TIMESTAMP,
  most_recent_ancillary_completed_at TIMESTAMP,
  created_at                      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gpp_normalized_name  ON global_plexus_patients(normalized_name);
CREATE INDEX IF NOT EXISTS idx_gpp_dob              ON global_plexus_patients(dob);
CREATE INDEX IF NOT EXISTS idx_gpp_identity_status  ON global_plexus_patients(identity_status);
CREATE INDEX IF NOT EXISTS idx_gpp_merged_into      ON global_plexus_patients(merged_into_patient_id);

-- ─── patient_clinic_memberships ────────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_clinic_memberships (
  id                          SERIAL PRIMARY KEY,
  global_plexus_patient_id    INTEGER NOT NULL REFERENCES global_plexus_patients(id) ON DELETE CASCADE,
  clinic_id                   INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  clinic_mrn                  TEXT,
  source_system               TEXT,
  source_patient_identifier   TEXT,
  membership_status           TEXT NOT NULL DEFAULT 'active',
  first_seen_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at                  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pcm_global_patient  ON patient_clinic_memberships(global_plexus_patient_id);
CREATE INDEX IF NOT EXISTS idx_pcm_clinic          ON patient_clinic_memberships(clinic_id);
CREATE INDEX IF NOT EXISTS idx_pcm_status          ON patient_clinic_memberships(membership_status);

-- One active membership per (global_patient, clinic).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pcm_active_membership
  ON patient_clinic_memberships(global_plexus_patient_id, clinic_id)
  WHERE membership_status = 'active';

-- Per-clinic MRN uniqueness where an MRN is provided (partial index).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pcm_clinic_mrn
  ON patient_clinic_memberships(clinic_id, clinic_mrn)
  WHERE clinic_mrn IS NOT NULL;

-- ─── patient_external_identifiers ──────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_external_identifiers (
  id                              SERIAL PRIMARY KEY,
  global_plexus_patient_id        INTEGER NOT NULL REFERENCES global_plexus_patients(id) ON DELETE CASCADE,
  patient_clinic_membership_id    INTEGER REFERENCES patient_clinic_memberships(id) ON DELETE SET NULL,
  clinic_id                       INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
  source_system                   TEXT,
  identifier_type                 TEXT NOT NULL,
  -- Sensitive column: raw values must be encrypted at rest. Until an
  -- approved encryption mechanism is wired, the service layer refuses
  -- to write ANY value here for sensitive identifier types.
  identifier_value_encrypted      TEXT,
  -- Non-reversible equality-match value (normalized for non-sensitive,
  -- HMAC-hashed for sensitive). Never the raw plaintext for sensitive
  -- types.
  normalized_or_hashed_match_value TEXT,
  active                          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pei_global_patient  ON patient_external_identifiers(global_plexus_patient_id);
CREATE INDEX IF NOT EXISTS idx_pei_clinic_source   ON patient_external_identifiers(clinic_id, source_system);
CREATE INDEX IF NOT EXISTS idx_pei_type_match      ON patient_external_identifiers(identifier_type, normalized_or_hashed_match_value);
CREATE INDEX IF NOT EXISTS idx_pei_active          ON patient_external_identifiers(active);

-- ─── patient_identity_match_candidates ─────────────────────────────
-- Plexus-only review queue. Never returned from clinic-facing routes.
CREATE TABLE IF NOT EXISTS patient_identity_match_candidates (
  id                          SERIAL PRIMARY KEY,
  incoming_membership_id      INTEGER REFERENCES patient_clinic_memberships(id) ON DELETE CASCADE,
  staged_import_row_id        INTEGER,
  candidate_global_patient_id INTEGER NOT NULL REFERENCES global_plexus_patients(id) ON DELETE CASCADE,
  match_score                 NUMERIC(6,3),
  match_tier                  TEXT,
  matched_signals             JSONB NOT NULL DEFAULT '[]'::jsonb,
  conflicting_signals         JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_status               TEXT NOT NULL DEFAULT 'pending',
  reviewed_by_user_id         VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at                 TIMESTAMP,
  review_note                 TEXT,
  created_at                  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pimc_candidate  ON patient_identity_match_candidates(candidate_global_patient_id);
CREATE INDEX IF NOT EXISTS idx_pimc_status     ON patient_identity_match_candidates(review_status);
CREATE INDEX IF NOT EXISTS idx_pimc_incoming   ON patient_identity_match_candidates(incoming_membership_id);

-- ─── patient_identity_merge_events ─────────────────────────────────
-- Append-only. Rows are immutable at the application layer.
CREATE TABLE IF NOT EXISTS patient_identity_merge_events (
  id                          SERIAL PRIMARY KEY,
  surviving_global_patient_id INTEGER NOT NULL REFERENCES global_plexus_patients(id) ON DELETE CASCADE,
  merged_global_patient_id    INTEGER NOT NULL REFERENCES global_plexus_patients(id) ON DELETE CASCADE,
  surviving_plexus_id         TEXT NOT NULL,
  merged_plexus_id            TEXT NOT NULL,
  reviewed_by_user_id         VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason                      TEXT,
  evidence_snapshot           JSONB NOT NULL DEFAULT '{}'::jsonb,
  merged_at                   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pime_surviving  ON patient_identity_merge_events(surviving_global_patient_id);
CREATE INDEX IF NOT EXISTS idx_pime_merged     ON patient_identity_merge_events(merged_global_patient_id);
CREATE INDEX IF NOT EXISTS idx_pime_merged_at  ON patient_identity_merge_events(merged_at);

-- ─── plexus_id_aliases ─────────────────────────────────────────────
-- Preserves retired Plexus IDs after merge. Never reused.
CREATE TABLE IF NOT EXISTS plexus_id_aliases (
  alias_plexus_id             TEXT PRIMARY KEY,
  surviving_global_patient_id INTEGER NOT NULL REFERENCES global_plexus_patients(id) ON DELETE CASCADE,
  reason                      TEXT,
  created_at                  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pia_surviving  ON plexus_id_aliases(surviving_global_patient_id);

-- ─── transitional linkage on patient_screenings ────────────────────
-- Added as NULLABLE with no default so the ALTER is metadata-only and
-- does not rewrite the table. The Drizzle schema declaration in
-- shared/schema/screening.ts is intentionally NOT updated in Phase 2A
-- so no existing repository/type inference is affected. The columns
-- are populated by the backfill script + Phase 2B write-path integration.
ALTER TABLE patient_screenings ADD COLUMN IF NOT EXISTS patient_clinic_membership_id INTEGER;
ALTER TABLE patient_screenings ADD COLUMN IF NOT EXISTS global_plexus_patient_id     INTEGER;

CREATE INDEX IF NOT EXISTS idx_ps_pcm  ON patient_screenings(patient_clinic_membership_id);
CREATE INDEX IF NOT EXISTS idx_ps_gpp  ON patient_screenings(global_plexus_patient_id);
