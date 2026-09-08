// Phase 6 — REAL-DB checks for server-side BOOKING REVALIDATION (the race-gap
// fix). revalidateSlot reuses the SAME canonical availability engine; a slot
// that is full/outage at write time is rejected, while a feasible slot passes.
// Non-capacity ("other") services are never capacity-blocked.
//
// Honest skip when DATABASE_URL is unset/unreachable or no clinic exists.
// Cleans up the temporary override in `finally`.
//
// Run: DATABASE_URL=... npx tsx tests/acceptance/phase6SchedulingRevalidationDb.test.ts

import assert from "node:assert/strict";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("SKIP phase6SchedulingRevalidationDb: DATABASE_URL not set.");
    return;
  }
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../../server/db");
  try {
    await db.execute(sql`select 1`);
  } catch (e) {
    console.log(`SKIP phase6SchedulingRevalidationDb: cannot reach database — ${(e as Error).message}`);
    return;
  }
  const { clinics } = await import("../../shared/schema/clinics");
  const [clinic] = await db.select({ id: clinics.id }).from(clinics).limit(1);
  if (!clinic) {
    console.log("SKIP phase6SchedulingRevalidationDb: no clinic rows.");
    return;
  }
  const clinicId = clinic.id;

  const { revalidateSlot, __setRevalidationErrorForTest } = await import(
    "../../server/services/scheduling/availabilityService"
  );
  const { createOverride, deactivateOverride } = await import(
    "../../server/repositories/schedulingCapacity.repo"
  );

  const DATE = "2030-01-15"; // far future → no occupancy noise
  const at = new Date(`${DATE}T10:00:00`);
  let overrideId: number | null = null;
  let failures = 0;
  const check = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); console.log(`ok   ${name}`); }
    catch (e) { failures++; console.error(`FAIL ${name}: ${(e as Error).message}`); }
  };

  try {
    await check("§1 non-capacity 'other' service → status ok (known, not machine-bound)", async () => {
      const r = await revalidateSlot({ facilityName: null, clinicId, startsAt: at, serviceType: "Office Visit" });
      assert.equal(r.status, "ok");
    });

    await check("§2 capacity-backed service with default capacity + no occupancy → ok", async () => {
      const r = await revalidateSlot({ facilityName: null, clinicId, startsAt: at, serviceType: "BrainWave" });
      assert.equal(r.status, "ok", `expected ok, got ${JSON.stringify(r)}`);
    });

    await check("§3 OUTAGE (override capacity=0) → status conflict", async () => {
      const ov = await createOverride({
        clinicId,
        resourceType: "brainwave",
        startDate: DATE,
        endDate: DATE,
        availableCapacity: 0,
        reason: "phase6 revalidation test",
        active: true,
      } as never);
      overrideId = ov.id;
      const r = await revalidateSlot({ facilityName: null, clinicId, startsAt: at, serviceType: "BrainWave" });
      assert.equal(r.status, "conflict", "outage slot must be a known conflict");
      if (r.status === "conflict") assert.equal(r.constraint, "outage");
    });

    await check("§4 after the outage is cleared → ok again", async () => {
      if (overrideId != null) {
        await deactivateOverride(overrideId);
        overrideId = null;
      }
      const r = await revalidateSlot({ facilityName: null, clinicId, startsAt: at, serviceType: "BrainWave" });
      assert.equal(r.status, "ok");
    });

    await check("§5 FAIL CLOSED: a feasibility read error → status cannot_verify (never 'ok')", async () => {
      __setRevalidationErrorForTest(() => {
        throw new Error("simulated capacity/occupancy read failure");
      });
      try {
        const r = await revalidateSlot({ facilityName: null, clinicId, startsAt: at, serviceType: "BrainWave" });
        assert.equal(r.status, "cannot_verify", "engine/read error must NOT be treated as available");
      } finally {
        __setRevalidationErrorForTest(null);
      }
    });

    await check("§6 after the error clears → ok again (retry recovers)", async () => {
      const r = await revalidateSlot({ facilityName: null, clinicId, startsAt: at, serviceType: "BrainWave" });
      assert.equal(r.status, "ok");
    });
  } finally {
    if (overrideId != null) await deactivateOverride(overrideId).catch(() => {});
    __setRevalidationErrorForTest(null);
  }

  if (failures > 0) {
    console.error(`phase6SchedulingRevalidationDb.test.ts: ${failures} FAILURE(S)`);
    process.exit(1);
  }
  console.log("phase6SchedulingRevalidationDb.test.ts: all tests passed");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
