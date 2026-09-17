// Isolated unit-suite runner.
//
// Runs every tests/unit/*.test.ts against the disposable test database with a
// CLEAN, DETERMINISTIC environment — NOT the developer's .env. This guarantees:
//   - All Phase 4 feature flags default OFF (the suite's documented contract).
//     The dev .env enables FEATURE_PLEXUS_IDENTITY_WRITE, which is exactly what
//     made the 3 plexusIdentity tests fail when run under `source .env`.
//   - DATABASE_URL points at the *_test database, never dev/staging.
//
// Usage: npm run test:unit:isolated
// Prereq: npm run test:db:setup (or reset) has been run.

import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/plexus_test";

// Deterministic clean env: start from the current PATH/HOME etc. but strip ALL
// FEATURE_* flags and force the test DB. This removes dev .env pollution.
const cleanEnv: NodeJS.ProcessEnv = {};
for (const [k, v] of Object.entries(process.env)) {
  if (k.startsWith("FEATURE_")) continue; // drop every feature flag → defaults
  cleanEnv[k] = v;
}
cleanEnv.DATABASE_URL = TEST_DB_URL;
cleanEnv.NODE_ENV = "test";
cleanEnv.SESSION_SECRET = cleanEnv.SESSION_SECRET ?? "isolated-test-secret";
cleanEnv.HOME = cleanEnv.HOME ?? "/tmp";

const files = readdirSync("tests/unit")
  .filter((f) => f.endsWith(".test.ts"))
  .sort();

// Resource-safe: STRICTLY SERIAL. Each test file runs in its own short-lived
// tsx process that exits before the next starts, so DB connections/pools are
// released between files and local Postgres is never saturated. A tiny settle
// gives the OS/PG time to reclaim sockets after DB-heavy files.
function sleepMs(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* busy-wait: keeps the runner single-threaded and predictable */
  }
}

let failed = 0;
let passed = 0;
const failures: string[] = [];

for (const f of files) {
  const path = `tests/unit/${f}`;
  try {
    execSync(`npx tsx "${path}"`, {
      stdio: "inherit",
      env: cleanEnv,
      timeout: 120_000, // never let a single hung file block the whole run
    });
    passed++;
  } catch {
    failed++;
    failures.push(f);
  }
  sleepMs(150); // brief settle so PG reclaims connections between files
}

console.log(`\n[isolated] ${passed} passed, ${failed} failed of ${files.length} files`);

if (failed > 0) {
  console.error(`\n[isolated] ${failed} test file(s) FAILED:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\n[isolated] all ${files.length} unit test files passed`);
