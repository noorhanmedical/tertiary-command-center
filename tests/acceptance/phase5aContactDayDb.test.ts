// Phase 5A — REAL-DB checks for the CONTACT-FATIGUE clinic-local operational-day
// fix (Part 12). The "attempts today" window must use each case's CLINIC-LOCAL
// operational day (Phase 2 timezone utils), NOT UTC midnight. The decisive test
// is the same-UTC-instant / different-clinic-date boundary: one outreach_call at
// a single instant counts as "today" for a clinic whose local day already began,
// but as "yesterday" for a clinic further west whose local day has not — so with
// max_ordinary_attempts_per_day = 1 the first clinic's case is suppressed while
// the second stays eligible.
//
// Also re-verifies the NON-NEGOTIABLE invariants in the clinic-local world:
//   • explicit callback (next_action_at set) is EXEMPT even at the daily limit,
//   • DNC is absolute (suppressed regardless of the contact policy),
//   • a disabled policy (default) is a no-op (no regression).
//
// Robustness: the two clinics' local-midnight-in-UTC instants are resolved at
// run time (their ordering flips with wall-clock time of day), so we derive
// "earlier" / "later" from the actual boundaries instead of hardcoding roles.
// The probe call is placed at the MIDPOINT between the two boundaries (>= the
// earlier start, < the later start), which is >= 30 min from each boundary — far
// outside any sub-millisecond re-resolution drift inside gatherEligibleCases.
//
// Honest skip when DATABASE_URL is unset/unreachable. Returns the DB to baseline
// in `finally` (deletes every fixture row + the opt-in admin_settings rows).
//
// Run: DATABASE_URL=... npx tsx tests/acceptance/phase5aContactDayDb.test.ts

import assert from "node:assert/strict";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("SKIP phase5aContactDayDb: DATABASE_URL not set.");
    return;
  }
  const { sql, eq, inArray } = await import("drizzle-orm");
  const { db } = await import("../../server/db");
  try {
    await db.execute(sql`select 1`);
  } catch (e) {
    console.log(`SKIP phase5aContactDayDb: cannot reach database — ${(e as Error).message}`);
    return;
  }

  const { clinics } = await import("../../shared/schema/clinics");
  const { patientScreenings, screeningBatches } = await import("../../shared/schema/screening");
  const { patientExecutionCases, patientJourneyEvents } = await import("../../shared/schema/executionCase");
  const { outreachCalls } = await import("../../shared/schema/outreach");
  const { adminSettings } = await import("../../shared/schema/adminSettings");
  const { gatherEligibleCases } = await import("../../server/services/engagement/distributionService");
  const { resolveContactDayStarts } = await import("../../server/repositories/executionCase.repo");
  const { upsertAdminSetting } = await import("../../server/repositories/adminSettings.repo");

  const marker = `__P5CD_${Date.now()}`;
  const clinicIds: number[] = [];
  const scrIds: number[] = [];
  const caseIds: number[] = [];
  let batchId: number | null = null;

  // Create one unassigned, otherwise-eligible outreach case in `clinicId`.
  // `nextActionAt` set → the row is an explicit callback (contact-fatigue exempt).
  const insCase = async (opts: {
    clinicId: number;
    name: string;
    nextActionAt?: Date | null;
  }) => {
    const [s] = await db
      .insert(patientScreenings)
      .values({ batchId: batchId as number, name: opts.name, isTest: true } as never)
      .returning();
    scrIds.push(s.id);
    const [c] = await db
      .insert(patientExecutionCases)
      .values({
        patientName: opts.name,
        patientDob: "1990-01-01",
        patientScreeningId: s.id,
        clinicId: opts.clinicId,
        facilityId: `${marker}_fac`,
        engagementBucket: "outreach",
        engagementStatus: "not_reached",
        lifecycleStatus: "active",
        assignedTeamMemberId: null,
        nextActionAt: opts.nextActionAt ?? null,
      } as never)
      .returning();
    caseIds.push(c.id);
    return { ec: c, screening: s };
  };

  const addCall = async (screeningId: number, startedAt: Date, outcome = "no_answer") => {
    await db
      .insert(outreachCalls)
      .values({ patientScreeningId: screeningId, outcome, attemptNumber: 1, startedAt } as never);
  };

  const inPool = (pool: Array<{ executionCaseId: number }>, id: number) =>
    pool.some((c) => c.executionCaseId === id);

  try {
    // ── Setup: two clinics in DIFFERENT timezones + a batch. ────────────────
    const mkClinic = async (suffix: string, tz: string) => {
      const [c] = await db
        .insert(clinics)
        .values({
          name: `${marker}_${suffix}`,
          slug: `${marker.toLowerCase().replace(/_/g, "-")}-${suffix}`,
          timezone: tz,
          active: true,
        } as never)
        .returning();
      clinicIds.push(c.id);
      return c;
    };
    // America/Chicago (Central, UTC-5/-6) and America/Phoenix (Mountain, UTC-7,
    // no DST) — their local-midnight-in-UTC instants are always distinct.
    const chicago = await mkClinic("chi", "America/Chicago");
    const phoenix = await mkClinic("phx", "America/Phoenix");
    const [batch] = await db.insert(screeningBatches).values({ name: marker } as never).returning();
    batchId = batch.id;

    // ── Resolve the REAL per-clinic operational-day boundaries and derive the
    //    "earlier" vs "later" clinic from them (ordering is time-of-day
    //    dependent, so never hardcode which is which). ────────────────────────
    const dayStarts = await resolveContactDayStarts();
    const chiStart = dayStarts.perClinic.get(chicago.id);
    const phxStart = dayStarts.perClinic.get(phoenix.id);
    assert.ok(chiStart instanceof Date && phxStart instanceof Date, "day-start boundaries resolved for both clinics");
    assert.notEqual(
      chiStart!.getTime(),
      phxStart!.getTime(),
      "sanity: the two timezones yield distinct local-midnight UTC instants",
    );
    const earlier = chiStart!.getTime() < phxStart!.getTime()
      ? { id: chicago.id, start: chiStart!, tz: "America/Chicago" }
      : { id: phoenix.id, start: phxStart!, tz: "America/Phoenix" };
    const later = chiStart!.getTime() < phxStart!.getTime()
      ? { id: phoenix.id, start: phxStart!, tz: "America/Phoenix" }
      : { id: chicago.id, start: chiStart!, tz: "America/Chicago" };
    // One instant: on/after the earlier clinic's local midnight, but strictly
    // BEFORE the later clinic's. i.e. "today" for `earlier`, "yesterday" for
    // `later`.
    const probeInstant = new Date((earlier.start.getTime() + later.start.getTime()) / 2);
    assert.ok(
      probeInstant.getTime() >= earlier.start.getTime() && probeInstant.getTime() < later.start.getTime(),
      "probe instant sits in the clinic-local-day gap [earlierStart, laterStart)",
    );

    // ── Enable the opt-in policy: at most 1 ordinary attempt per (clinic-local) day.
    await upsertAdminSetting({
      settingDomain: "engagement_center",
      settingKey: "max_ordinary_attempts_per_day",
      settingValue: { value: 1 },
      facilityId: null,
      userId: null,
    });

    // ── Fixtures — one call each at the SAME probe instant. ─────────────────
    const { ec: earlierCase, screening: earlierScr } = await insCase({ clinicId: earlier.id, name: `${marker}_EARLIER` });
    await addCall(earlierScr.id, probeInstant); // counts as "today" for earlier clinic

    const { ec: laterCase, screening: laterScr } = await insCase({ clinicId: later.id, name: `${marker}_LATER` });
    await addCall(laterScr.id, probeInstant); // still "yesterday" for later clinic

    // Explicit callback at the earlier clinic — 1 call today, but EXEMPT.
    const future = new Date(Date.now() + 60 * 60_000);
    const { ec: cbCase, screening: cbScr } = await insCase({ clinicId: earlier.id, name: `${marker}_CALLBACK`, nextActionAt: future });
    await addCall(cbScr.id, probeInstant);

    // DNC at the earlier clinic — must be absolute regardless of the policy.
    const { ec: dncCase, screening: dncScr } = await insCase({ clinicId: earlier.id, name: `${marker}_DNC` });
    await addCall(dncScr.id, probeInstant, "refused_dnc");

    // ── ASSERT (policy ON): clinic-local boundary + exemptions ──────────────
    const pool = await gatherEligibleCases(db);
    assert.ok(
      !inPool(pool, earlierCase.id),
      `clinic-local boundary: a call at ${probeInstant.toISOString()} counts as TODAY for the ${earlier.tz} clinic (>= its local midnight) → suppressed at the daily limit`,
    );
    assert.ok(
      inPool(pool, laterCase.id),
      `clinic-local boundary: the SAME instant is still YESTERDAY for the ${later.tz} clinic (< its local midnight) → 0 attempts today → eligible`,
    );
    assert.ok(
      inPool(pool, cbCase.id),
      "explicit callback is EXEMPT from contact-fatigue even at the daily limit",
    );
    assert.ok(
      !inPool(pool, dncCase.id),
      "DNC is absolute — suppressed regardless of the contact policy",
    );

    // ── ASSERT (policy OFF / default): no-op — earlier case eligible again;
    //    DNC still absolute. ──────────────────────────────────────────────────
    await db.delete(adminSettings).where(eq(adminSettings.settingKey, "max_ordinary_attempts_per_day"));
    const poolOff = await gatherEligibleCases(db);
    assert.ok(
      inPool(poolOff, earlierCase.id),
      "policy OFF (default) is a no-op: the previously-suppressed case is eligible again (no regression)",
    );
    assert.ok(
      !inPool(poolOff, dncCase.id),
      "DNC remains suppressed with the policy OFF (absolute, independent of contact-fatigue)",
    );

    console.log("phase5aContactDayDb: clinic-local contact-fatigue boundary + exemptions + disabled no-op all passed.");
  } finally {
    try {
      await db
        .delete(adminSettings)
        .where(inArray(adminSettings.settingKey, ["max_ordinary_attempts_per_day", "min_contact_interval_minutes"]));
      if (scrIds.length) await db.delete(outreachCalls).where(inArray(outreachCalls.patientScreeningId, scrIds));
      if (caseIds.length) await db.delete(patientJourneyEvents).where(inArray(patientJourneyEvents.executionCaseId, caseIds));
      if (scrIds.length) await db.delete(patientJourneyEvents).where(inArray(patientJourneyEvents.patientScreeningId, scrIds));
      if (caseIds.length) await db.delete(patientExecutionCases).where(inArray(patientExecutionCases.id, caseIds));
      if (scrIds.length) await db.delete(patientScreenings).where(inArray(patientScreenings.id, scrIds));
      if (batchId != null) await db.delete(screeningBatches).where(eq(screeningBatches.id, batchId));
      if (clinicIds.length) await db.delete(clinics).where(inArray(clinics.id, clinicIds));
    } catch (cleanupErr) {
      console.error("phase5aContactDayDb cleanup warning:", (cleanupErr as Error).message);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
