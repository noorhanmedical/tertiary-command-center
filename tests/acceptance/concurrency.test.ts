// PERMANENT regression — concurrency safety (Final Acceptance §14 G + H).
//
//   H. concurrent team-task claim  → exactly ONE claimant wins
//      concurrent task status change → deterministic single winner
//   G. concurrent handoff for a case → one effective handoff, loser SUPERSEDED
//
// DB-BACKED and self-cleaning: needs a real Postgres (atomic conditional
// UPDATE / FOR UPDATE behavior can't be proven against a mock). Run with the
// dev DATABASE_URL loaded, e.g.:
//   set -a && . ./.env && set +a && npx tsx tests/acceptance/concurrency.test.ts
//
// All rows created here use the '[[ACCEPT concurrency]]' marker in a text field
// and are deleted in cleanup(); the test verifies the DB is clean at the end.

import { sql } from "drizzle-orm";
import { db, pool } from "../../server/db";
import { plexusRepository } from "../../server/repositories/plexus.repo";
import { callHandoffsRepository } from "../../server/repositories/callHandoffs.repo";

const MARK = "[[ACCEPT concurrency]]";
const PCS = "bdd23c42-c56a-4502-9b3c-253e63f59264"; // e2e_playwright_pcs
const ACS = "359e6c50-4ed5-48df-921e-32754cee84dc"; // e2e_playwright_acs
const TEAM_ID = 1; // Patient Care Specialists

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
}

async function cleanup() {
  await db.execute(sql`DELETE FROM plexus_task_events WHERE task_id IN (SELECT id FROM plexus_tasks WHERE title LIKE ${MARK + "%"})`);
  await db.execute(sql`DELETE FROM plexus_tasks WHERE title LIKE ${MARK + "%"}`);
  await db.execute(sql`DELETE FROM call_handoffs WHERE reason LIKE ${MARK + "%"}`);
}

async function main() {
  await cleanup();

  // ── H1. Concurrent team-task claim → exactly one winner ──
  const teamTask = await plexusRepository.createTask({
    title: `${MARK} claim race`, taskType: "task", status: "open",
    assignedTeamId: TEAM_ID, createdByUserId: PCS,
  });
  const [wa, wb] = await Promise.all([
    plexusRepository.claimTeamTask(teamTask.id, TEAM_ID, PCS),
    plexusRepository.claimTeamTask(teamTask.id, TEAM_ID, ACS),
  ]);
  const winners = [wa, wb].filter((r) => r !== undefined);
  check("H1: exactly one claim winner", winners.length === 1, `winners=${winners.length}`);
  const owner = (await plexusRepository.getTask(teamTask.id))?.assignedToUserId;
  check("H1: final owner is the winner", owner === winners[0]?.assignedToUserId, `owner=${owner}`);
  const third = await plexusRepository.claimTeamTask(teamTask.id, TEAM_ID, PCS);
  check("H1: a later claim on a claimed task is rejected", third === undefined);

  // ── H2. Concurrent status transition → deterministic single winner ──
  const t2 = await plexusRepository.createTask({
    title: `${MARK} status race`, taskType: "task", status: "open", createdByUserId: PCS,
  });
  const [toDone, toProg] = await Promise.all([
    plexusRepository.transitionTaskStatus(t2.id, "open", "done", { completedAt: new Date(), completedByUserId: PCS }),
    plexusRepository.transitionTaskStatus(t2.id, "open", "in_progress"),
  ]);
  const stWin = [toDone, toProg].filter((r) => r !== undefined);
  check("H2: exactly one status transition wins", stWin.length === 1, `winners=${stWin.length}`);
  const t2f = await plexusRepository.getTask(t2.id);
  check("H2: final status is the winner's", t2f?.status === stWin[0]?.status, `status=${t2f?.status}`);
  // Completion provenance matches the outcome.
  if (stWin[0]?.status === "done") {
    check("H2: done winner stamped completedBy", t2f?.completedByUserId === PCS);
  } else {
    check("H2: non-terminal winner has no completion stamp", t2f?.completedByUserId == null);
  }
  const wrongFrom = await plexusRepository.transitionTaskStatus(t2.id, "open", "closed");
  check("H2: transition from a stale prior status is rejected", wrongFrom === undefined);

  // ── G. Concurrent handoffs on ONE case → one effective, loser superseded ──
  // Grab any real execution case id to satisfy the FK; if none exists, skip G.
  const [ec] = (await db.execute(sql`SELECT id FROM patient_execution_cases LIMIT 1`)).rows as Array<{ id: number }>;
  if (ec) {
    // Two open handoffs land on the same case (older one first).
    const h1 = await callHandoffsRepository.create({
      executionCaseId: ec.id, toUserId: ACS, priorityLevel: "P2",
      reason: `${MARK} first handoff`, status: "pending", source: "peer",
    });
    const h2 = await callHandoffsRepository.create({
      executionCaseId: ec.id, toUserId: PCS, priorityLevel: "P1",
      reason: `${MARK} second handoff (winner)`, status: "pending", source: "peer",
    });
    // The winner (h2) supersedes any OTHER open handoff on the case.
    const superseded = await callHandoffsRepository.supersedeOpenForCase(ec.id, h2.id, h2.id);
    check("G: exactly the losing handoff is superseded", superseded.length === 1, `superseded=${superseded.length}`);
    check("G: the superseded one is the earlier handoff (h1)", superseded[0]?.id === h1.id);
    const h1After = await callHandoffsRepository.getById(h1.id);
    const h2After = await callHandoffsRepository.getById(h2.id);
    check("G: loser status is 'superseded'", h1After?.status === "superseded", `h1=${h1After?.status}`);
    check("G: winner remains open (pending)", h2After?.status === "pending", `h2=${h2After?.status}`);
    // The recipient of the winner never sees two active handoffs for the case.
    const openForCase = await callHandoffsRepository.listOpenForExecutionCases([ec.id]);
    const acceptOpen = openForCase.filter((h) => h.reason.startsWith(MARK));
    check("G: exactly one OPEN handoff remains for the case", acceptOpen.length === 1, `open=${acceptOpen.length}`);
  } else {
    console.log("SKIP G: no execution case available to attach handoffs");
  }

  await cleanup();
  const [{ nt }] = (await db.execute(sql`SELECT count(*)::int AS nt FROM plexus_tasks WHERE title LIKE ${MARK + "%"}`)).rows as Array<{ nt: number }>;
  const [{ nh }] = (await db.execute(sql`SELECT count(*)::int AS nh FROM call_handoffs WHERE reason LIKE ${MARK + "%"}`)).rows as Array<{ nh: number }>;
  check("DB clean after test", Number(nt) === 0 && Number(nh) === 0, `tasks=${nt} handoffs=${nh}`);

  console.log(failures === 0 ? "\nconcurrency.test.ts: all tests passed" : `\nconcurrency.test.ts: ${failures} failure(s)`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("concurrency.test.ts crashed:", e);
  try { await cleanup(); } catch { /* ignore */ }
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
