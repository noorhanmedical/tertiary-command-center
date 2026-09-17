// Isolated test-database harness for Plexus OS - Ancillaries.
//
// Purpose: give the unit/integration suite a DISPOSABLE, DETERMINISTIC
// PostgreSQL database that is completely separate from the developer's working
// database. It never contains PHI (only synthetic fixtures), applies the
// current canonical schema, seeds the clinic IDs the tests assume, and can be
// dropped/reset between runs.
//
// Commands (wired in package.json):
//   npm run test:db:setup   → create the test DB, apply schema, seed fixtures
//   npm run test:db:reset   → drop + recreate clean
//   npm run test:unit:isolated → run the full unit suite against the test DB
//                                with a CLEAN, deterministic env (all Phase 4
//                                feature flags OFF, no dev .env pollution).
//
// Design notes:
//   - The test DB name comes from TEST_DATABASE_URL, defaulting to
//     postgres://localhost:5432/plexus_test. It is NEVER the dev/staging DB;
//     the harness refuses to operate on a DB whose name doesn't end in _test.
//   - Schema is applied with `drizzle-kit push` against the empty test DB
//     (deterministic from shared/schema.ts — the canonical schema source).
//   - Fixtures: deterministic clinics with the IDs referenced by tests
//     (7, 8, 10, 42) plus a default clinic. Synthetic only, no PHI.

import { execSync } from "node:child_process";
import { Client } from "pg";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/plexus_test";

function parseDbName(url: string): string {
  const m = url.match(/\/([^/?]+)(\?|$)/);
  if (!m) throw new Error(`Cannot parse database name from TEST_DATABASE_URL`);
  return m[1];
}

const DB_NAME = parseDbName(TEST_DB_URL);

// HARD SAFETY: never touch a non-_test database. Prevents accidentally
// dropping the developer or staging DB.
if (!/_test$/.test(DB_NAME)) {
  console.error(
    `Refusing to operate: test DB name "${DB_NAME}" does not end in "_test". ` +
      `Set TEST_DATABASE_URL to a dedicated *_test database.`,
  );
  process.exit(1);
}

// Admin connection URL (connect to the maintenance "postgres" db to
// create/drop the target).
function adminUrl(): string {
  return TEST_DB_URL.replace(/\/[^/?]+(\?|$)/, "/postgres$1");
}

async function withAdmin<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: adminUrl() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function dropDb(): Promise<void> {
  await withAdmin(async (c) => {
    await c.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [DB_NAME],
    );
    await c.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  });
  console.log(`[test-db] dropped ${DB_NAME}`);
}

async function createDb(): Promise<void> {
  await withAdmin(async (c) => {
    const exists = await c.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [DB_NAME],
    );
    if (exists.rowCount === 0) {
      await c.query(`CREATE DATABASE ${DB_NAME}`);
      console.log(`[test-db] created ${DB_NAME}`);
    } else {
      console.log(`[test-db] ${DB_NAME} already exists`);
    }
  });
}

function applySchema(): void {
  // drizzle-kit push against the empty test DB — deterministic from the
  // canonical schema (shared/schema.ts). Non-interactive; no --force needed
  // on an empty DB (no data-loss statements are generated).
  console.log(`[test-db] applying schema via drizzle-kit push...`);
  execSync(`npx drizzle-kit push`, {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, HOME: "/tmp" },
  });
}

async function seedFixtures(): Promise<void> {
  const c = new Client({ connectionString: TEST_DB_URL });
  await c.connect();
  try {
    // Deterministic synthetic clinics with the exact IDs the tests reference.
    // Explicit ids (serial PK) so fixtures are stable across runs. No PHI.
    const clinics: Array<[number, string, string]> = [
      // 1 & 2 are used by the live-QA tenant-isolation / scheduling tests.
      [1, "Test Clinic 1", "test-clinic-1"],
      [2, "Test Clinic 2", "test-clinic-2"],
      [7, "Test Clinic 7", "test-clinic-7"],
      [8, "Test Clinic 8", "test-clinic-8"],
      [10, "Test Clinic 10", "test-clinic-10"],
      [42, "Test Clinic 42", "test-clinic-42"],
    ];
    for (const [id, name, slug] of clinics) {
      await c.query(
        `INSERT INTO clinics (id, name, slug, active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (id) DO NOTHING`,
        [id, name, slug],
      );
    }
    // Keep the serial sequence ahead of the highest explicit id so future
    // auto-inserts don't collide with seeded ids.
    await c.query(
      `SELECT setval(pg_get_serial_sequence('clinics','id'), (SELECT MAX(id) FROM clinics))`,
    );

    // Baseline screening_batches row id=1 — several live-QA tests insert
    // patient_screenings with a hardcoded batchId:1 and rely on it existing.
    await c.query(
      `INSERT INTO screening_batches (id, clinic_id, name, status, is_test)
       VALUES (1, 1, 'Test Baseline Batch', 'processing', true)
       ON CONFLICT (id) DO NOTHING`,
    );
    await c.query(
      `SELECT setval(pg_get_serial_sequence('screening_batches','id'), (SELECT MAX(id) FROM screening_batches))`,
    );

    console.log(
      `[test-db] seeded ${clinics.length} synthetic clinic fixtures + baseline batch #1`,
    );
  } finally {
    await c.end();
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "setup":
      await createDb();
      applySchema();
      await seedFixtures();
      console.log(`[test-db] setup complete: ${DB_NAME}`);
      break;
    case "reset":
      await dropDb();
      await createDb();
      applySchema();
      await seedFixtures();
      console.log(`[test-db] reset complete: ${DB_NAME}`);
      break;
    case "drop":
      await dropDb();
      break;
    default:
      console.error(`Usage: tsx script/testDbHarness.ts <setup|reset|drop>`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[test-db] harness error:`, err?.message ?? err);
  process.exit(1);
});
