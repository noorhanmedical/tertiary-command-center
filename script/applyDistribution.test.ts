/**
 * Integration test for the Engagement Distribution ATOMIC write path
 * (`applyDistribution`).
 *
 * The pure allocator (`buildDistributionPlan`) is already covered by
 * `script/checkDistribution.ts`. This test instead exercises the real
 * commit-time write path — the transaction + per-case SELECT…FOR UPDATE row
 * lock + re-validation (still-unassigned / still-active) + the duplicate
 * guard — and proves it NEVER double-assigns a case, even under concurrent
 * "apply" calls racing for the same pool.
 *
 *   Run:  npx tsx script/applyDistribution.test.ts
 *
 * Requires DATABASE_URL. Exits non-zero on any failed assertion so it can
 * gate CI later (same convention as checkDistribution.ts).
 *
 * Isolation: applyDistribution normally gathers the GLOBAL eligible-case pool
 * and the GLOBAL roster. To avoid mutating real data, the test uses the
 * `ApplyDistributionDeps` seam to feed a SCOPED gather (only this test's seeded
 * case ids) plus in-memory members. The write/lock/re-validation logic under
 * test runs completely unchanged against real, freshly-seeded DB rows. Every
 * seeded row is tagged with a sentinel name prefix and deleted at start (for
 * idempotency) and end (cleanup).
 *
 * Scenarios:
 *   1. Single apply  — all cases assigned to exactly one member, 0 skipped,
 *      exactly one journey event per case, member loads within capacity.
 *   2. Concurrency   — N parallel applies on the same pool: every case is
 *      assigned exactly once (one journey event each), no case lands in two
 *      runs' "applied" lists, and the union covers the whole pool.
 *   3. Contention    — a case assigned by another actor BETWEEN gather and the
 *      apply-lock is skipped (re-validation), never overwritten.
 */
import { and, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { patientExecutionCases, patientJourneyEvents } from "@shared/schema";
import {
  applyDistribution,
  type ApplyDistributionDeps,
  type DistributionMemberInput,
} from "../server/services/engagement/distributionService";

const PREFIX = "ZZTESTDIST_";
const MEMBER_A = 990001;
const MEMBER_B = 990002;
const CLAIM_ID = 999999; // sentinel "other actor" — not one of our members
const POOL_SIZE = 12;

let failures = 0;
function check(label: string, cond: boolean): void {
  if (!cond) {
    failures += 1;
    console.error(`  ✗ ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  check(
    `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
    JSON.stringify(actual) === JSON.stringify(expected),
  );
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Two equal members; outreach-only pool so only the outreach lane binds.
// Combined remainingCapacity (20) comfortably exceeds the pool (12) so the
// allocator can place every case — the point of the test is the WRITE path,
// not capacity exhaustion (that is covered in checkDistribution.ts).
const members: DistributionMemberInput[] = [
  {
    schedulerId: MEMBER_A,
    name: "TM-A",
    facility: null,
    active: true,
    workingToday: true,
    facilitiesCovered: null,
    remainingCapacity: 10,
    visitTarget: 0,
    outreachTarget: 10,
  },
  {
    schedulerId: MEMBER_B,
    name: "TM-B",
    facility: null,
    active: true,
    workingToday: true,
    facilitiesCovered: null,
    remainingCapacity: 10,
    visitTarget: 0,
    outreachTarget: 10,
  },
];

let caseIds: number[] = [];

// Scoped gather: mirrors gatherEligibleCases' eligibility predicate but limited
// to this test's seeded ids, with no facility/scheduleDate (so the sibling
// guard is exempt and cannot interact with any other data in the DB).
const gatherCases: NonNullable<ApplyDistributionDeps["gatherCases"]> = async (
  exec,
) => {
  const rows = await exec
    .select()
    .from(patientExecutionCases)
    .where(
      and(
        inArray(patientExecutionCases.id, caseIds),
        isNull(patientExecutionCases.assignedTeamMemberId),
        or(
          isNull(patientExecutionCases.lifecycleStatus),
          eq(patientExecutionCases.lifecycleStatus, "active"),
        ),
        or(
          isNull(patientExecutionCases.engagementStatus),
          sql`${patientExecutionCases.engagementStatus} NOT IN ('archived','closed','cancelled','completed')`,
        ),
      ),
    );
  return rows.map((c) => ({
    executionCaseId: c.id,
    patientScreeningId: c.patientScreeningId ?? null,
    patientName: c.patientName,
    patientDob: c.patientDob ?? null,
    facility: null,
    scheduleDate: null,
    engagementBucket: c.engagementBucket ?? null,
  }));
};

const deps: ApplyDistributionDeps = {
  gatherCases,
  gatherMembers: async () => members,
};

async function cleanup(): Promise<void> {
  await db
    .delete(patientJourneyEvents)
    .where(like(patientJourneyEvents.patientName, `${PREFIX}%`));
  await db
    .delete(patientExecutionCases)
    .where(like(patientExecutionCases.patientName, `${PREFIX}%`));
}

async function seedCases(): Promise<void> {
  const values = Array.from({ length: POOL_SIZE }, (_, i) => ({
    patientName: `${PREFIX}case_${i + 1}`,
    source: "system_generated",
    engagementBucket: "outreach",
    lifecycleStatus: "active",
    engagementStatus: "new",
  }));
  const inserted = await db
    .insert(patientExecutionCases)
    .values(values)
    .returning({ id: patientExecutionCases.id });
  caseIds = inserted.map((r) => r.id);
}

// Reset the seeded cases to a clean unassigned/new state and wipe any journey
// events from a prior scenario so each scenario starts from the same baseline.
async function resetCases(): Promise<void> {
  await db
    .update(patientExecutionCases)
    .set({
      assignedTeamMemberId: null,
      assignedRole: null,
      engagementStatus: "new",
      nextActionAt: null,
    })
    .where(inArray(patientExecutionCases.id, caseIds));
  await db
    .delete(patientJourneyEvents)
    .where(inArray(patientJourneyEvents.executionCaseId, caseIds));
}

async function dbRows() {
  return db
    .select()
    .from(patientExecutionCases)
    .where(inArray(patientExecutionCases.id, caseIds));
}

async function assignmentEventCountByCase(): Promise<Map<number, number>> {
  const evs = await db
    .select()
    .from(patientJourneyEvents)
    .where(
      and(
        inArray(patientJourneyEvents.executionCaseId, caseIds),
        eq(patientJourneyEvents.eventType, "engagement_assignment_changed"),
      ),
    );
  const counts = new Map<number, number>();
  for (const e of evs) {
    if (e.executionCaseId == null) continue;
    counts.set(e.executionCaseId, (counts.get(e.executionCaseId) ?? 0) + 1);
  }
  return counts;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[test:apply-distribution] DATABASE_URL is not set");
    process.exit(1);
  }

  await cleanup(); // idempotent start
  await seedCases();

  // ─── Scenario 1: single apply assigns every case exactly once ─────────────
  console.log("\nScenario 1 · single apply");
  {
    const res = await applyDistribution(null, "scheduler", deps);
    assertEqual("1 · proposed == pool", res.summary.proposed, POOL_SIZE);
    assertEqual("1 · applied == pool", res.summary.applied, POOL_SIZE);
    assertEqual("1 · nothing skipped", res.summary.skipped, 0);

    const rows = await dbRows();
    check(
      "1 · every case has exactly one assigned member",
      rows.length === POOL_SIZE &&
        rows.every(
          (r) =>
            r.assignedTeamMemberId === MEMBER_A ||
            r.assignedTeamMemberId === MEMBER_B,
        ),
    );
    const counts = await assignmentEventCountByCase();
    check(
      "1 · exactly one assignment journey event per case",
      counts.size === POOL_SIZE &&
        [...counts.values()].every((n) => n === 1),
    );
    const loadA = rows.filter((r) => r.assignedTeamMemberId === MEMBER_A).length;
    const loadB = rows.filter((r) => r.assignedTeamMemberId === MEMBER_B).length;
    check("1 · loads within capacity", loadA <= 10 && loadB <= 10);
    check(
      "1 · least-loaded spread is balanced (6/6)",
      loadA === 6 && loadB === 6,
    );
  }

  // ─── Scenario 2: concurrent applies never double-assign ───────────────────
  console.log("\nScenario 2 · concurrent applies (no double-assign under load)");
  {
    await resetCases();
    const CONCURRENCY = 4;
    const runs = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        applyDistribution(null, "scheduler", deps),
      ),
    );

    const rows = await dbRows();
    check(
      "2 · every case ends assigned to one of our members",
      rows.length === POOL_SIZE &&
        rows.every(
          (r) =>
            r.assignedTeamMemberId === MEMBER_A ||
            r.assignedTeamMemberId === MEMBER_B,
        ),
    );

    // The strongest no-double-assign proof: each case produced exactly ONE
    // assignment event across ALL racing runs.
    const counts = await assignmentEventCountByCase();
    check(
      "2 · exactly one assignment journey event per case (no double-assign)",
      counts.size === POOL_SIZE &&
        [...counts.values()].every((n) => n === 1),
    );

    // No case appears in more than one run's `applied` list.
    const appliedSeen = new Map<number, number>();
    for (const run of runs) {
      for (const a of run.applied) {
        appliedSeen.set(
          a.executionCaseId,
          (appliedSeen.get(a.executionCaseId) ?? 0) + 1,
        );
      }
    }
    check(
      "2 · no case applied by more than one concurrent run",
      [...appliedSeen.values()].every((n) => n === 1),
    );
    assertEqual(
      "2 · union of applied == pool",
      appliedSeen.size,
      POOL_SIZE,
    );
    const totalApplied = runs.reduce((s, r) => s + r.summary.applied, 0);
    assertEqual("2 · total applied across runs == pool", totalApplied, POOL_SIZE);
  }

  // ─── Scenario 3: case claimed between gather and lock is skipped ──────────
  console.log("\nScenario 3 · contention (skipped, never overwritten)");
  {
    await resetCases();
    const client = await pool.connect();
    let res;
    try {
      // Lock all seeded rows in a separate transaction. applyDistribution's
      // gather (a plain SELECT) still sees them as unassigned and plans them,
      // but its per-case SELECT…FOR UPDATE will BLOCK behind this lock.
      await client.query("BEGIN");
      await client.query(
        "SELECT id FROM patient_execution_cases WHERE id = ANY($1::int[]) FOR UPDATE",
        [caseIds],
      );

      const applyPromise = applyDistribution(null, "scheduler", deps);
      // Give apply time to gather + reach (and block on) its first FOR UPDATE.
      await sleep(800);

      // Simulate another actor claiming every case, then commit & release.
      await client.query(
        "UPDATE patient_execution_cases SET assigned_team_member_id = $1, updated_at = now() WHERE id = ANY($2::int[])",
        [CLAIM_ID, caseIds],
      );
      await client.query("COMMIT");

      res = await applyPromise;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }

    assertEqual("3 · nothing applied", res.summary.applied, 0);
    assertEqual("3 · all proposed were skipped", res.summary.skipped, POOL_SIZE);
    check(
      "3 · skip reason cites prior assignment by someone else",
      res.skipped.length === POOL_SIZE &&
        res.skipped.every((s) => /assigned by someone else/i.test(s.reason)),
    );

    const rows = await dbRows();
    check(
      "3 · prior assignment preserved, never overwritten",
      rows.length === POOL_SIZE &&
        rows.every((r) => r.assignedTeamMemberId === CLAIM_ID),
    );
    const counts = await assignmentEventCountByCase();
    check(
      "3 · no assignment journey events written by the skipped apply",
      counts.size === 0,
    );
  }

  await cleanup();

  console.log("");
  if (failures > 0) {
    console.error(`${failures} assertion(s) FAILED`);
    await pool.end();
    process.exit(1);
  }
  console.log("All applyDistribution write-path assertions passed.");
  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("[test:apply-distribution] unexpected error:", err);
  try {
    await cleanup();
  } catch {
    /* ignore */
  }
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
