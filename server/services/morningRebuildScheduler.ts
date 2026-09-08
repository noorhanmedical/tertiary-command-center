// Daily morning scheduler.
//
// Phase 2 — the LIVE daily action is now a CLINIC-LOCAL canonical
// reconciliation (runClinicReconciliations): at ~5 AM in EACH clinic's OWN
// timezone it reconciles that clinic's continuous execution-case spine through
// the canonical allocator (distributionService.applyDistribution). It does NOT
// rebuild a list from scratch and does NOT treat scheduler_assignments as the
// live owner.
//
// The legacy scheduler_assignments per-day snapshot (buildDailyAssignments) is
// PRESERVED as HISTORY ONLY — it still runs once per day so the scheduler-portal
// historical (past-date) read has a snapshot to show, but it never drives live
// ownership. See runLegacyHistorySnapshot below.
//
// The scheduler ticks hourly; each tick lets runClinicReconciliations decide
// per clinic whether its local 5 AM has arrived (self-gating + run-once +
// advisory lock), so only one app instance fires per clinic per local day.

import { storage } from "../storage";
import { withAdvisoryLock } from "../lib/advisoryLock";
import { buildDailyAssignments } from "./callListEngine";
import { runClinicReconciliations } from "./engagement/dailyReconciliation";
import { VALID_FACILITIES } from "../../shared/plexus";

const TICK_MS = Number(process.env.CALL_LIST_TICK_MS ?? 60 * 60 * 1000); // hourly
const BUILD_HOUR = Number(process.env.CALL_LIST_BUILD_HOUR ?? 7);
const lastBuiltDate = new Set<string>();
let started = false;
let kickoffTimer: NodeJS.Timeout | null = null;
let tickInterval: NodeJS.Timeout | null = null;

export function startMorningRebuildScheduler() {
  if (started) return;
  if (process.env.NODE_ENV === "test") return;
  if (process.env.MORNING_REBUILD_DISABLED === "1") return;
  started = true;
  kickoffTimer = setTimeout(() => {
    runOnce().catch((err) => console.error("[morningRebuild] first tick:", err));
    tickInterval = setInterval(() => {
      runOnce().catch((err) => console.error("[morningRebuild] tick:", err));
    }, TICK_MS);
  }, 60_000);
}

export function stopMorningRebuildScheduler() {
  if (kickoffTimer) { clearTimeout(kickoffTimer); kickoffTimer = null; }
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
  started = false;
}

export async function runOnce(now: Date = new Date()): Promise<void> {
  // (1) LIVE — Phase 2 clinic-local canonical reconciliation. Self-gates per
  // clinic to ~5 AM in that clinic's own timezone, runs the canonical allocator
  // scoped to the clinic, and is run-once + advisory-locked internally. This is
  // the live daily reconciliation of the continuous execution-case spine.
  try {
    await runClinicReconciliations(now);
  } catch (err) {
    console.error("[morningRebuild] clinic reconciliation tick failed:", err);
  }

  // (2) HISTORY — legacy scheduler_assignments per-day snapshot. NOT the live
  // system. Preserved so the scheduler-portal historical (past-date) view keeps
  // a snapshot to render; it writes only the history table and never mutates
  // live ownership (patient_execution_cases.assignedTeamMemberId).
  await runLegacyHistorySnapshot(now);
}

/**
 * Legacy history snapshot — writes the per-(facility, day) scheduler_assignments
 * rows the historical scheduler-portal read consumes. Kept on its original
 * once-per-day (server-local BUILD_HOUR) trigger. HISTORY ONLY — the canonical
 * live reconciliation runs separately above.
 */
async function runLegacyHistorySnapshot(now: Date): Promise<void> {
  const today = now.toISOString().slice(0, 10);
  if (now.getHours() < BUILD_HOUR) return;
  if (lastBuiltDate.has(today)) return;

  const lockName = `morning_rebuild:${today}`;
  const { acquired } = await withAdvisoryLock(lockName, async () => {
    for (const facility of VALID_FACILITIES) {
      try {
        await buildDailyAssignments(storage, facility, today);
      } catch (err) {
        console.error(`[morningRebuild] history snapshot ${facility} failed:`, err);
      }
    }
    return true;
  });
  if (acquired) lastBuiltDate.add(today);
}
