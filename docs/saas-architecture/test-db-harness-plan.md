# Test-DB Harness Plan — Proving Cross-Tenant Isolation

**Generated:** 2026-08-25
**Parent:** [ADR-006](./adr/ADR-006-tenant-scope-enforcement-pattern.md) · [Phase 1 Execution Plan](./phase-1-execution-plan.md) (C.6)

## Why this exists

ADR-002/006 make tenant isolation fail-closed in the repository layer. The guard
logic and detached-scope behavior are proven by pure unit tests
(`tests/unit/tenantContext.test.ts`). What is **not** yet proven is the property
that actually matters: **against a real PostgreSQL database, a user scoped to
Clinic A cannot SELECT or UPDATE Clinic B's row.** That requires executing real
SQL, which needs a database. The existing repo tests are all in-memory fixtures;
there is no test-DB infrastructure. This plan scopes it.

## Hard constraints from the codebase

1. **`db` is a module-level singleton** (`server/db.ts`) created from
   `process.env.DATABASE_URL` **at import time**. Repositories
   (`import { db } from "../db"`) bind to it directly — there is no injection
   point. **Consequence:** a test must set the connection string **before** the
   first import of `db`/repo/schema, using dynamic `import()`.
2. **No docker-compose / `.env.local.example` exists** despite the dev docs
   referencing them. A test DB must be supplied explicitly (CI service container
   or local Postgres); see "Providing a test DB".
3. **PHI-in-dev history (GAP-050).** The harness must be structurally incapable
   of pointing at, seeding, or deleting from a real/dev/prod database.

## Design

### Isolation of the connection
- The harness reads a **dedicated `TEST_DATABASE_URL`** — never `DATABASE_URL`.
- **Safety guards (refuse to run, not silently skip) if violated:**
  - `TEST_DATABASE_URL` must be set → otherwise **SKIP cleanly** (exit 0, print
    `SKIPPED: set TEST_DATABASE_URL to run`). This keeps `test:unit` DB-free and
    CI green where no DB exists.
  - `TEST_DATABASE_URL !== DATABASE_URL` → refuse if equal.
  - The database name must contain `test` → refuse otherwise. Cheap insurance
    against wiping a real DB.
- Only after guards pass: `process.env.DATABASE_URL = process.env.TEST_DATABASE_URL`,
  then `await import(...)` the schema/db/repo.

### Schema prerequisite
- The test DB must already have the schema applied:
  `DATABASE_URL=$TEST_DATABASE_URL npm run db:push` (or `db:migrate` once ADR-003
  migrations exist). The harness verifies the needed tables exist and **skips
  with instructions** if not — it never invents tables (that would be a false
  test against a fake schema).

### Seeding (synthetic only)
- Insert two clinics (A, B), one batch each, one patient screening each. Names
  are obviously synthetic (`Test Clinic A`, `ZZTEST_Patient_A`). No real PHI ever.
- Seed via direct `db.insert(...)` (insert paths are not scope-guarded).

### The assertions (the point of the harness)
Under **Clinic A** scope (`runWithScope({kind:"clinic", clinicId: A}, ...)`):
- `getScreening(patientB.id)` → `undefined` (cannot read B by id)
- `getScreening(patientA.id)` → defined (can read own)
- `updateScreening(patientB.id, {...})` → affects 0 rows; B's row unchanged
- `getBatch(batchB.id)` → `undefined`
- `deleteScreening(patientB.id)` → B's row not soft-deleted

Under **platform** scope (admin): `getScreening(patientB.id)` → defined (sees all).
Under **denied** scope: `getScreening(patientA.id)` → throws `TENANT_SCOPE_DENIED`.

### Teardown
- Delete only the specific seeded rows by their known ids; close the pool.
- Never `TRUNCATE`; never touch rows the harness didn't create.

## Providing a test DB

Any one of:
- **CI:** a Postgres service container; set `TEST_DATABASE_URL` to it.
- **Local (recommended to add):** a `docker-compose.yml` with a `postgres:15`
  service on a nonstandard port and a `plexus_test` database; document
  `docker compose up -d` then `db:push`. (Adding this compose file also fixes the
  stale dev-setup docs.)

## What runs where
- `test:unit` — unchanged; DB-free; stays green everywhere.
- `test:integration` (new script) — runs `tests/integration/*.test.ts`; each such
  test SKIPS cleanly without `TEST_DATABASE_URL`, runs for real with it. Wire into
  the pipeline (Plan H.1) as a gate in environments that provide a test DB.

## Honest status of what this proves
- With a test DB present: proves real SQL-level cross-tenant denial for the
  **screening** repository — the reference domain.
- Each additional domain (billing, documents, patient history, …) needs the same
  assertions added as it is migrated (C.2).
- This harness does not test HTTP/route-level authorization (that is a separate
  integration concern); it tests the repository isolation boundary, which is
  where ADR-006 enforces.

## Related
- [ADR-006](./adr/ADR-006-tenant-scope-enforcement-pattern.md)
- [Phase 1 Execution Plan](./phase-1-execution-plan.md) — C.6
- Harness: `tests/integration/setup/testDb.ts`
- Reference test: `tests/integration/tenantIsolation.screening.test.ts`
