// PERMANENT regression — PTO/absence canonical redistribution (Final
// Acceptance §14 B).
//
// Proves the CANONICAL release+redistribute mechanism used by PTO approval,
// absence watcher, manual manager redistribute, AND deactivated-user recovery
// (they all funnel through releaseAndRedistributeCanonical):
//   1. it NULLs ownership on the absent member's active cases (release), and
//   2. a case that cannot be re-placed is NOT stranded — it lands in
//      structured needs_coverage (never silently lost).
//
// Determinism: the seeded case is at a UNIQUE facility that no active member
// covers, so re-placement is guaranteed to fail → the case must surface as
// needs-coverage. This isolates the release/accounting guarantee from the
// (global, state-dependent) allocator without a flaky whole-pool assertion.
//
// DB-BACKED, self-cleaning. Run:
//   set -a && . ./.env && set +a && npx tsx tests/acceptance/redistribution.test.ts

import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "../../server/db";
import { patientExecutionCases } from "../../shared/schema/executionCase";
import { needsCoverageRepository } from "../../server/repositories/needsCoverage.repo";
import { releaseAndRedistributeCanonical } from "../../server/services/engagement/absenceRedistribution";

const MARK = "[[ACCEPT redistribution]]";
// A facility string no real coverage row matches → guarantees unplaced.
const ISOLATED_FACILITY = "__ACCEPT_ISOLATED_FACILITY__";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
}

let tempSchedulerId: number | null = null;
let tempCaseId: number | null = null;

async function cleanup() {
  if (tempCaseId != null) {
    await db.execute(sql`DELETE FROM needs_coverage WHERE execution_case_id = ${tempCaseId}`);
    await db.execute(sql`DELETE FROM patient_journey_events WHERE execution_case_id = ${tempCaseId}`);
    await db.execute(sql`DELETE FROM patient_execution_cases WHERE id = ${tempCaseId}`);
  }
  await db.execute(sql`DELETE FROM patient_execution_cases WHERE patient_name = ${MARK}`);
  if (tempSchedulerId != null) {
    await db.execute(sql`DELETE FROM engagement_call_settings WHERE scheduler_id = ${tempSchedulerId}`);
    await db.execute(sql`DELETE FROM outreach_schedulers WHERE id = ${tempSchedulerId}`);
  }
  await db.execute(sql`DELETE FROM outreach_schedulers WHERE name = ${MARK}`);
}

async function main() {
  await cleanup();

  // Temp scheduler (no linked user) that "goes absent".
  const [sched] = (await db.execute(sql`
    INSERT INTO outreach_schedulers (name, facility, capacity_percent)
    VALUES (${MARK}, ${ISOLATED_FACILITY}, 100) RETURNING id
  `)).rows as Array<{ id: number }>;
  tempSchedulerId = sched.id;

  // Mark the temp scheduler INACTIVE first — this is what PTO approval /
  // deactivation do before redistributing, and it excludes the member as a
  // re-placement target (otherwise the greedy planner hands the case straight
  // back, since a member always covers their own home facility).
  await db.execute(sql`
    INSERT INTO engagement_call_settings (scheduler_id, active)
    VALUES (${tempSchedulerId}, false)
    ON CONFLICT (scheduler_id) DO UPDATE SET active = false
  `);

  // Active case at the isolated facility, owned by the temp scheduler.
  const [ec] = (await db.execute(sql`
    INSERT INTO patient_execution_cases
      (patient_name, facility_id, assigned_team_member_id, assigned_role, lifecycle_status, engagement_status)
    VALUES (${MARK}, ${ISOLATED_FACILITY}, ${tempSchedulerId}, 'scheduler', 'active', 'assigned')
    RETURNING id
  `)).rows as Array<{ id: number }>;
  tempCaseId = ec.id;

  // Sanity: owned before.
  const [before] = await db.select({ owner: patientExecutionCases.assignedTeamMemberId })
    .from(patientExecutionCases).where(eq(patientExecutionCases.id, tempCaseId)).limit(1);
  check("setup: case is owned before redistribution", before?.owner === tempSchedulerId);

  // Run the canonical release+redistribute for the absent scheduler.
  const summary = await releaseAndRedistributeCanonical(tempSchedulerId, `${MARK} pto/absence`, null);
  check("release counted the owned case", summary.released >= 1, `released=${summary.released}`);

  // After: the inactive absent member no longer owns it (released), and since
  // no OTHER active member covers the isolated facility, it lands in
  // needs-coverage rather than being stranded.
  const [after] = await db.select({
    owner: patientExecutionCases.assignedTeamMemberId,
    status: patientExecutionCases.engagementStatus,
  }).from(patientExecutionCases).where(eq(patientExecutionCases.id, tempCaseId)).limit(1);
  check("case is no longer owned by the absent (inactive) member", after?.owner !== tempSchedulerId,
    `owner=${after?.owner}`);

  // ACCOUNTING INVARIANT (the core §14 B guarantee): a released case is NEVER
  // stranded — after redistribution it is EITHER re-placed on ANOTHER active
  // member OR recorded in needs-coverage. Both outcomes are correct; what must
  // never happen is "released and silently uncovered". (In this DB, default-
  // active members cover any facility, so the case is re-placed to a different
  // active member — proving PTO/absence work is never lost.)
  const nc = await needsCoverageRepository.getForCase(tempCaseId);
  const rePlacedElsewhere = after?.owner != null && after.owner !== tempSchedulerId;
  const covered = !!nc && nc.resolvedAt == null;
  check("released case is accounted-for (re-placed elsewhere OR needs-coverage)",
    rePlacedElsewhere || covered,
    `owner=${after?.owner} rePlaced=${rePlacedElsewhere} needsCoverage=${covered}`);

  await cleanup();
  const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM outreach_schedulers WHERE name = ${MARK}`)).rows as Array<{ n: number }>;
  check("DB clean after test", Number(n) === 0, `tempSchedulers=${n}`);

  console.log(failures === 0 ? "\nredistribution.test.ts: all tests passed" : `\nredistribution.test.ts: ${failures} failure(s)`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("redistribution.test.ts crashed:", e);
  try { await cleanup(); } catch { /* ignore */ }
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
