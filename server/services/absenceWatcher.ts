// ─── Sudden-absence watcher ──────────────────────────────────────────────
// Heuristic: a scheduler is presumed absent when, during business hours, all
// of the following hold:
//   • They have active assignments today.
//   • They have not logged a single call in the last `STALE_CALL_WINDOW_MIN`.
//   • They have no approved PTO covering today.
// When triggered we create an `absence_alert` Plexus task carrying a JSON
// "proposal" in the description so an admin can act with one click. Auto-
// execution is governed by env: ABSENCE_AUTO_EXECUTE_MIN (default off).
//
// This is intentionally cheap — it runs every 10 minutes in-process and
// uses the advisory lock so only one app instance fires alerts even when
// horizontally scaled.

import { storage } from "../storage";
import { withAdvisoryLock } from "../lib/advisoryLock";
import { releaseAndRedistribute } from "./callListEngine";

const TICK_MS = Number(process.env.ABSENCE_TICK_MS ?? 10 * 60 * 1000);
const STALE_CALL_WINDOW_MIN = Number(process.env.ABSENCE_STALE_CALL_WINDOW_MIN ?? 90);
const BUSINESS_HOUR_START = Number(process.env.ABSENCE_BUSINESS_HOUR_START ?? 9);
const BUSINESS_HOUR_END = Number(process.env.ABSENCE_BUSINESS_HOUR_END ?? 17);
const AUTO_EXECUTE_MIN = Number(process.env.ABSENCE_AUTO_EXECUTE_MIN ?? 0);

let started = false;

export function startAbsenceWatcher() {
  if (started) return;
  if (process.env.NODE_ENV === "test") return;
  if (process.env.ABSENCE_WATCHER_DISABLED === "1") return;
  started = true;
  // Stagger first tick a bit so app start isn't slowed.
  setTimeout(() => {
    runOnce().catch((err) => console.error("[absenceWatcher] first tick:", err));
    setInterval(() => {
      runOnce().catch((err) => console.error("[absenceWatcher] tick:", err));
    }, TICK_MS);
  }, 30_000);
}

export async function runOnce(now: Date = new Date()): Promise<void> {
  const hour = now.getHours();
  if (hour < BUSINESS_HOUR_START || hour >= BUSINESS_HOUR_END) return;

  const today = now.toISOString().slice(0, 10);
  const lockName = `absence_watcher:${today}:${hour}:${Math.floor(now.getMinutes() / 10)}`;

  await withAdvisoryLock(lockName, async () => {
    const [schedulers, assignments, ptoToday] = await Promise.all([
      storage.getOutreachSchedulers(),
      storage.listActiveSchedulerAssignments({ asOfDate: today }),
      storage.getPtoRequests({ status: "approved", fromDate: today, toDate: today }),
    ]);

    const onPto = new Set<string>();
    for (const r of ptoToday) {
      if (r.startDate <= today && r.endDate >= today) onPto.add(r.userId);
    }

    const loadByScheduler = new Map<number, number>();
    for (const a of assignments) {
      loadByScheduler.set(a.schedulerId, (loadByScheduler.get(a.schedulerId) ?? 0) + 1);
    }

    const cutoff = new Date(now.getTime() - STALE_CALL_WINDOW_MIN * 60 * 1000);

    for (const sc of schedulers) {
      const load = loadByScheduler.get(sc.id) ?? 0;
      if (load === 0) continue;
      if (sc.userId && onPto.has(sc.userId)) continue;
      if (!sc.userId) continue; // No way to look up call activity without a user.

      const todayCalls = await storage.listOutreachCallsForSchedulerToday(sc.userId, today);
      const lastCall = todayCalls[0];
      const lastCallTime = lastCall ? new Date(lastCall.startedAt as unknown as string).getTime() : 0;
      const stale = lastCallTime < cutoff.getTime();
      if (!stale) continue;

      // Already an open absence task?
      const existingTasks = await storage.getUrgentTasks();
      const dup = existingTasks.find((t) =>
        t.taskType === "absence_alert" && t.status !== "resolved" &&
        (t.description ?? "").includes(`"schedulerId":${sc.id}`) &&
        (t.description ?? "").includes(`"asOfDate":"${today}"`),
      );
      if (dup) continue;

      const proposal = {
        kind: "absence_alert",
        schedulerId: sc.id,
        schedulerName: sc.name,
        facility: sc.facility,
        asOfDate: today,
        activeAssignments: load,
        lastCallAt: lastCall ? lastCall.startedAt : null,
        recommended: "release_and_redistribute",
      };
      const description =
        `Possible absence: ${sc.name} (${sc.facility}) has ${load} active call(s) ` +
        `but no calls in ${STALE_CALL_WINDOW_MIN} min. Recommend release + redistribute.\n\n` +
        `<!--proposal:${JSON.stringify(proposal)}-->`;

      await storage.createTask({
        title: `Absence alert: ${sc.name}`,
        description,
        taskType: "absence_alert",
        urgency: "within 1 hour",
        priority: "high",
        status: "open",
      });

      // Optional auto-execute after configured minutes have passed since
      // the last call. Disabled (0) by default.
      if (AUTO_EXECUTE_MIN > 0 && lastCallTime > 0) {
        const minsSinceLast = (now.getTime() - lastCallTime) / 60_000;
        if (minsSinceLast >= AUTO_EXECUTE_MIN) {
          try {
            await releaseAndRedistribute(storage, sc.id, today, "absence_auto_execute");
          } catch (err) {
            console.error("[absenceWatcher] auto-execute failed:", err);
          }
        }
      }
    }
  });
}
