// Phase 2K — K16 structured client error contract.
//   npx tsx tests/unit/phase2KClientError.test.ts
process.env.DATABASE_URL ??= "postgres://placeholder@localhost:5432/placeholder";

import assert from "node:assert/strict";

const qc = () => import("../../client/src/lib/queryClient");
const hook = () => import("../../client/src/components/physician/useCanonicalOverview");

async function testK16StructuredError() {
  const { ApiError } = await qc();
  const { isMigrationMissingError } = await hook();
  const MIG = "ANCILLARY_DOCUMENT_MIGRATION_MISSING";
  // The message is preserved EXACTLY so every existing `err.message` toast is unchanged.
  const mig = new ApiError(503, "Canonical migration not applied", MIG);
  assert.equal(mig.status, 503);
  assert.equal(mig.code, MIG);
  assert.equal(mig.message, "503: Canonical migration not applied", "K16: message preserved for existing toasts");
  // Distinguishable via STRUCTURED fields (not message parsing).
  assert.equal(isMigrationMissingError(mig), true, "K16: 503 → migration missing");
  assert.equal(isMigrationMissingError(new ApiError(500, "boom", MIG)), true, "K16: migration code (non-503) → migration missing");
  assert.equal(isMigrationMissingError(new ApiError(403, "Forbidden", null)), false, "K16: 403 forbidden → NOT migration");
  assert.equal(isMigrationMissingError(new ApiError(500, "Internal Server Error", null)), false, "K16: generic 500 → NOT migration");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["K16 structured client error contract", testK16StructuredError],
];
async function run() {
  let failed = 0;
  for (const [name, fn] of tests) { try { await fn(); console.log(`ok  ${name}`); } catch (e) { failed++; console.error(`FAIL  ${name}\n     ${(e as Error).stack ?? (e as Error).message}`); } }
  if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log(`\nAll ${tests.length} tests passed`);
}
run();
