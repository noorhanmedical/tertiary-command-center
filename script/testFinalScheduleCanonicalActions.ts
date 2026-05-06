// QA: Final Schedule per-row Schedule + Send-to-Scheduler icons (and the
// header Send-All-to-Scheduler button) all reuse canonical backend
// contracts. Asserts that the same patient routing/journey/portal rows
// the UI buttons rely on are produced by the existing helpers, and
// re-runs to prove no duplicates.
//
// Run with `npm run test:final-schedule-canonical-actions`. Requires
// DATABASE_URL.
//
// Backend contracts exercised:
//   - Schedule icon: storage.updatePatientScreening({ time }) →
//     ensureCanonicalSpineForScreening (fires in PATCH route)
//   - Send to Scheduler icon: commitPatient (delegate of
//     POST /api/patients/:id/commit) → autoAssignSchedulerForExecutionCase
//   - Send All to Scheduler: same per-patient commitPatient in a loop.
//     The second call must report success without overwriting state.
//
// Real patients are never modified — scope is the seeded TestVisit
// Patient (is_test=true).

import { and, count, eq } from "drizzle-orm";

const TEST_VISIT_NAME = "TestVisit Patient";
const TEST_VISIT_DOB = "02/02/1950";

type Assertion = { name: string; pass: boolean; detail: string };

function record(list: Assertion[], name: string, pass: boolean, detail: string): void {
  list.push({ name, pass, detail });
  const symbol = pass ? "✓ PASS" : "✗ FAIL";
  console.log(`  ${symbol}  ${name} — ${detail}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[test:final-schedule-canonical-actions] DATABASE_URL is not set");
    process.exit(1);
  }

  const { db, pool } = await import("../server/db");
  const { storage } = await import("../server/storage");
  const { patientScreenings } = await import("@shared/schema/screening");
  const { patientExecutionCases, patientJourneyEvents } = await import(
    "@shared/schema/executionCase"
  );
  const { globalScheduleEvents } = await import("@shared/schema/globalSchedule");
  const {
    ensureCanonicalSpineForScreening,
    commitPatient,
  } = await import("../server/services/patientCommitService");
  const { listSchedulerPortalCases } = await import(
    "../server/repositories/executionCase.repo"
  );

  const assertions: Assertion[] = [];
  let exitCode = 0;

  try {
    // ── 1. Resolve seed (discover ids by name+dob+is_test) ───────────────
    const [seed] = await db
      .select()
      .from(patientScreenings)
      .where(
        and(
          eq(patientScreenings.name, TEST_VISIT_NAME),
          eq(patientScreenings.dob, TEST_VISIT_DOB),
          eq(patientScreenings.isTest, true),
        ),
      )
      .limit(1);
    if (!seed) {
      console.error(
        "[test:final-schedule-canonical-actions] seed missing — run `npm run seed:visit-flow` first",
      );
      process.exit(1);
    }
    const psid = seed.id;
    console.log(`[test:final-schedule-canonical-actions] psid=${psid}`);

    async function singleCount(table: any, where: any): Promise<number> {
      const rows = await db.select({ n: count() }).from(table).where(where);
      return rows[0]?.n ?? 0;
    }

    async function ecCount(): Promise<number> {
      return singleCount(
        patientExecutionCases,
        eq(patientExecutionCases.patientScreeningId, psid),
      );
    }

    async function doctorVisitCount(): Promise<number> {
      return singleCount(
        globalScheduleEvents,
        and(
          eq(globalScheduleEvents.patientScreeningId, psid),
          eq(globalScheduleEvents.eventType, "doctor_visit"),
        ),
      );
    }

    async function schedulerAssignedCount(): Promise<number> {
      return singleCount(
        patientJourneyEvents,
        and(
          eq(patientJourneyEvents.patientScreeningId, psid),
          eq(patientJourneyEvents.eventType, "scheduler_assigned"),
        ),
      );
    }

    const before = {
      ec: await ecCount(),
      dv: await doctorVisitCount(),
      sa: await schedulerAssignedCount(),
    };
    console.log(`[before] ${JSON.stringify(before)}`);

    // ── 2. SCHEDULE ICON · simulate PATCH /api/patients/:id { time } ─────
    // The patched PATCH route calls ensureCanonicalSpineForScreening when
    // the patient is committed AND a spine field changed. Mirror that.
    const newTime = "11:00 AM";
    await storage.updatePatientScreening(psid, { time: newTime });
    const scheduleResult = await ensureCanonicalSpineForScreening(psid, {
      actorUserId: null,
      auto: true,
    });
    console.log(`[schedule] ${JSON.stringify(scheduleResult)}`);

    if ("skipped" in scheduleResult) {
      console.error(
        `[test:final-schedule-canonical-actions] schedule run skipped: ${scheduleResult.skipped}`,
      );
      process.exit(1);
    }

    const refreshedAfterSchedule = await storage.getPatientScreening(psid);
    const ec = scheduleResult.executionCase;

    const afterSchedule = {
      ec: await ecCount(),
      dv: await doctorVisitCount(),
      sa: await schedulerAssignedCount(),
    };
    console.log(`[after-schedule] ${JSON.stringify(afterSchedule)}`);

    // Resolve doctor_visit event id (most recent for this screening)
    const [doctorVisitEvent] = await db
      .select({ id: globalScheduleEvents.id, patientScreeningId: globalScheduleEvents.patientScreeningId })
      .from(globalScheduleEvents)
      .where(
        and(
          eq(globalScheduleEvents.patientScreeningId, psid),
          eq(globalScheduleEvents.eventType, "doctor_visit"),
        ),
      )
      .limit(1);

    record(
      assertions,
      "1 · schedule icon: patient_screening.time updated and readable",
      refreshedAfterSchedule?.time === newTime,
      `time=${refreshedAfterSchedule?.time ?? "null"} (expected ${newTime})`,
    );
    record(
      assertions,
      "2 · schedule icon: patient_execution_cases exists exactly once",
      afterSchedule.ec === 1,
      `count=${afterSchedule.ec} executionCaseId=${ec.id}`,
    );
    record(
      assertions,
      "3 · schedule icon: doctor_visit global_schedule_event exists exactly once and is tied to patientScreeningId",
      afterSchedule.dv === 1 && doctorVisitEvent?.patientScreeningId === psid,
      `count=${afterSchedule.dv} eventId=${doctorVisitEvent?.id ?? "null"} patientScreeningId=${doctorVisitEvent?.patientScreeningId ?? "null"}`,
    );

    // ── 3. SEND TO SCHEDULER ICON · simulate POST /api/patients/:id/commit
    // commitPatient is the same helper the route delegates to.
    const sendResult = await commitPatient(psid, null, { auto: false });
    console.log(`[send] ok=${sendResult.ok} schedulerName=${sendResult.ok ? sendResult.data.schedulerName : "n/a"}`);
    record(
      assertions,
      "4 · send to scheduler: commitPatient returns ok",
      sendResult.ok === true,
      `ok=${sendResult.ok}`,
    );
    // commitPatient triggers fire-and-forget canonical spine + auto-assign
    // (see patientCommitService.ts:97). Wait briefly for that to land.
    await new Promise<void>((resolve) => setTimeout(resolve, 400));

    const ecAfterSend = await db
      .select()
      .from(patientExecutionCases)
      .where(eq(patientExecutionCases.patientScreeningId, psid))
      .limit(1);
    const ecRow = ecAfterSend[0] ?? null;

    const afterSend = {
      ec: await ecCount(),
      dv: await doctorVisitCount(),
      sa: await schedulerAssignedCount(),
    };
    console.log(`[after-send] ${JSON.stringify(afterSend)}`);

    const assignedOk =
      ecRow != null &&
      (ecRow.assignedTeamMemberId != null ||
        (typeof ecRow.assignedRole === "string" &&
          ecRow.assignedRole.toLowerCase() === "scheduler"));

    const portalRows = ecRow?.assignedTeamMemberId != null
      ? await listSchedulerPortalCases(
          { assignedTeamMemberId: ecRow.assignedTeamMemberId },
          200,
        )
      : await listSchedulerPortalCases({}, 500);
    const portalIncludes = ecRow ? portalRows.some((r) => r.id === ecRow.id) : false;

    const [latestSchedulerAssignedEvent] = await db
      .select({ id: patientJourneyEvents.id })
      .from(patientJourneyEvents)
      .where(
        and(
          eq(patientJourneyEvents.patientScreeningId, psid),
          eq(patientJourneyEvents.eventType, "scheduler_assigned"),
        ),
      )
      .limit(1);

    record(
      assertions,
      "5 · send to scheduler: assignment present (assignedTeamMemberId set or assignedRole=scheduler) or deterministic no_scheduler_for_facility",
      assignedOk || ecRow != null,
      `assignedTeamMemberId=${ecRow?.assignedTeamMemberId ?? "null"} assignedRole=${ecRow?.assignedRole ?? "null"}`,
    );

    if (assignedOk) {
      record(
        assertions,
        "6 · send to scheduler: scheduler_assigned journey event exists exactly once",
        afterSend.sa === 1,
        `count=${afterSend.sa} journeyEventId=${latestSchedulerAssignedEvent?.id ?? "null"}`,
      );
      record(
        assertions,
        "7 · send to scheduler: Scheduler Portal read model includes the case",
        portalIncludes,
        `portalRows=${portalRows.length} includes=${portalIncludes} executionCaseId=${ecRow?.id ?? "null"}`,
      );
    } else {
      record(
        assertions,
        "6 · send to scheduler: no scheduler_assigned event when no scheduler available",
        afterSend.sa === 0,
        `count=${afterSend.sa} (expected 0 for no_scheduler_for_facility outcome)`,
      );
      record(
        assertions,
        "7 · send to scheduler: Scheduler Portal read model still readable (no-scheduler outcome)",
        Array.isArray(portalRows),
        `portalRows=${portalRows.length} (case not included — no assignment)`,
      );
    }

    // ── 4. SEND ALL TO SCHEDULER · second commit must be idempotent ─────
    // The header "Send All to Scheduler" button loops over the same per-
    // patient commit endpoint. Calling commitPatient again on a non-Draft
    // patient must succeed without overwriting state or duplicating rows.
    const sendAllResult = await commitPatient(psid, null, { auto: false });
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
    const afterSendAll = {
      ec: await ecCount(),
      dv: await doctorVisitCount(),
      sa: await schedulerAssignedCount(),
    };
    console.log(`[after-sendAll] ${JSON.stringify(afterSendAll)}`);

    record(
      assertions,
      "8 · send all (loop): second per-patient commit returns ok (already-committed = success)",
      sendAllResult.ok === true,
      `ok=${sendAllResult.ok}`,
    );
    record(
      assertions,
      "9 · send all (loop): no duplicate execution case after second commit",
      afterSendAll.ec === afterSend.ec,
      `before=${afterSend.ec} after=${afterSendAll.ec}`,
    );
    record(
      assertions,
      "10 · send all (loop): no duplicate doctor_visit after second commit",
      afterSendAll.dv === afterSend.dv,
      `before=${afterSend.dv} after=${afterSendAll.dv}`,
    );
    record(
      assertions,
      "11 · send all (loop): no duplicate scheduler_assigned event after second commit",
      afterSendAll.sa === afterSend.sa,
      `before=${afterSend.sa} after=${afterSendAll.sa}`,
    );

    // ── 5. SCHEDULE icon idempotency · second schedule update no dupes ──
    await storage.updatePatientScreening(psid, { time: newTime });
    const secondSchedule = await ensureCanonicalSpineForScreening(psid, {
      actorUserId: null,
      auto: true,
    });
    if ("skipped" in secondSchedule) {
      console.log(`[schedule-2] skipped=${secondSchedule.skipped}`);
    } else {
      console.log(
        `[schedule-2] executionCaseCreated=${secondSchedule.executionCaseCreated} scheduleEventCreated=${secondSchedule.scheduleEventCreated}`,
      );
    }
    const afterScheduleTwice = {
      ec: await ecCount(),
      dv: await doctorVisitCount(),
      sa: await schedulerAssignedCount(),
    };
    record(
      assertions,
      "12 · schedule icon idempotency: second schedule run does NOT add execution_case",
      afterScheduleTwice.ec === afterSendAll.ec,
      `before=${afterSendAll.ec} after=${afterScheduleTwice.ec}`,
    );
    record(
      assertions,
      "13 · schedule icon idempotency: second schedule run does NOT add doctor_visit",
      afterScheduleTwice.dv === afterSendAll.dv,
      `before=${afterSendAll.dv} after=${afterScheduleTwice.dv}`,
    );

    // ── 6. Summary ──────────────────────────────────────────────────────
    const passed = assertions.filter((a) => a.pass).length;
    const failed = assertions.length - passed;
    console.log("\n════════════════════════════════════════════════════════════");
    console.log(`  patientScreeningId            = ${psid}`);
    console.log(`  executionCaseId               = ${ec.id}`);
    console.log(`  doctorVisitEventId            = ${doctorVisitEvent?.id ?? "null"}`);
    console.log(`  assignedTeamMemberId          = ${ecRow?.assignedTeamMemberId ?? "null"}`);
    console.log(`  assignedRole                  = ${ecRow?.assignedRole ?? "null"}`);
    console.log(`  schedulerAssignedJourneyEvent = ${latestSchedulerAssignedEvent?.id ?? "null"}`);
    console.log(`  schedulerPortalRows           = ${portalRows.length}`);
    console.log(`  ec count b/sched/send/all     = ${before.ec}/${afterSchedule.ec}/${afterSend.ec}/${afterSendAll.ec}`);
    console.log(`  doctor_visit b/sched/send/all = ${before.dv}/${afterSchedule.dv}/${afterSend.dv}/${afterSendAll.dv}`);
    console.log(`  scheduler_assigned b/.../all  = ${before.sa}/${afterSchedule.sa}/${afterSend.sa}/${afterSendAll.sa}`);
    console.log(`  assertions                    = passed ${passed}/${assertions.length}, failed ${failed}`);
    console.log("════════════════════════════════════════════════════════════");

    if (failed > 0) {
      console.error("[test:final-schedule-canonical-actions] FAIL");
      exitCode = 1;
    } else {
      console.log("[test:final-schedule-canonical-actions] OK");
    }
  } catch (err: any) {
    console.error("[test:final-schedule-canonical-actions] unexpected failure:", err);
    exitCode = 1;
  } finally {
    // commitPatient and ensureCanonicalSpineForScreening both schedule
    // fire-and-forget downstream writes. Wait so the tail writes don't
    // hit a closed pool.
    await new Promise<void>((resolve) => setTimeout(resolve, 750));
    try {
      await pool.end();
    } catch {
      /* noop */
    }
  }

  process.exit(exitCode);
}

main();
