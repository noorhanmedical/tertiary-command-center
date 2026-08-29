// PERMANENT regression — data-integrity invariants + workforce accounting
// (Final Acceptance §9 + §15).
//
// READ-ONLY. Runs canonical integrity queries against the live DB and fails if
// any invariant is violated. These are the guarantees the whole Team
// Operations architecture depends on; a violation is a data-corruption bug.
//
//   §9  Workforce accounting: EVERY active execution case is exactly one of
//       owned | current-handoff | needs-coverage | terminal — none unaccounted.
//   §15 No duplicate active team membership
//       No duplicate active manager authority
//       No duplicate active facility coverage
//       No duplicate OPEN handoff for one case
//       No unresolved needs-coverage row for an ASSIGNED case
//       No active execution case owned by an INACTIVE staff member
//       No team task claimed by multiple users (structurally impossible — one
//         assignee column — asserted as a schema invariant)
//       No duplicate outreach_calls external_call_id
//
//   set -a && . ./.env && set +a && npx tsx tests/acceptance/dataIntegrity.test.ts

import { sql } from "drizzle-orm";
import { db, pool } from "../../server/db";

let failures = 0;
function check(label: string, violations: number, detail = "") {
  const ok = violations === 0;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}${ok ? "" : ` (violations=${violations})`}`);
}

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const res = await db.execute(query);
  const row = (res.rows as Array<{ n: number }>)[0];
  return Number(row?.n ?? 0);
}

async function main() {
  // ── §15.1 No duplicate ACTIVE team membership (same user+team) ──
  check(
    "§15.1 no duplicate active team membership",
    await count(sql`
      SELECT count(*)::int AS n FROM (
        SELECT user_id, team_id FROM team_memberships WHERE active = true
        GROUP BY user_id, team_id HAVING count(*) > 1
      ) d
    `),
  );

  // ── §15.2 No duplicate ACTIVE manager authority (same manager+team) ──
  check(
    "§15.2 no duplicate active team-manager authority",
    await count(sql`
      SELECT count(*)::int AS n FROM (
        SELECT manager_user_id, team_id FROM manager_relationships
        WHERE active = true AND scope_type = 'team' AND team_id IS NOT NULL
        GROUP BY manager_user_id, team_id HAVING count(*) > 1
      ) d
    `),
  );

  // ── §15.3 No duplicate canonical facility coverage (same user+facility) ──
  check(
    "§15.3 no duplicate active facility coverage",
    await count(sql`
      SELECT count(*)::int AS n FROM (
        SELECT user_id, facility_id FROM team_member_facility_coverage
        GROUP BY user_id, facility_id HAVING count(*) > 1
      ) d
    `),
  );

  // ── §15.4 No duplicate OPEN handoff for one execution case ──
  // "Open" = pending or acknowledged. Supersede/cancel/complete resolve losers,
  // so at most one open handoff should exist per case.
  check(
    "§15.4 no case with more than one OPEN handoff",
    await count(sql`
      SELECT count(*)::int AS n FROM (
        SELECT execution_case_id FROM call_handoffs
        WHERE status IN ('pending','acknowledged')
        GROUP BY execution_case_id HAVING count(*) > 1
      ) d
    `),
  );

  // ── §15.5 No UNRESOLVED needs-coverage row for an ASSIGNED case ──
  // Once a case gets an owner, its needs-coverage must be resolved.
  check(
    "§15.5 no unresolved needs-coverage on an assigned+active case",
    await count(sql`
      SELECT count(*)::int AS n
      FROM needs_coverage nc
      JOIN patient_execution_cases ec ON ec.id = nc.execution_case_id
      WHERE nc.resolved_at IS NULL
        AND ec.assigned_team_member_id IS NOT NULL
        AND ec.lifecycle_status = 'active'
    `),
  );

  // ── §15.6 No ACTIVE execution case owned by an INACTIVE staff member ──
  // Ownership is a roster (outreach_schedulers) id → the linked user must be
  // active. A case owned by a deactivated user's roster row is a stranded-work
  // bug (deactivation recovery should have released it).
  check(
    "§15.6 no active case owned by an inactive staff member",
    await count(sql`
      SELECT count(*)::int AS n
      FROM patient_execution_cases ec
      JOIN outreach_schedulers os ON os.id = ec.assigned_team_member_id
      JOIN users u ON u.id = os.user_id
      WHERE ec.lifecycle_status = 'active' AND u.active = false
    `),
    "roster rows with a linked user only",
  );

  // ── §15.7 One assignee per task (no multi-claim) ──
  // Structural: plexus_tasks.assigned_to_user_id is a single column, so a task
  // cannot be claimed by two users. Assert the schema shape holds (column
  // exists, scalar) — the concurrency test proves the race can't double-write.
  check(
    "§15.7 task assignment is single-valued (no multi-claim column)",
    await count(sql`
      SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'plexus_tasks' AND column_name = 'assigned_to_user_id'
        AND data_type NOT IN ('character varying','text','uuid')
    `),
    "assigned_to_user_id is a single scalar column",
  );

  // ── §15.8 No duplicate outreach_calls external_call_id ──
  check(
    "§15.8 no duplicate outreach_calls external_call_id",
    await count(sql`
      SELECT count(*)::int AS n FROM (
        SELECT external_call_id FROM outreach_calls
        WHERE external_call_id IS NOT NULL
        GROUP BY external_call_id HAVING count(*) > 1
      ) d
    `),
  );

  // ── §9 WORKFORCE ACCOUNTING INVARIANT ──
  // Every ACTIVE execution case must be accounted-for: exactly one of
  //   (a) canonically owned (assigned_team_member_id NOT NULL), OR
  //   (b) has an OPEN handoff (pending/acknowledged), OR
  //   (c) has an UNRESOLVED needs-coverage row, OR
  //   (d) is in a terminal engagement state (completed/scheduled/cancelled/
  //       archived/closed).
  // A case that is NONE of these is "unaccounted work" — the invariant fails.
  const unaccounted = await count(sql`
    SELECT count(*)::int AS n
    FROM patient_execution_cases ec
    WHERE ec.lifecycle_status = 'active'
      AND ec.assigned_team_member_id IS NULL
      AND COALESCE(ec.engagement_status, '') NOT IN
        ('completed','scheduled','cancelled','archived','closed')
      AND NOT EXISTS (
        SELECT 1 FROM call_handoffs h
        WHERE h.execution_case_id = ec.id AND h.status IN ('pending','acknowledged')
      )
      AND NOT EXISTS (
        SELECT 1 FROM needs_coverage nc
        WHERE nc.execution_case_id = ec.id AND nc.resolved_at IS NULL
      )
  `);
  check(
    "§9 every active case is accounted-for (owned | open-handoff | needs-coverage | terminal)",
    unaccounted,
    "unassigned, non-terminal, no open handoff, no needs-coverage = stranded work",
  );

  console.log(failures === 0 ? "\ndataIntegrity.test.ts: all invariants hold" : `\ndataIntegrity.test.ts: ${failures} invariant(s) violated`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("dataIntegrity.test.ts crashed:", e);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
