// Phase 3 — REAL-DB checks for workforce shifts + intra-day availability +
// safe early-departure redistribution, EXTENDING the canonical distribution /
// redistribution engines (no new allocator). Honest skip when DATABASE_URL is
// unset/unreachable.
//
// What this proves against a live Postgres:
//   • PLANNED (5 AM) vs REAL-TIME (live) gating diverge for a shift member
//     (planned = scheduled-that-day; realtime = within shift window).
//   • Capacity is PRORATED by the shift fraction; capacityOverride is an
//     explicit KPI that bypasses proration.
//   • Clinic-timezone correctness: the SAME UTC instant is inside one clinic's
//     shift and outside another's (Phoenix vs Chicago).
//   • Early departure (finish_current_only) releases DUE work + future callbacks
//     the member will NOT cover, PRESERVES future callbacks they WILL cover, and
//     NEVER mutates nextActionAt (exact preservation).
//   • Availability that only stops NEW work (on_break) persists state and does
//     NOT redistribute; a future-dated shift change does NOT redistribute today.
//
// Safety: gatherEligibleCases only selects UNASSIGNED cases, so the real (all
// already-assigned) roster work is never shuffled; the only cases the internal
// applyDistribution can move are the ones THIS test releases, all of which are
// deleted in teardown. The early-departure member is marked inactive so the
// allocator can never hand the released cases back to it (deterministic).
//
// Run: DATABASE_URL=... npx tsx tests/acceptance/phase3WorkforceDb.test.ts

import assert from "node:assert/strict";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("SKIP phase3WorkforceDb: DATABASE_URL not set.");
    return;
  }
  const { sql, eq, inArray } = await import("drizzle-orm");
  const { db } = await import("../../server/db");
  try {
    await db.execute(sql`select 1`);
  } catch (e) {
    console.log(`SKIP phase3WorkforceDb: cannot reach database — ${(e as Error).message}`);
    return;
  }
  // Guard: the Phase 3 shift table must be applied.
  const reg = await db.execute(sql`SELECT to_regclass('team_member_shifts') AS t`);
  if (!(reg.rows?.[0] as { t?: string } | undefined)?.t) {
    console.log("SKIP phase3WorkforceDb: team_member_shifts missing (apply migration 0083).");
    return;
  }

  const { clinics } = await import("../../shared/schema/clinics");
  const { outreachSchedulers } = await import("../../shared/schema/outreach");
  const { engagementCallSettings } = await import("../../shared/schema/engagement");
  const { teamMemberShifts } = await import("../../shared/schema/workforceShifts");
  const { patientScreenings, screeningBatches } = await import("../../shared/schema/screening");
  const { patientExecutionCases, patientJourneyEvents } = await import("../../shared/schema/executionCase");
  const { gatherDistributionMembers } = await import("../../server/services/engagement/distributionService");
  const {
    memberAvailableAtInstant,
    redistributeForEarlyDeparture,
    setMemberAvailabilityState,
    setMemberShift,
  } = await import("../../server/services/engagement/workforceAvailability");
  const { upsertShift } = await import("../../server/repositories/workforceShifts.repo");
  const { __resetClinicTimeZoneCacheForTests } = await import("../../server/services/engagement/clinicTimeZone");

  const marker = `__P3WF_${Date.now()}`;
  const clinicIds: number[] = [];
  const schedulerIds: number[] = [];
  const scrIds: number[] = [];
  const caseIds: number[] = [];
  let batchId: number | null = null;

  const insClinic = async (suffix: string, timezone: string) => {
    const [c] = await db
      .insert(clinics)
      .values({ name: `${marker}_${suffix}`, slug: `${marker.toLowerCase().replace(/_/g, "-")}-${suffix}`, timezone, active: true } as never)
      .returning();
    clinicIds.push(c.id);
    return c;
  };
  const insScheduler = async (clinicId: number, suffix: string) => {
    const [s] = await db
      .insert(outreachSchedulers)
      .values({ clinicId, name: `${marker}_${suffix}`, facility: `${marker}_fac_${suffix}` } as never)
      .returning();
    schedulerIds.push(s.id);
    return s;
  };
  const insSettings = async (schedulerId: number, patch: Record<string, unknown>) => {
    await db.insert(engagementCallSettings).values({ schedulerId, ...patch } as never);
  };
  const insCase = async (
    schedulerId: number | null,
    clinicId: number,
    suffix: string,
    engagementStatus: string,
    nextActionAt: Date | null,
  ) => {
    const [s] = await db
      .insert(patientScreenings)
      .values({ batchId: batchId as number, name: `${marker}_${suffix}`, isTest: true } as never)
      .returning();
    scrIds.push(s.id);
    const [c] = await db
      .insert(patientExecutionCases)
      .values({
        patientName: `${marker}_${suffix}`,
        patientScreeningId: s.id,
        clinicId,
        facilityId: `${marker}_fac_${suffix}`,
        engagementBucket: "outreach",
        engagementStatus,
        lifecycleStatus: "active",
        assignedTeamMemberId: schedulerId,
        assignedRole: schedulerId != null ? "scheduler" : null,
        nextActionAt,
      } as never)
      .returning();
    caseIds.push(c.id);
    return c;
  };
  const ownerOf = async (caseId: number): Promise<number | null> => {
    const [row] = await db
      .select({ owner: patientExecutionCases.assignedTeamMemberId })
      .from(patientExecutionCases)
      .where(eq(patientExecutionCases.id, caseId))
      .limit(1);
    return row?.owner ?? null;
  };
  const nextActionOf = async (caseId: number): Promise<number | null> => {
    const [row] = await db
      .select({ n: patientExecutionCases.nextActionAt })
      .from(patientExecutionCases)
      .where(eq(patientExecutionCases.id, caseId))
      .limit(1);
    const v = row?.n as unknown as string | Date | null;
    return v == null ? null : new Date(v).getTime();
  };

  try {
    __resetClinicTimeZoneCacheForTests();
    const [batch] = await db.insert(screeningBatches).values({ name: marker } as never).returning();
    batchId = batch.id;

    const chi = await insClinic("CHI", "America/Chicago");
    const phx = await insClinic("PHX", "America/Phoenix");

    // S1 — Chicago, active. Used for gating + proration reads.
    const s1 = await insScheduler(chi.id, "S1");
    await insSettings(s1.id, { active: true, callWorkdayPercent: 100 });
    // S2 — Chicago, INACTIVE (so the allocator never re-hands released work to
    // it → deterministic early-departure assertions). Owns the test cases.
    const s2 = await insScheduler(chi.id, "S2");
    await insSettings(s2.id, { active: false, callWorkdayPercent: 100 });
    // S3 — Phoenix, active. Used for cross-timezone availability.
    const s3 = await insScheduler(phx.id, "S3");
    await insSettings(s3.id, { active: true, callWorkdayPercent: 100 });

    const findMember = async (schedulerId: number, mode: "planned" | "realtime", now: Date) => {
      const members = await gatherDistributionMembers({ mode, now });
      const m = members.find((x) => x.schedulerId === schedulerId);
      assert.ok(m, `member ${schedulerId} present in ${mode} gather`);
      return m!;
    };

    // ── 1) PLANNED vs REAL-TIME gating (S1, Chicago shift 09:00–17:00) ────────
    // Override wins regardless of weekday, so the date's weekday is irrelevant.
    await upsertShift({ schedulerId: s1.id, clinicId: chi.id, workDate: "2026-06-15", working: true, shiftStart: "09:00", shiftEnd: "17:00" });

    // 12:00Z on 2026-06-15 = Chicago 07:00 (CDT) → BEFORE the 09:00 shift.
    const beforeShift = new Date("2026-06-15T12:00:00Z");
    const s1PlannedBefore = await findMember(s1.id, "planned", beforeShift);
    assert.equal(s1PlannedBefore.workingToday, true, "1: planned → scheduled to work today");
    assert.equal(s1PlannedBefore.acceptingNewWork, true, "1: PLANNED ignores time-of-day (5 AM job)");

    const s1RealtimeBefore = await findMember(s1.id, "realtime", beforeShift);
    assert.equal(s1RealtimeBefore.workingToday, true, "1: realtime still planned-working today");
    assert.equal(s1RealtimeBefore.acceptingNewWork, false, "1: REAL-TIME before shift → NOT accepting new work");

    // 17:00Z = Chicago 12:00 → INSIDE the shift.
    const inShift = new Date("2026-06-15T17:00:00Z");
    const s1RealtimeIn = await findMember(s1.id, "realtime", inShift);
    assert.equal(s1RealtimeIn.acceptingNewWork, true, "1: REAL-TIME inside shift → accepting");

    // ── 2) Capacity proration + capacityOverride precedence (S1) ──────────────
    // Full-day 09–17 → fraction 1 (no proration).
    const capFull = (await findMember(s1.id, "realtime", inShift)).dailyCallCapacity;
    assert.ok(capFull > 0, "2: full-day capacity > 0");

    // Half-day 09–13 → fraction 0.5 → strictly smaller capacity, still > 0.
    await upsertShift({ schedulerId: s1.id, clinicId: chi.id, workDate: "2026-06-15", shiftStart: "09:00", shiftEnd: "13:00" });
    const capHalf = (await findMember(s1.id, "realtime", inShift)).dailyCallCapacity;
    assert.ok(capHalf > 0 && capHalf < capFull, `2: half-day capacity prorated (${capHalf} < ${capFull})`);

    // capacityOverride is an explicit KPI → bypasses proration → exact value.
    await upsertShift({ schedulerId: s1.id, clinicId: chi.id, workDate: "2026-06-15", shiftStart: "09:00", shiftEnd: "13:00", capacityOverride: 17 });
    const capOverride = (await findMember(s1.id, "realtime", inShift)).dailyCallCapacity;
    assert.equal(capOverride, 17, "2: capacityOverride bypasses proration → exact daily capacity");

    // ── 3) Clinic-timezone correctness (SAME instant, different clinic) ───────
    // 23:30Z on 2026-06-15: Phoenix (MST -7) = 16:30 (INSIDE 09–17); Chicago
    // (CDT -5) = 18:30 (AFTER 17:00). Same UTC instant, opposite availability.
    await upsertShift({ schedulerId: s3.id, clinicId: phx.id, workDate: "2026-06-15", working: true, shiftStart: "09:00", shiftEnd: "17:00" });
    await upsertShift({ schedulerId: s1.id, clinicId: chi.id, workDate: "2026-06-15", working: true, shiftStart: "09:00", shiftEnd: "17:00", capacityOverride: null });
    const sameInstant = new Date("2026-06-15T23:30:00Z");
    assert.equal(await memberAvailableAtInstant(s3.id, sameInstant), true, "3: Phoenix 16:30 → inside shift");
    assert.equal(await memberAvailableAtInstant(s1.id, sameInstant), false, "3: Chicago 18:30 → after shift (tz-correct)");

    // ── 4) Early departure (finish_current_only): due + uncovered released,   ──
    //       covered-future preserved, nextActionAt never touched (S2). ─────────
    // S2 shift today (Chicago) 09:00–17:00. now = Chicago 12:00 (17:00Z).
    await upsertShift({ schedulerId: s2.id, clinicId: chi.id, workDate: "2026-06-15", working: true, shiftStart: "09:00", shiftEnd: "17:00" });
    const now = new Date("2026-06-15T17:00:00Z"); // Chicago 12:00

    const naDue = new Date("2026-06-15T15:00:00Z");       // Chicago 10:00 — past → DUE
    const naCovered = new Date("2026-06-15T18:00:00Z");   // Chicago 13:00 — inside shift → WILL cover
    const naUncovered = new Date("2026-06-15T23:30:00Z"); // Chicago 18:30 — after shift → WON'T cover
    const caseDue = await insCase(s2.id, chi.id, "DUE", "not_reached", naDue);
    const caseCovered = await insCase(s2.id, chi.id, "COVERED", "callback", naCovered);
    const caseUncovered = await insCase(s2.id, chi.id, "UNCOVERED", "callback", naUncovered);

    const result = await redistributeForEarlyDeparture(s2.id, "test_early_departure", null, now);
    assert.equal(result.released, 2, "4: released DUE + UNCOVERED (2 cases)");

    assert.notEqual(await ownerOf(caseDue.id), s2.id, "4: DUE released from departing member");
    assert.equal(await ownerOf(caseCovered.id), s2.id, "4: future callback the member WILL cover is PRESERVED");
    assert.notEqual(await ownerOf(caseUncovered.id), s2.id, "4: future callback the member WON'T cover is released");

    // EXACT nextActionAt preservation is proven on the PRESERVED case: it is
    // never released nor reassigned, so its due-time is untouched by the early
    // departure. (Released cases are re-timed by the SAME canonical assignment
    // policy every distribution uses — a future next-action is preserved, a
    // past one becomes due-now for the new owner — which is existing behavior,
    // not something this feature should override.)
    assert.equal(await nextActionOf(caseCovered.id), naCovered.getTime(), "4: preserved case nextActionAt untouched (exact)");

    // ── 5) on_break stops NEW work but does NOT redistribute; state persists ──
    const breakRes = await setMemberAvailabilityState(s2.id, "on_break", "lunch", null, now);
    assert.equal(breakRes.redistribution, null, "5: on_break does NOT trigger redistribution");
    const [shiftRow] = await db
      .select({ st: teamMemberShifts.availabilityState })
      .from(teamMemberShifts)
      .where(eq(teamMemberShifts.schedulerId, s2.id));
    assert.equal(shiftRow?.st, "on_break", "5: availability state persisted");
    // The covered case is still owned (break never releases).
    assert.equal(await ownerOf(caseCovered.id), s2.id, "5: break keeps the current queue intact");

    // ── 6) A FUTURE-dated shift change does NOT redistribute today's work ─────
    const shiftRes = await setMemberShift(
      s2.id,
      { workDate: "2026-06-20", working: false }, // a day off next week
      null,
      now,
    );
    assert.equal(shiftRes.redistribution, null, "6: future-dated day-off does not touch today's queue");
    assert.equal(await ownerOf(caseCovered.id), s2.id, "6: covered case still owned after future shift change");

    console.log("phase3WorkforceDb: all real-DB workforce/shift/redistribution checks passed.");
  } finally {
    try {
      // Workforce audit events (no case/screening id — keyed by schedulerId).
      if (schedulerIds.length) {
        await db.execute(
          sql`DELETE FROM patient_journey_events WHERE event_source = 'workforce_availability' AND (metadata->>'schedulerId')::int IN (${sql.join(schedulerIds, sql`, `)})`,
        );
      }
      if (caseIds.length) {
        await db.execute(sql`DELETE FROM needs_coverage WHERE execution_case_id IN (${sql.join(caseIds, sql`, `)})`).catch(() => {});
        await db.delete(patientJourneyEvents).where(inArray(patientJourneyEvents.executionCaseId, caseIds));
      }
      if (scrIds.length) await db.delete(patientJourneyEvents).where(inArray(patientJourneyEvents.patientScreeningId, scrIds));
      if (caseIds.length) await db.delete(patientExecutionCases).where(inArray(patientExecutionCases.id, caseIds));
      if (scrIds.length) await db.delete(patientScreenings).where(inArray(patientScreenings.id, scrIds));
      if (batchId != null) await db.delete(screeningBatches).where(eq(screeningBatches.id, batchId));
      if (schedulerIds.length) {
        await db.delete(teamMemberShifts).where(inArray(teamMemberShifts.schedulerId, schedulerIds));
        await db.delete(engagementCallSettings).where(inArray(engagementCallSettings.schedulerId, schedulerIds));
        await db.delete(outreachSchedulers).where(inArray(outreachSchedulers.id, schedulerIds));
      }
      if (clinicIds.length) await db.delete(clinics).where(inArray(clinics.id, clinicIds));
    } catch (cleanupErr) {
      console.error("phase3WorkforceDb cleanup warning:", (cleanupErr as Error).message);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
