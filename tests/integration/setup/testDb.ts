/**
 * Test-DB harness (ADR-006 / C.6). Safely connects integration tests to a
 * DEDICATED test PostgreSQL database and refuses to touch anything else.
 *
 * Critical mechanics:
 *  - `server/db.ts` builds its Pool from process.env.DATABASE_URL AT IMPORT TIME.
 *    So we must set DATABASE_URL to the test URL and only THEN dynamically import
 *    the db/schema/repository modules. Callers use `loadTestModules()`.
 *
 * Safety (PHI-in-dev history, GAP-050): this harness will NOT run against a
 * database unless it is explicitly a test database:
 *  - requires TEST_DATABASE_URL (never falls back to DATABASE_URL)
 *  - refuses if TEST_DATABASE_URL === DATABASE_URL
 *  - refuses unless the database name contains "test"
 * If TEST_DATABASE_URL is absent, tests SKIP cleanly (exit 0) rather than fail.
 */

export type SkipResult = { ok: false; skipped: true; reason: string };
export type ReadyResult = { ok: true; testDatabaseUrl: string };
export type HarnessResult = SkipResult | ReadyResult;

/** Print a SKIPPED line and signal the test to exit 0 without asserting. */
export function skip(testName: string, reason: string): void {
  console.log(`${testName}: SKIPPED — ${reason}`);
}

/**
 * Validate the environment and, if a proper test DB is configured, point
 * DATABASE_URL at it so subsequently-imported db modules connect there.
 * Returns a skip result (with reason) when no valid test DB is available.
 */
export function prepareTestDatabaseEnv(): HarnessResult {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    return { ok: false, skipped: true, reason: "set TEST_DATABASE_URL to run this integration test" };
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === testUrl) {
    // Refuse: never allow the test DB to be the same as the app DB.
    throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL (refusing to run against the app database)");
  }
  if (!/test/i.test(databaseNameOf(testUrl))) {
    // Refuse: the target database name must clearly be a test database.
    throw new Error(`Refusing to run: TEST_DATABASE_URL database name must contain "test" (got "${databaseNameOf(testUrl)}")`);
  }

  // Point the singleton pool at the test DB for all subsequent dynamic imports.
  process.env.DATABASE_URL = testUrl;
  return { ok: true, testDatabaseUrl: testUrl };
}

function databaseNameOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\//, "") || "";
  } catch {
    return "";
  }
}

/**
 * Dynamically import the app modules AFTER DATABASE_URL has been pointed at the
 * test DB. Never import these statically in an integration test — that would bind
 * the pool to the wrong (or missing) DATABASE_URL at module-load time.
 */
export async function loadTestModules() {
  const [dbModule, schema, repo, tenant] = await Promise.all([
    import("../../../server/db"),
    import("@shared/schema"),
    import("../../../server/repositories/screening.repo"),
    import("../../../server/middleware/tenantContext"),
  ]);
  return { db: dbModule.db, pool: dbModule.pool, schema, repo, tenant };
}

/**
 * Confirm the tables the screening isolation test needs exist. Returns a skip
 * reason if the schema hasn't been applied (never creates tables itself).
 */
export async function ensureSchemaOrSkip(pool: {
  query: (text: string) => Promise<{ rows: Array<{ exists: boolean }> }>;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const needed = ["clinics", "screening_batches", "patient_screenings"];
  for (const table of needed) {
    const res = await pool.query(
      `SELECT to_regclass('public.${table}') IS NOT NULL AS exists`,
    );
    if (!res.rows[0]?.exists) {
      return {
        ok: false,
        reason: `test DB missing table "${table}" — run: DATABASE_URL=$TEST_DATABASE_URL npm run db:push`,
      };
    }
  }
  return { ok: true };
}
