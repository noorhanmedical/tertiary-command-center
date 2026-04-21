// Daily morning call-list rebuild — runs once per day shortly after the
// configured BUILD_HOUR (default 7 AM local server time). Uses an advisory
// lock keyed to the day so only one app instance fires even when multiple
// workers run, and skips dates that have already been processed in this
// process to avoid double-builds.

import { storage } from "../storage";
import { withAdvisoryLock } from "../lib/advisoryLock";
import { buildDailyAssignments } from "./callListEngine";
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
  const today = now.toISOString().slice(0, 10);
  if (now.getHours() < BUILD_HOUR) return;
  if (lastBuiltDate.has(today)) return;

  const lockName = `morning_rebuild:${today}`;
  const { acquired } = await withAdvisoryLock(lockName, async () => {
    for (const facility of VALID_FACILITIES) {
      try {
        await buildDailyAssignments(storage, facility, today);
      } catch (err) {
        console.error(`[morningRebuild] ${facility} failed:`, err);
      }
    }
    return true;
  });
  if (acquired) lastBuiltDate.add(today);
}
