# Phase 2 — Admin Settings runtime (PR 2.1)

Purpose: turn admin settings from a key/value store into a typed
**effective settings bundle** that runtime code reads at every
call-result, scheduling, or assignment decision.

## Precedence

The repository already implements per-row scope precedence in
`getAdminSettingValue(domain, key, scope)`. The bundle service
(`server/services/adminSettings/adminSettingsEffectiveService.ts`)
layers on top of it with this exact order:

1. **facility + user** override (`scope.facilityId` AND `scope.userId`)
2. **facility** override
3. **user** override
4. **global** (`NULL, NULL`)
5. **compile-time default** (last resort, in the bundle service)

For every resolved key, the bundle attaches a `sources` ledger entry
of `"facility" | "user" | "global" | "default"` so the Admin Settings
Center can label why a value won.

## Unsupported precedence (honesty)

The `admin_settings` schema has `facilityId` + `userId` columns but
NO `testType` column. So the brief's "facility + test override" and
"user + facility + test override" rows are NOT supported. They are
flagged honestly in this doc; a future PR can add the column without
changing this service's return shape.

## Routes

- `GET /api/admin-settings` (existing) — list raw rows.
- `GET /api/admin-settings/:id` (existing) — get raw row.
- `POST /api/admin-settings` (new) — admin-only create.
- `PATCH /api/admin-settings/:id` (new) — admin-only update
  (including `active: false` for deactivation).
- `GET /api/admin-settings/effective` (new) — typed bundle for a
  given (facilityId, userId) scope. Public read (the page sits
  behind `AdminGuard` already).

## Settings seeded by PR 2.1

In addition to the rows PR C seeded:

| Key | Default | Used by |
|---|---|---|
| `engagement_center.max_call_attempts` | `{ count: 6 }` | call-result unable-to-reach transition |
| `engagement_center.dnc_is_terminal` | `{ terminal: true }` | call-result DNC handler |
| `engagement_center.declined_is_terminal` | `{ terminal: true }` | call-result declined handler |
| `engagement_center.ready_to_schedule_routes_to_triage` | `{ routes_to_triage: true }` | call-result ready_to_schedule handler |
| `engagement_center.scheduled_closes_assignment` | `{ closes_assignment: true }` | call-result scheduled handler |
| `engagement_center.queue_reentry_enabled` | `{ enabled: true }` | callback-style outcomes |
| `assignment.scheduler_auto_assign_enabled` | `{ enabled: true }` | scheduler auto-assign service |
| `assignment.pcs_assignment_respects_facility_scope` | `{ enabled: true }` | PCS assignment service |
| `assignment.acs_assignment_respects_facility_scope` | `{ enabled: true }` | ACS assignment service |

## Runtime consumers

After PR 2.1 lands:

- PR 2.2 — `applyCallResultRouting` will resolve effective settings
  before computing nextActionAt, ownership, terminal state, etc.
- PR 2.3 — follow-up queue filters will read effective settings to
  classify rows as "callbacks due now", "LVM follow-up", etc.
- PR 2.4 — scheduling runtime will read effective settings for PTO,
  same-day-add, and source-of-truth checks.

## Admin Settings Center page

`/admin/settings-center` (admin-only). Shows:

- The effective bundle (resolved values + per-key source badges).
- The raw `admin_settings` rows grouped by domain.
- An inline JSON editor on each row that POSTs a PATCH on save.
- A refresh button that invalidates both the bundle + the list.

The page never deletes a row — deactivation toggles the `active`
flag so the history is preserved.
