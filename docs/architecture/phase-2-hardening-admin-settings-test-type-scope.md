# Phase 2 hardening — Admin settings testType scope (item 5)

## Schema

Migration `0033_phase2_admin_settings_test_type_scope.sql`:

- Adds `test_type text` (nullable) to `admin_settings`.
- Drops the old unique index
  `idx_admin_settings_domain_key_facility_user`.
- Creates the new unique index
  `idx_admin_settings_domain_key_facility_user_test` on
  (`setting_domain`, `setting_key`, `facility_id`, `user_id`,
  `test_type`).

The schema type mirror in `shared/schema/adminSettings.ts` is
updated to match. A `test_type` index is also added for fast
filtering.

## Precedence (most-specific wins)

`getAdminSettingValue(domain, key, { facilityId, userId, testType })`:

1. (facility, user, testType)
2. (facility, null, testType)
3. (null, user, testType)
4. (null, null, testType)
5. (facility, user, null)
6. (facility, null, null)
7. (null, user, null)
8. (null, null, null) — global default

When `testType` is null the resolver skips steps 1-4 and behaves
exactly as the PR 2.1 version (no behavior change for existing
callers).

## Bundle service

`getEffectiveAdminSettings({ facilityId, userId, testType })`:

- Adds a fifth `source` label: `"test_type"` (in addition to the
  PR 2.1 set: `facility`, `user`, `global`, `default`).
- A test-scoped row at any facility / user level outranks the
  non-test rows in its scope.

## Route + client + page

- `GET /api/admin-settings/effective?testType=<…>` accepts the new
  parameter.
- `POST /api/admin-settings { testType: <…> }` accepts the new
  scope field on create.
- `GET /api/admin-settings?testType=<…>` filters the list view.
- `client/src/lib/adminSettingsApi.ts` mirrors the typed bundle
  and the new `AdminSettingRow.testType` field.
- The Admin Settings Center row label now reads e.g.
  `facility: SHV · test: brainwave` when both scopes are set.

## Safety

- The migration is idempotent (uses `IF NOT EXISTS` /
  `IF EXISTS`).
- The legacy unique constraint is dropped only after the
  test-aware replacement is created.
- All existing rows have `test_type IS NULL` and continue to
  resolve identically to the PR 2.1 behavior.
- No seed rows are modified — admins opt into test-scoped
  overrides explicitly.
