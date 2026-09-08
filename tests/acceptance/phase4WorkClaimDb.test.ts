// Phase 4 — REAL-DB checks for the active-work CLAIM/LEASE, claim-aware
// eligibility + redistribution, cross-service contact protection, contact-
// fatigue policy, and the stale-claimant call-result guard (exercised through
// the REAL call-result HTTP handler). Honest skip when DATABASE_URL is
// unset/unreachable. Returns the DB to baseline in `finally`.
//
// Safety: gatherEligibleCases only touches UNASSIGNED cases and applyDistribution
// only reassigns them, so the real (all-assigned) roster is never shuffled. The
// redistribution scheduler is marked INACTIVE so released cases never bounce
// back to it (deterministic). Every fixture row is deleted at the end.
//
// Run: DATABASE_URL=... npx tsx tests/acceptance/phase4WorkClaimDb.test.ts

import assert from "node:assert/strict";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("SKIP phase4WorkClaimDb: DATABASE_URL not set.");
    return;
  }
  const { sql, eq, inArray } = await import("drizzle-orm");
  const { db } = await import("../../server/db");
  try {
    await db.execute(sql`select 1`);
  } catch (e) {
    console.log(`SKIP phase4WorkClaimDb: cannot reach database — ${(e as Error).message}`);
    return;
  }
  const reg = await db.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_name='patient_execution_cases' AND column_name='active_claim_by' LIMIT 1`);
  if (!((reg.rows?.length ?? 0) > 0)) {
    console.log("SKIP phase4WorkClaimDb: active_claim_by column missing (apply migration 0084).");
    return;
  }

  const { clinics } = await import("../../shared/schema/clinics");
  const { outreachSchedulers } = await import("../../shared/schema/outreach");
  const { engagementCallSettings } = await import("../../shared/schema/engagement");
  const { patientScreenings, screeningBatches } = await import("../../shared/schema/screening");
  const { patientExecutionCases, patientJourneyEvents } = await import("../../shared/schema/executionCase");
  const { outreachCalls } = await import("../../shared/schema/outreach");
  const { users } = await import("../../shared/schema/users");
  const { adminSettings } = await import("../../shared/schema/adminSettings");
  const wc = await import("../../server/services/engagement/workClaimService");
  const { gatherEligibleCases } = await import("../../server/services/engagement/distributionService");
  const { listSchedulerPortalCases } = await import("../../server/repositories/executionCase.repo");
  const { releaseAndRedistributeCanonical } = await import("../../server/services/engagement/absenceRedistribution");
  const { redistributeForEarlyDeparture } = await import("../../server/services/engagement/workforceAvailability");
  const { upsertAdminSetting } = await import("../../server/repositories/adminSettings.repo");
  const express = (await import("express")).default;
  const { createServer } = await import("node:http");
  const { registerExecutionCaseRoutes } = await import("../../server/routes/executionCases");

  const marker = `__P4WC_${Date.now()}`;
  const clinicIds: number[] = [];
  const userIds: string[] = [];
  const schedIds: number[] = [];
  const scrIds: number[] = [];
  const caseIds: number[] = [];
  let batchId: number | null = null;
  let httpServer: ReturnType<typeof createServer> | null = null;

  const insCase = async (opts: {
    owner: number | null;
    name?: string;
    dob?: string | null;
    status?: string;
    nextActionAt?: Date | null;
    claimBy?: number | null;
    claimExpiresAt?: Date | null;
  }) => {
    const clinicId = clinicIds[0];
    const [s] = await db.insert(patientScreenings).values({ batchId: batchId as number, name: opts.name ?? `${marker}_p`, isTest: true } as never).returning();
    scrIds.push(s.id);
    const [c] = await db.insert(patientExecutionCases).values({
      patientName: opts.name ?? `${marker}_p`,
      patientDob: opts.dob ?? "1990-01-01",
      patientScreeningId: s.id,
      clinicId,
      facilityId: `${marker}_fac`,
      engagementBucket: "outreach",
      engagementStatus: opts.status ?? "not_reached",
      lifecycleStatus: "active",
      assignedTeamMemberId: opts.owner,
      assignedRole: opts.owner != null ? "scheduler" : null,
      nextActionAt: opts.nextActionAt ?? null,
      activeClaimBy: opts.claimBy ?? null,
      activeClaimAt: opts.claimBy != null ? new Date() : null,
      activeClaimExpiresAt: opts.claimExpiresAt ?? null,
    } as never).returning();
    caseIds.push(c.id);
    return { ec: c, screening: s };
  };
  const ownerOf = async (id: number) => (await db.select({ o: patientExecutionCases.assignedTeamMemberId }).from(patientExecutionCases).where(eq(patientExecutionCases.id, id)).limit(1))[0]?.o ?? null;
  const claimByOf = async (id: number) => (await db.select({ c: patientExecutionCases.activeClaimBy }).from(patientExecutionCases).where(eq(patientExecutionCases.id, id)).limit(1))[0]?.c ?? null;
  const colOf = async (id: number, col: "engagementStatus" | "callAttemptCount" | "nextActionAt") => {
    const [row] = await db.select().from(patientExecutionCases).where(eq(patientExecutionCases.id, id)).limit(1);
    return (row as Record<string, unknown>)?.[col] ?? null;
  };

  try {
    // ── Setup: clinic, 3 users, 3 schedulers (s3 INACTIVE for redistribution),
    //    settings, batch. s1/s2 map to u1/u2 for the HTTP handler test. ────────
    const [clinic] = await db.insert(clinics).values({ name: `${marker}_c`, slug: `${marker.toLowerCase().replace(/_/g, "-")}-c`, timezone: "America/Chicago", active: true } as never).returning();
    clinicIds.push(clinic.id);
    const mkUser = async (suffix: string) => {
      const [u] = await db.insert(users).values({ username: `${marker}_${suffix}`, password: "x" } as never).returning();
      userIds.push(u.id);
      return u;
    };
    const u1 = await mkUser("u1");
    const u2 = await mkUser("u2");
    const mkSched = async (suffix: string, userId: string | null, active: boolean) => {
      const [s] = await db.insert(outreachSchedulers).values({ clinicId: clinic.id, name: `${marker}_${suffix}`, facility: `${marker}_fac`, userId } as never).returning();
      schedIds.push(s.id);
      await db.insert(engagementCallSettings).values({ schedulerId: s.id, active, callWorkdayPercent: 100 } as never);
      return s;
    };
    const s1 = await mkSched("s1", u1.id, true);
    const s2 = await mkSched("s2", u2.id, true);
    const s3 = await mkSched("s3", null, false); // inactive → never receives redistributed work
    const [batch] = await db.insert(screeningBatches).values({ name: marker } as never).returning();
    batchId = batch.id;

    const now = new Date();
    const past = new Date(now.getTime() - 60 * 60_000);
    const future = new Date(now.getTime() + 60 * 60_000);
    // ── A) Claim lifecycle + concurrency + orthogonality ─────────────────────
    const { ec: caseA } = await insCase({ owner: s1.id, name: `${marker}_A` });
    const a1 = await wc.acquireClaim({ executionCaseId: caseA.id, schedulerId: s1.id, now });
    assert.equal(a1.ok, true); assert.equal((a1 as { state: string }).state, "acquired", "A: s1 acquires");
    const a2 = await wc.acquireClaim({ executionCaseId: caseA.id, schedulerId: s1.id, now });
    assert.equal((a2 as { state: string }).state, "renewed", "A: same-holder re-acquire = renew (idempotent)");
    const a3 = await wc.acquireClaim({ executionCaseId: caseA.id, schedulerId: s2.id, now });
    assert.equal(a3.ok, false); assert.equal((a3 as { code: string }).code, "conflict", "A: s2 gets conflict");
    // Orthogonality — claim churn changed NO disposition/metric columns.
    assert.equal(await colOf(caseA.id, "engagementStatus"), "not_reached", "A: engagementStatus untouched");
    assert.equal(await colOf(caseA.id, "callAttemptCount"), 0, "A: attempt count untouched");
    assert.equal(await colOf(caseA.id, "nextActionAt"), null, "A: nextActionAt untouched");
    await wc.releaseClaim({ executionCaseId: caseA.id, schedulerId: s1.id, now });
    // Concurrency: two simultaneous acquires → exactly one wins.
    const [p1, p2] = await Promise.all([
      wc.acquireClaim({ executionCaseId: caseA.id, schedulerId: s1.id, now }),
      wc.acquireClaim({ executionCaseId: caseA.id, schedulerId: s2.id, now }),
    ]);
    assert.equal([p1, p2].filter((r) => r.ok).length, 1, "A: exactly one concurrent acquirer wins");
    await db.update(patientExecutionCases).set({ activeClaimBy: null, activeClaimAt: null, activeClaimExpiresAt: null }).where(eq(patientExecutionCases.id, caseA.id));

    // ── B) Cross-service sibling exclusion ──────────────────────────────────
    const { ec: caseSibA } = await insCase({ owner: s1.id, name: `${marker}_SIB`, dob: "1985-05-05" });
    const { ec: caseSibB } = await insCase({ owner: s2.id, name: `${marker}_SIB`, dob: "1985-05-05" }); // same patient, other service
    await wc.acquireClaim({ executionCaseId: caseSibA.id, schedulerId: s1.id, now });
    const sib = await wc.acquireClaim({ executionCaseId: caseSibB.id, schedulerId: s2.id, now });
    assert.equal(sib.ok, false); assert.equal((sib as { code: string }).code, "conflict_sibling", "B: sibling claim blocks cross-service concurrent work");
    await wc.releaseClaim({ executionCaseId: caseSibA.id, schedulerId: s1.id, now });

    // ── C) memberHoldsActiveClaim (valid vs expired) ────────────────────────
    await wc.acquireClaim({ executionCaseId: caseA.id, schedulerId: s1.id, now });
    assert.equal(await wc.memberHoldsActiveClaim(s1.id, now), true, "C: holder detected");
    assert.equal(await wc.memberHoldsActiveClaim(s2.id, now), false, "C: non-holder not detected");
    // Expire it → no longer counts.
    await db.update(patientExecutionCases).set({ activeClaimExpiresAt: past }).where(eq(patientExecutionCases.id, caseA.id));
    assert.equal(await wc.memberHoldsActiveClaim(s1.id, now), false, "C: expired claim does NOT count");
    await db.update(patientExecutionCases).set({ activeClaimBy: null, activeClaimAt: null, activeClaimExpiresAt: null }).where(eq(patientExecutionCases.id, caseA.id));
    // ── D) Redistribution PROTECTS claimed work; force-release overrides ────
    const { ec: dueD } = await insCase({ owner: s3.id, name: `${marker}_D_due`, nextActionAt: past });
    const { ec: claimedD } = await insCase({ owner: s3.id, name: `${marker}_D_claim`, nextActionAt: past, claimBy: s3.id, claimExpiresAt: future });
    await releaseAndRedistributeCanonical(s3.id, "test_absence", null);
    assert.equal(await ownerOf(claimedD.id), s3.id, "D: actively-claimed case is PROTECTED (not released)");
    assert.notEqual(await ownerOf(dueD.id), s3.id, "D: unclaimed due case IS released (s3 inactive → not returned)");
    // Force-release (deactivation/emergency) DOES take the claimed case.
    await releaseAndRedistributeCanonical(s3.id, "test_deactivation", null, { forceReleaseClaims: true });
    assert.notEqual(await ownerOf(claimedD.id), s3.id, "D: force-release reassigns the claimed case");
    assert.equal(await claimByOf(claimedD.id), null, "D: force-release CLEARS the claim");
    // ── E) Early-departure redistribution protects claimed work ─────────────
    const { ec: dueE } = await insCase({ owner: s3.id, name: `${marker}_E_due`, nextActionAt: past });
    const { ec: claimedE } = await insCase({ owner: s3.id, name: `${marker}_E_claim`, nextActionAt: past, claimBy: s3.id, claimExpiresAt: future });
    await redistributeForEarlyDeparture(s3.id, "test_early_departure", null, now);
    assert.equal(await ownerOf(claimedE.id), s3.id, "E: early-departure PROTECTS the actively-claimed case");
    assert.notEqual(await ownerOf(dueE.id), s3.id, "E: early-departure releases the unclaimed due case");
    await db.update(patientExecutionCases).set({ activeClaimBy: null, activeClaimAt: null, activeClaimExpiresAt: null }).where(eq(patientExecutionCases.id, claimedE.id));
    // ── F) Eligibility suppression (distribution + portal) ──────────────────
    // Distribution: an UNASSIGNED case whose (name,dob) sibling is actively
    // claimed is excluded; releasing the claim re-includes it.
    const { ec: eligUnassigned } = await insCase({ owner: null, name: `${marker}_ELIG`, dob: "1970-07-07" });
    const { ec: eligSibClaimed } = await insCase({ owner: s1.id, name: `${marker}_ELIG`, dob: "1970-07-07", claimBy: s1.id, claimExpiresAt: future });
    let pool = await gatherEligibleCases(db);
    assert.ok(!pool.some((c) => c.executionCaseId === eligUnassigned.id), "F: unassigned case with a claimed sibling is EXCLUDED from distribution");
    await db.update(patientExecutionCases).set({ activeClaimBy: null, activeClaimAt: null, activeClaimExpiresAt: null }).where(eq(patientExecutionCases.id, eligSibClaimed.id));
    pool = await gatherEligibleCases(db);
    assert.ok(pool.some((c) => c.executionCaseId === eligUnassigned.id), "F: after claim released, case is eligible again");
    // Portal: own claim visible, non-owner claim hidden.
    const { ec: portOwn } = await insCase({ owner: s1.id, name: `${marker}_PORT_own`, claimBy: s1.id, claimExpiresAt: future });
    const { ec: portOther } = await insCase({ owner: s1.id, name: `${marker}_PORT_other`, claimBy: s2.id, claimExpiresAt: future });
    const portal = await listSchedulerPortalCases({ assignedTeamMemberId: s1.id }, 500);
    assert.ok(portal.some((c) => c.id === portOwn.id), "F: my OWN active claim stays visible on my call list");
    assert.ok(!portal.some((c) => c.id === portOther.id), "F: a case claimed by SOMEONE ELSE is hidden from my call list");
    // ── G) Contact-fatigue policy (opt-in) + explicit-callback + DNC ────────
    await upsertAdminSetting({ settingDomain: "engagement_center", settingKey: "max_ordinary_attempts_per_day", settingValue: { value: 1 }, facilityId: null, userId: null });
    const { ec: freqOrdinary, screening: freqScr } = await insCase({ owner: null, name: `${marker}_FREQ_ord`, nextActionAt: null });
    await db.insert(outreachCalls).values({ patientScreeningId: freqScr.id, outcome: "no_answer", attemptNumber: 1, startedAt: now } as never); // 1 attempt today
    const { ec: freqCallback, screening: cbScr } = await insCase({ owner: null, name: `${marker}_FREQ_cb`, nextActionAt: future });
    await db.insert(outreachCalls).values({ patientScreeningId: cbScr.id, outcome: "no_answer", attemptNumber: 1, startedAt: now } as never);
    const { ec: dncCase, screening: dncScr } = await insCase({ owner: null, name: `${marker}_DNC`, nextActionAt: null });
    await db.insert(outreachCalls).values({ patientScreeningId: dncScr.id, outcome: "refused_dnc", attemptNumber: 1, startedAt: now } as never);
    const poolG = await gatherEligibleCases(db);
    assert.ok(!poolG.some((c) => c.executionCaseId === freqOrdinary.id), "G: ordinary case at the daily attempt limit is suppressed");
    assert.ok(poolG.some((c) => c.executionCaseId === freqCallback.id), "G: explicit-callback case is EXEMPT (still eligible)");
    assert.ok(!poolG.some((c) => c.executionCaseId === dncCase.id), "G: DNC is absolute (suppressed regardless of policy)");
    // Reset the policy → the ordinary case is eligible again (opt-in proof).
    await db.delete(adminSettings).where(eq(adminSettings.settingKey, "max_ordinary_attempts_per_day"));
    const poolGoff = await gatherEligibleCases(db);
    assert.ok(poolGoff.some((c) => c.executionCaseId === freqOrdinary.id), "G: with policy OFF (default), the case is eligible (no regression)");
    // ── H) Stale-claimant call-result rejection + release-on-success (HTTP) ──
    const app = express();
    app.use(express.json());
    let sessionUserId = u1.id;
    app.use((req, _res, next) => {
      (req as unknown as { session: unknown }).session = { userId: sessionUserId, role: "scheduler", clinicId: clinic.id };
      (req as unknown as { clinicId: number }).clinicId = clinic.id;
      next();
    });
    registerExecutionCaseRoutes(app);
    httpServer = createServer(app);
    await new Promise<void>((r) => httpServer!.listen(0, r));
    const addr = httpServer.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const base = `http://127.0.0.1:${port}`;

    const { ec: caseCR, screening: crScr } = await insCase({ owner: s1.id, name: `${marker}_CR`, status: "not_reached" });
    await wc.acquireClaim({ executionCaseId: caseCR.id, schedulerId: s1.id, now }); // s1 holds the claim

    // u2 (a DIFFERENT scheduler) submits → stale → 409, NO side effects.
    sessionUserId = u2.id;
    const staleRes = await fetch(`${base}/api/engagement-center/call-result`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ executionCaseId: caseCR.id, callResult: "no_answer", callKey: `${marker}_stale` }),
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(staleRes.status, 409, "H: stale claimant call-result → 409");
    const staleBody = await staleRes.json();
    assert.equal(staleBody.code, "stale_work_claim", "H: 409 body carries stale_work_claim");
    assert.equal(await claimByOf(caseCR.id), s1.id, "H: stale attempt did NOT disturb the claim");
    assert.equal(await colOf(caseCR.id, "callAttemptCount"), 0, "H: stale attempt did NOT increment attempts (no side effects)");
    const staleCalls = await db.select().from(outreachCalls).where(eq(outreachCalls.patientScreeningId, crScr.id));
    assert.equal(staleCalls.length, 0, "H: stale attempt created NO outreach_calls row");

    // u1 (the holder) submits → 200, disposition commits, claim released.
    sessionUserId = u1.id;
    const okRes = await fetch(`${base}/api/engagement-center/call-result`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ executionCaseId: caseCR.id, callResult: "no_answer", callKey: `${marker}_ok` }),
    });
    assert.equal(okRes.status, 200, "H: holder call-result → 200");
    assert.equal(await claimByOf(caseCR.id), null, "H: successful disposition RELEASED the holder's claim");
    assert.equal(await colOf(caseCR.id, "callAttemptCount"), 1, "H: the disposition (not the claim) incremented the attempt exactly once");

    console.log("phase4WorkClaimDb: all real-DB work-claim / contact-protection checks passed.");
  } finally {
    try {
      if (httpServer) await new Promise<void>((r) => httpServer!.close(() => r()));
      await db.delete(adminSettings).where(inArray(adminSettings.settingKey, ["max_ordinary_attempts_per_day", "min_contact_interval_minutes"]));
      if (scrIds.length) await db.delete(outreachCalls).where(inArray(outreachCalls.patientScreeningId, scrIds));
      if (caseIds.length) {
        await db.execute(sql`DELETE FROM needs_coverage WHERE execution_case_id IN (${sql.join(caseIds, sql`, `)})`).catch(() => {});
        await db.delete(patientJourneyEvents).where(inArray(patientJourneyEvents.executionCaseId, caseIds));
      }
      if (scrIds.length) await db.delete(patientJourneyEvents).where(inArray(patientJourneyEvents.patientScreeningId, scrIds));
      if (caseIds.length) await db.delete(patientExecutionCases).where(inArray(patientExecutionCases.id, caseIds));
      if (scrIds.length) await db.delete(patientScreenings).where(inArray(patientScreenings.id, scrIds));
      if (batchId != null) await db.delete(screeningBatches).where(eq(screeningBatches.id, batchId));
      if (schedIds.length) {
        await db.delete(engagementCallSettings).where(inArray(engagementCallSettings.schedulerId, schedIds));
        await db.delete(outreachSchedulers).where(inArray(outreachSchedulers.id, schedIds));
      }
      if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
      if (clinicIds.length) await db.delete(clinics).where(inArray(clinics.id, clinicIds));
    } catch (cleanupErr) {
      console.error("phase4WorkClaimDb cleanup warning:", (cleanupErr as Error).message);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
