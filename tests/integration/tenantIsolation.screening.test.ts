/**
 * Cross-tenant isolation — screening repository (ADR-006 / Plan C.6).
 *
 * Proves against a REAL PostgreSQL database that a user scoped to Clinic A cannot
 * read or mutate Clinic B's screening rows through the repository, that platform
 * (admin) scope sees all, and that denied scope throws.
 *
 * SKIPS cleanly (exit 0) unless a dedicated TEST_DATABASE_URL is provided — see
 * docs/saas-architecture/test-db-harness-plan.md. Never runs against the app DB.
 *
 * Run: TEST_DATABASE_URL=postgres://…/plexus_test npx tsx tests/integration/tenantIsolation.screening.test.ts
 */

import assert from "node:assert/strict";
import {
  prepareTestDatabaseEnv,
  loadTestModules,
  ensureSchemaOrSkip,
  skip,
} from "./setup/testDb";

const TEST_NAME = "tenantIsolation.screening.test.ts";

// Obviously-synthetic identifiers. No real PHI, ever.
const UNIQUE = `ZZTEST_${Date.now()}`;

async function main(): Promise<void> {
  const prep = prepareTestDatabaseEnv();
  if (!prep.ok) {
    skip(TEST_NAME, prep.reason);
    return; // exit 0 — no DB configured
  }

  const { db, pool, schema, repo, tenant } = await loadTestModules();

  const schemaCheck = await ensureSchemaOrSkip(pool);
  if (!schemaCheck.ok) {
    skip(TEST_NAME, schemaCheck.reason);
    await pool.end();
    return;
  }

  const { clinics, screeningBatches, patientScreenings } = schema as unknown as {
    clinics: any;
    screeningBatches: any;
    patientScreenings: any;
  };
  const { screeningRepository } = repo as { screeningRepository: any };
  const { runWithScope, resolveScopedClinicId } = tenant as {
    runWithScope: <T>(scope: any, fn: () => T) => T;
    resolveScopedClinicId: () => number | null;
  };

  // Track seeded ids for precise teardown (never TRUNCATE).
  const seeded = { clinicIds: [] as number[], batchIds: [] as number[], patientIds: [] as number[] };

  try {
    // ── Seed two clinics, each with a batch and one patient screening ──
    const [clinicA] = await db.insert(clinics).values({ name: `${UNIQUE}_Clinic_A`, slug: `${UNIQUE.toLowerCase()}-a` }).returning();
    const [clinicB] = await db.insert(clinics).values({ name: `${UNIQUE}_Clinic_B`, slug: `${UNIQUE.toLowerCase()}-b` }).returning();
    seeded.clinicIds.push(clinicA.id, clinicB.id);

    const [batchA] = await db.insert(screeningBatches).values({ name: `${UNIQUE}_Batch_A`, clinicId: clinicA.id }).returning();
    const [batchB] = await db.insert(screeningBatches).values({ name: `${UNIQUE}_Batch_B`, clinicId: clinicB.id }).returning();
    seeded.batchIds.push(batchA.id, batchB.id);

    const [patientA] = await db.insert(patientScreenings).values({ name: `${UNIQUE}_Patient_A`, batchId: batchA.id, clinicId: clinicA.id }).returning();
    const [patientB] = await db.insert(patientScreenings).values({ name: `${UNIQUE}_Patient_B`, batchId: batchB.id, clinicId: clinicB.id }).returning();
    seeded.patientIds.push(patientA.id, patientB.id);

    const clinicAScope = { kind: "clinic", clinicId: clinicA.id };
    const platformScope = { kind: "platform" };
    const deniedScope = { kind: "denied", reason: "no_clinic_assigned" };

    // ── Under Clinic A scope: cannot see or mutate Clinic B ──
    await runWithScope(clinicAScope, async () => {
      assert.equal(resolveScopedClinicId(), clinicA.id);

      const ownRead = await screeningRepository.getScreening(patientA.id);
      assert.ok(ownRead, "Clinic A must read its own patient");

      const crossRead = await screeningRepository.getScreening(patientB.id);
      assert.equal(crossRead, undefined, "Clinic A MUST NOT read Clinic B's patient by id");

      const crossBatch = await screeningRepository.getBatch(batchB.id);
      assert.equal(crossBatch, undefined, "Clinic A MUST NOT read Clinic B's batch by id");

      const crossUpdate = await screeningRepository.updateScreening(patientB.id, { notes: "SHOULD_NOT_APPLY" });
      assert.equal(crossUpdate, undefined, "Clinic A cross-tenant update must affect no row");

      await screeningRepository.deleteScreening(patientB.id, { reason: "SHOULD_NOT_APPLY" });
    });

    // Verify Clinic B's patient is untouched (not updated, not soft-deleted).
    const bAfter = await runWithScope(platformScope, async () => screeningRepository.getScreening(patientB.id));
    assert.ok(bAfter, "Clinic B patient must still exist and be active after cross-tenant attempts");
    assert.notEqual(bAfter.notes, "SHOULD_NOT_APPLY", "Clinic B notes must be unchanged");

    // ── Under platform (admin) scope: sees all clinics ──
    await runWithScope(platformScope, async () => {
      const a = await screeningRepository.getScreening(patientA.id);
      const b = await screeningRepository.getScreening(patientB.id);
      assert.ok(a && b, "platform scope must read both clinics' patients");
    });

    // ── Under denied scope: throws, never runs unscoped ──
    await runWithScope(deniedScope, async () => {
      await assert.rejects(
        () => screeningRepository.getScreening(patientA.id),
        (err: unknown) => (err as { code?: string }).code === "TENANT_SCOPE_DENIED",
        "denied scope must throw, never return data",
      );
    });

    console.log(`${TEST_NAME}: all cross-tenant isolation assertions passed`);
  } finally {
    // Precise teardown — only the rows this test created; never TRUNCATE.
    await teardown(db, schema, seeded);
    await pool.end();
  }
}

// Delete seeded rows by id in FK-safe order using parameterized deletes.
async function teardown(
  db: any,
  schema: any,
  seeded: { clinicIds: number[]; batchIds: number[]; patientIds: number[] },
): Promise<void> {
  const { inArray } = await import("drizzle-orm");
  const { clinics, screeningBatches, patientScreenings } = schema;
  if (seeded.patientIds.length) await db.delete(patientScreenings).where(inArray(patientScreenings.id, seeded.patientIds));
  if (seeded.batchIds.length) await db.delete(screeningBatches).where(inArray(screeningBatches.id, seeded.batchIds));
  if (seeded.clinicIds.length) await db.delete(clinics).where(inArray(clinics.id, seeded.clinicIds));
}

main().catch((err) => {
  console.error(`${TEST_NAME}: FAILED`);
  console.error(err);
  process.exit(1);
});
