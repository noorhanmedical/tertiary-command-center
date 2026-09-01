// PERMANENT regression — workforce recovery + authorization + idempotency
// (Final Acceptance §14 B/I/J/L/M/N).
//
//   I. deactivated-user recovery releases ALL work types (team tasks → pool,
//      personal tasks flagged, inbound handoffs cancelled) + manager notified
//   J. reactivation restores eligibility only — never resurrects cancelled
//      handoffs / closed tasks / prior ownership
//   L. call-result idempotency (external_call_id): one row per attempt
//   M. manager-scope authorization (admin org-wide; scoped manager only sees
//      their team; a plain user has no scope)
//   N. team-message membership authorization (active member only)
//
// DB-BACKED, self-cleaning. Uses e2e fixtures + a TEMPORARY manager
// relationship (removed in cleanup). Run:
//   set -a && . ./.env && set +a && npx tsx tests/acceptance/workforceRecovery.test.ts

import { sql } from "drizzle-orm";
import { db, pool } from "../../server/db";
import { plexusRepository } from "../../server/repositories/plexus.repo";
import { callHandoffsRepository } from "../../server/repositories/callHandoffs.repo";
import { notificationsRepository } from "../../server/repositories/notifications.repo";
import { outreachRepository } from "../../server/repositories/outreach.repo";
import { recoverDeactivatedUser } from "../../server/services/engagement/deactivatedUserRecovery";
import { resolveManagerScope, scopeCoversUser } from "../../server/services/teams/managerScope";
import { isConversationMember } from "../../server/repositories/messaging.repo";

const MARK = "[[ACCEPT workforce]]";
const PCS = "bdd23c42-c56a-4502-9b3c-253e63f59264"; // manager-to-be + subject-of-scope
const ACS = "359e6c50-4ed5-48df-921e-32754cee84dc"; // recovery subject
const ACS_TEAM = 2;

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
}

async function cleanup() {
  await db.execute(sql`DELETE FROM plexus_task_events WHERE task_id IN (SELECT id FROM plexus_tasks WHERE title LIKE ${MARK + "%"})`);
  await db.execute(sql`DELETE FROM plexus_tasks WHERE title LIKE ${MARK + "%"}`);
  await db.execute(sql`DELETE FROM call_handoffs WHERE reason LIKE ${MARK + "%"}`);
  await db.execute(sql`DELETE FROM notifications WHERE recipient_user_id IN (${PCS}, ${ACS})`);
  await db.execute(sql`DELETE FROM outreach_calls WHERE external_call_id LIKE ${MARK + "%"}`);
  await db.execute(sql`DELETE FROM message_conversations WHERE title LIKE ${MARK + "%"}`);
  await db.execute(sql`DELETE FROM manager_relationships WHERE manager_user_id = ${PCS} AND subordinate_user_id = ${ACS} AND scope_type = 'user'`);
}

async function main() {
  await cleanup();

  // ── M. Manager-scope authorization ──
  // Admin sees org-wide.
  const adminScope = await resolveManagerScope(null, "admin");
  check("M: admin scope isAdmin=true", adminScope.isAdmin === true);
  check("M: admin covers any user", scopeCoversUser(adminScope, ACS) === true);
  // A plain staff user (no manager relationship) has no management authority.
  const plainScope = await resolveManagerScope(ACS, "technician");
  check("M: plain user has no team scope", plainScope.teamIds.length === 0 && plainScope.userIds.size === 0);
  check("M: plain user does not cover others", scopeCoversUser(plainScope, PCS) === false);
  // Make PCS a user-scoped manager of ACS → PCS now covers ACS but not others.
  await db.execute(sql`INSERT INTO manager_relationships (manager_user_id, scope_type, subordinate_user_id, active) VALUES (${PCS}, 'user', ${ACS}, true)`);
  const mgrScope = await resolveManagerScope(PCS, "liaison");
  check("M: scoped manager covers their subordinate", scopeCoversUser(mgrScope, ACS) === true);
  check("M: scoped manager does NOT cover an unrelated user", scopeCoversUser(mgrScope, "00000000-0000-0000-0000-000000000000") === false);

  // ── L. Call-result idempotency (external_call_id) ──
  // The route's retry guard is: findCallByExternalId(id) → if present, return
  // the existing row instead of inserting. The DB also enforces this with a
  // partial unique index (uq_outreach_calls_external_call_id). We prove BOTH:
  // the lookup resolves the row, and a duplicate insert with the same external
  // id is rejected by the constraint (one row per attempt).
  const extId = `${MARK} ext-1`;
  let didL = false;
  const [screening] = (await db.execute(sql`SELECT id FROM patient_screenings LIMIT 1`)).rows as Array<{ id: number }>;
  if (screening) {
    const first = await outreachRepository.createCall({
      patientScreeningId: screening.id,
      externalCallId: extId,
      outcome: "callback",
    } as never);
    const found = await outreachRepository.findCallByExternalId(extId);
    check("L: created call retrievable by external_call_id", !!found && found.id === first.id);
    // A duplicate insert with the SAME external id must be blocked by the
    // partial unique index — so a retry can never create a second row.
    let dupBlocked = false;
    try {
      await outreachRepository.createCall({
        patientScreeningId: screening.id,
        externalCallId: extId,
        outcome: "callback",
      } as never);
    } catch {
      dupBlocked = true;
    }
    check("L: duplicate external_call_id insert is blocked by the unique index", dupBlocked);
    const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM outreach_calls WHERE external_call_id = ${extId}`)).rows as Array<{ n: number }>;
    check("L: exactly one outreach_calls row for the external id", Number(n) === 1, `rows=${n}`);
    didL = true;
  }
  if (!didL) console.log("SKIP L: no patient screening available");

  // ── N. Team-message membership authorization ──
  // isConversationMember must grant access ONLY to an ACTIVE member. We create
  // a temp team conversation with PCS active + ACS inactive, then assert:
  // active→allowed, inactive→denied, non-member→denied. Cleaned up below.
  const [convRow] = (await db.execute(sql`
    INSERT INTO message_conversations (type, title, status)
    VALUES ('team', ${MARK + " temp channel"}, 'active') RETURNING id
  `)).rows as Array<{ id: number }>;
  const tempConvId = convRow.id;
  await db.execute(sql`INSERT INTO message_conversation_members (conversation_id, user_id, member_role, active) VALUES (${tempConvId}, ${PCS}, 'member', true)`);
  await db.execute(sql`INSERT INTO message_conversation_members (conversation_id, user_id, member_role, active) VALUES (${tempConvId}, ${ACS}, 'member', false)`);

  check("N: active member is granted access", (await isConversationMember(tempConvId, PCS)) === true);
  check("N: inactive (removed) member is denied — history kept, no new access", (await isConversationMember(tempConvId, ACS)) === false);
  check("N: a non-member is denied access", (await isConversationMember(tempConvId, "00000000-0000-0000-0000-000000000000")) === false);

  // Clean up the temp conversation + members (cascade handles members).
  await db.execute(sql`DELETE FROM message_conversations WHERE id = ${tempConvId}`);

  // ── I. Deactivated-user recovery (all work types) ──
  const teamTask = await plexusRepository.createTask({
    title: `${MARK} team task`, taskType: "task", status: "open",
    assignedTeamId: ACS_TEAM, assignedToUserId: ACS, createdByUserId: ACS,
  });
  const personalTask = await plexusRepository.createTask({
    title: `${MARK} personal task`, taskType: "task", status: "open",
    assignedToUserId: ACS, createdByUserId: ACS,
  });
  const [ec] = (await db.execute(sql`SELECT id FROM patient_execution_cases LIMIT 1`)).rows as Array<{ id: number }>;
  let handoffId: number | null = null;
  if (ec) {
    const h = await callHandoffsRepository.create({
      executionCaseId: ec.id, toUserId: ACS, priorityLevel: "P2",
      reason: `${MARK} inbound handoff`, status: "pending", source: "peer",
    });
    handoffId = h.id;
  }
  const rec = await recoverDeactivatedUser(ACS, PCS);
  const teamAfter = await plexusRepository.getTask(teamTask.id);
  check("I: team task released to pool (assignee cleared, team kept)",
    teamAfter?.assignedToUserId == null && teamAfter?.assignedTeamId === ACS_TEAM);
  check("I: teamTasksReleased counted", rec.teamTasksReleased >= 1, String(rec.teamTasksReleased));
  const personalAfter = await plexusRepository.getTask(personalTask.id);
  check("I: personal task kept assigned + flagged", personalAfter?.assignedToUserId === ACS && rec.personalTasksFlagged >= 1);
  if (handoffId != null) {
    const hAfter = await callHandoffsRepository.getById(handoffId);
    check("I: inbound handoff cancelled", hAfter?.status === "cancelled");
    check("I: handoffsCancelled counted", rec.handoffsCancelled >= 1, String(rec.handoffsCancelled));
  }
  // Manager (PCS) notified.
  const mgrNotifs = await notificationsRepository.listForRecipient(PCS);
  const workReleased = mgrNotifs.find((n) => n.type === "user_deactivated_work_released");
  check("I: manager notified of released work (HIGH)", !!workReleased && workReleased.severity === "HIGH");

  // ── J. Reactivation does NOT resurrect ownership/cancelled handoffs/closed tasks ──
  // The recovery above cancelled the handoff + released the team task. A
  // reactivation restores eligibility only. We assert the cancelled handoff
  // stays cancelled and the released team task stays unassigned.
  const { reactivateUserEligibility } = await import("../../server/services/engagement/reactivateUser");
  await reactivateUserEligibility(ACS);
  if (handoffId != null) {
    const hAfterReact = await callHandoffsRepository.getById(handoffId);
    check("J: reactivation does NOT resurrect the cancelled handoff", hAfterReact?.status === "cancelled");
  }
  const teamAfterReact = await plexusRepository.getTask(teamTask.id);
  check("J: reactivation does NOT re-assign the released team task", teamAfterReact?.assignedToUserId == null);

  await cleanup();
  const [{ nt }] = (await db.execute(sql`SELECT count(*)::int AS nt FROM plexus_tasks WHERE title LIKE ${MARK + "%"}`)).rows as Array<{ nt: number }>;
  const [{ nmgr }] = (await db.execute(sql`SELECT count(*)::int AS nmgr FROM manager_relationships WHERE scope_type='user'`)).rows as Array<{ nmgr: number }>;
  check("DB clean after test", Number(nt) === 0 && Number(nmgr) === 0, `tasks=${nt} tempMgr=${nmgr}`);

  console.log(failures === 0 ? "\nworkforceRecovery.test.ts: all tests passed" : `\nworkforceRecovery.test.ts: ${failures} failure(s)`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("workforceRecovery.test.ts crashed:", e);
  try { await cleanup(); } catch { /* ignore */ }
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
