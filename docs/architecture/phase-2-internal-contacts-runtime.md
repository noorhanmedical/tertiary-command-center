# Phase 2 — Internal contacts runtime (PR 2.7)

## Canonical source

New table `contacts` (migration `0031_add_contacts.sql`, schema
mirror `shared/schema/contacts.ts`).

Categories:

- `facility` — clinic / facility staff
- `physician` — ordering / interpreting physician
- `vendor_report` — ancillary report vendor
- `escalation` — manager / supervisor / on-call
- `team_member` — internal user (cross-references `users.id`)

Required fields: `category`, `name`, `phone`.
Optional: `role`, `organization`, `facilityId`, `email`, `notes`,
`userId`, `isOnCall`, `metadata`.

## Routes

- `GET /api/contacts` — list (filterable by category, facilityId,
  includeArchived). Authenticated session only.
- `POST /api/contacts` — admin-only create.
- `PATCH /api/contacts/:id` — admin-only update.
- `PATCH /api/contacts/:id/archive` — admin-only soft delete.

## Surface

`InternalContactsTool` left-rail tool reads from
`/api/contacts`. No hardcoded fallback list. When the directory is
empty the tool says so honestly ("No contacts have been added yet").

The tool is admin-readable (anyone authenticated) and admin-writable
(POST/PATCH gated). A future PR can add a dedicated admin Contacts
page for write operations; PR 2.7 ships the read-only tool only.

## Anti-patterns guarded by QA

- No hardcoded contact arrays in client components.
- No fake "no contact found" UI that disguises missing data —
  the empty state explicitly says the directory is empty.
- No `/api/contacts` write from non-admin sessions.
