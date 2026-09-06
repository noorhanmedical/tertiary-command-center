-- Plexus OS Access Control (Phase 1) — additive access-control foundation.
--
-- ONE identity system (users) with a layered authorization model on top:
--   Organization → Clinics → Users / Teams / Services / Workflows
--
-- STRICTLY ADDITIVE + IDEMPOTENT:
--   • CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
--   • ADD COLUMN IF NOT EXISTS on users + clinics
--   • NO DROPs, NO RENAMEs, NO destructive changes
--   • users.role and users.clinic_id are PRESERVED as legacy mirrors
--   • Partial unique indexes never break existing rows (they only apply to
--     new active access rows this migration does not itself insert)
--
-- Backfill of existing users/clinics into the new model is performed by a
-- SEPARATE, reviewable, idempotent script (script/backfillAccessControl.ts),
-- NOT inside this migration, so the schema change and data change can be
-- applied and audited independently.

-- ═══════════════════════════════════════════════════════════════════════════
-- organizations — tenant grouping above clinics (single clinic / group / MSO / IPA)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS organizations (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  org_type   TEXT NOT NULL DEFAULT 'group',
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);

-- clinics gains a nullable owning organization. FK is ON DELETE SET NULL so
-- deleting an org never cascades into clinic/tenant data loss. Backfilled to
-- the Default Organization by the backfill script.
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS organization_id INTEGER;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_clinics_organization'
  ) THEN
    ALTER TABLE clinics
      ADD CONSTRAINT fk_clinics_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_clinics_organization ON clinics(organization_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- roles — permission templates (system + future custom/org-scoped)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS roles (
  id                SERIAL PRIMARY KEY,
  key               TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  description       TEXT,
  scope_type        TEXT NOT NULL DEFAULT 'clinic',
  default_workspace TEXT NOT NULL DEFAULT 'plexus_home',
  is_system         BOOLEAN NOT NULL DEFAULT FALSE,
  is_assignable     BOOLEAN NOT NULL DEFAULT TRUE,
  organization_id   INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Global roles unique by key; org-scoped custom roles unique per (org,key).
CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_key_global
  ON roles(key) WHERE organization_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_key_org
  ON roles(organization_id, key) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_roles_scope ON roles(scope_type);

-- ═══════════════════════════════════════════════════════════════════════════
-- permissions — capability catalog
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS permissions (
  id          SERIAL PRIMARY KEY,
  key         TEXT NOT NULL,
  category    TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_permissions_key ON permissions(key);
CREATE INDEX IF NOT EXISTS idx_permissions_category ON permissions(category);

-- ═══════════════════════════════════════════════════════════════════════════
-- role_permissions — template → capabilities
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS role_permissions (
  id            SERIAL PRIMARY KEY,
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_role_permissions ON role_permissions(role_id, permission_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- user_roles — multi-role assignment (one active primary per user)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_roles (
  id         SERIAL PRIMARY KEY,
  user_id    VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_roles_active
  ON user_roles(user_id, role_id) WHERE active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_roles_primary
  ON user_roles(user_id) WHERE active AND is_primary;

-- ═══════════════════════════════════════════════════════════════════════════
-- user_permission_overrides — per-user grant/deny (deny wins), optional scope
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id              SERIAL PRIMARY KEY,
  user_id         VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id   INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  effect          TEXT NOT NULL,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  clinic_id       INTEGER REFERENCES clinics(id) ON DELETE CASCADE,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_perm_overrides_user ON user_permission_overrides(user_id);
CREATE INDEX IF NOT EXISTS idx_user_perm_overrides_permission ON user_permission_overrides(permission_id);
CREATE INDEX IF NOT EXISTS idx_user_perm_overrides_active ON user_permission_overrides(active);

-- ═══════════════════════════════════════════════════════════════════════════
-- user_organizations — org membership (one active primary per user)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_organizations (
  id              SERIAL PRIMARY KEY,
  user_id         VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_orgs_user ON user_organizations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_orgs_org ON user_organizations(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_orgs_active
  ON user_organizations(user_id, organization_id) WHERE active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_orgs_primary
  ON user_organizations(user_id) WHERE active AND is_primary;

-- ═══════════════════════════════════════════════════════════════════════════
-- user_clinics — multi-clinic assignment (complements legacy users.clinic_id)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_clinics (
  id         SERIAL PRIMARY KEY,
  user_id    VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clinic_id  INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_clinics_user ON user_clinics(user_id);
CREATE INDEX IF NOT EXISTS idx_user_clinics_clinic ON user_clinics(clinic_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_clinics_active
  ON user_clinics(user_id, clinic_id) WHERE active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_clinics_primary
  ON user_clinics(user_id) WHERE active AND is_primary;

-- ═══════════════════════════════════════════════════════════════════════════
-- service access — references ancillary_service_registry.internal_code (string,
-- not FK, mirroring facility_service_settings for flexibility)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS role_service_access (
  id           SERIAL PRIMARY KEY,
  role_id      INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  service_code TEXT NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_role_service_access ON role_service_access(role_id, service_code);
CREATE INDEX IF NOT EXISTS idx_role_service_access_role ON role_service_access(role_id);

CREATE TABLE IF NOT EXISTS user_service_access (
  id           SERIAL PRIMARY KEY,
  user_id      VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_code TEXT NOT NULL,
  effect       TEXT NOT NULL DEFAULT 'grant',
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_service_access_user ON user_service_access(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_service_access_active
  ON user_service_access(user_id, service_code) WHERE active;

-- ═══════════════════════════════════════════════════════════════════════════
-- users — additive access-control identity columns (all NULLABLE except the
-- status/mfa/timestamp defaults, which are safe for existing rows)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE users ADD COLUMN IF NOT EXISTS email             TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status            TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_workspace TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_required      BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at     TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by        VARCHAR;
ALTER TABLE users ADD COLUMN IF NOT EXISTS modified_by       VARCHAR;

-- Case-insensitive uniqueness for email WHERE present. Partial unique index on
-- lower(email) so existing NULL-email rows are unaffected and duplicates are
-- prevented only among real emails. If existing data already contains
-- duplicate emails this index creation will fail loudly — that is intentional
-- (surface the conflict rather than silently corrupting login).
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_ci
  ON users(lower(email)) WHERE email IS NOT NULL;
