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
import { openai } from "./aiClient";

const TICK_MS = Number(process.env.ABSENCE_TICK_MS ?? 10 * 60 * 1000);
const STALE_CALL_WINDOW_MIN = Number(process.env.ABSENCE_STALE_CALL_WINDOW_MIN ?? 90);
// Untouched-assignment age: if the scheduler's OLDEST active assignment was
// assigned more than this many minutes ago and they have not logged any
// dispositions on it, we treat the queue as untouched (a stronger absence
// signal than just "no calls in 90m" — covers schedulers who logged on a
// stale call early in the day and then went dark).
const UNTOUCHED_ASSIGNMENT_MIN = Number(process.env.ABSENCE_UNTOUCHED_ASSIGNMENT_MIN ?? 120);
const BUSINESS_HOUR_START = Number(process.env.ABSENCE_BUSINESS_HOUR_START ?? 9);
const BUSINESS_HOUR_END = Number(process.env.ABSENCE_BUSINESS_HOUR_END ?? 17);
// Default 30 min from spec — admin has 30 min to act before auto-exec fires.
const AUTO_EXECUTE_MIN = Number(process.env.ABSENCE_AUTO_EXECUTE_MIN ?? 30);
const ENABLE_AI_PROPOSAL = process.env.ABSENCE_AI_PROPOSAL_DISABLED !== "1";

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

      // Untouched-assignment check: oldest assigned_at age in minutes.
      const myAssignments = assignments.filter((a) => a.schedulerId === sc.id);
      const oldestAssignedMs = myAssignments.reduce((acc, a) => {
        const t = new Date(a.assignedAt as unknown as string).getTime();
        return isNaN(t) ? acc : Math.min(acc, t);
      }, Number.POSITIVE_INFINITY);
      const oldestAgeMin = oldestAssignedMs === Number.POSITIVE_INFINITY
        ? 0 : (now.getTime() - oldestAssignedMs) / 60_000;
      const untouched = todayCalls.length === 0 && oldestAgeMin >= UNTOUCHED_ASSIGNMENT_MIN;

      // Trigger if EITHER signal fires.
      if (!stale && !untouched) continue;

      // Already an open absence task?
      const existingTasks = await storage.getUrgentTasks();
      const dup = existingTasks.find((t) =>
        t.taskType === "absence_alert" && t.status !== "resolved" &&
        (t.description ?? "").includes(`"schedulerId":${sc.id}`) &&
        (t.description ?? "").includes(`"asOfDate":"${today}"`),
      );
      if (dup) continue;

      // AI-generated reassignment narrative (best-effort; falls back to
      // canonical recommendation text if the model call fails or is disabled).
      let aiSummary = "Recommend release + redistribute to remaining schedulers.";
      let aiPlan: { actions: Array<{ type: string; reason: string }> } = {
        actions: [{ type: "release_and_redistribute", reason: "scheduler unresponsive" }],
      };
      if (ENABLE_AI_PROPOSAL && process.env.OPENAI_API_KEY) {
        try {
          const prompt = `Scheduler ${sc.name} at ${sc.facility} has ${load} active patient calls ` +
            `for ${today}. They ${todayCalls.length === 0 ? "have not logged any calls today" : `last logged a call at ${new Date(lastCallTime).toISOString()}`}, ` +
            `oldest assignment is ${Math.round(oldestAgeMin)} min old. Reply with a JSON object ` +
            `{"summary":"one sentence","actions":[{"type":"release_and_redistribute","reason":"..."}]}`;
          const resp = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: "You are an operations assistant. Return ONLY a JSON object." },
              { role: "user", content: prompt },
            ],
            response_format: { type: "json_object" },
            max_tokens: 200,
          });
          const raw = resp.choices?.[0]?.message?.content ?? "";
          const parsed = JSON.parse(raw);
          if (typeof parsed.summary === "string") aiSummary = parsed.summary;
          if (Array.isArray(parsed.actions)) aiPlan = { actions: parsed.actions };
        } catch (err) {
          console.warn("[absenceWatcher] AI proposal failed (using fallback):", (err as Error)?.message);
        }
      }

      const proposal = {
        kind: "absence_alert",
        schedulerId: sc.id,
        schedulerName: sc.name,
        facility: sc.facility,
        asOfDate: today,
        activeAssignments: load,
        lastCallAt: lastCall ? lastCall.startedAt : null,
        oldestAssignmentAgeMin: Math.round(oldestAgeMin),
        triggers: { stale, untouched },
        autoExecuteAtMin: AUTO_EXECUTE_MIN,
        autoExecuteAt: AUTO_EXECUTE_MIN > 0
          ? new Date(now.getTime() + AUTO_EXECUTE_MIN * 60_000).toISOString()
          : null,
        recommended: "release_and_redistribute",
        aiSummary,
        aiPlan,
      };
      const description =
        `Possible absence: ${sc.name} (${sc.facility}) has ${load} active call(s). ` +
        `${aiSummary}\n\nAdmins have ${AUTO_EXECUTE_MIN} min to approve or reject ` +
        `before auto-execution.\n\n<!--proposal:${JSON.stringify(proposal)}-->`;

      await storage.createTask({
        title: `Absence alert: ${sc.name}`,
        description,
        taskType: "absence_alert",
        urgency: "within 1 hour",
        priority: "high",
        status: "open",
      });

      // Auto-execute after configured minutes from the FIRST detection
      // signal: prefer last-call timestamp, otherwise oldest-assignment age.
      const referenceTime = lastCallTime > 0
        ? lastCallTime
        : (oldestAssignedMs === Number.POSITIVE_INFINITY ? 0 : oldestAssignedMs);
      if (AUTO_EXECUTE_MIN > 0 && referenceTime > 0) {
        const minsSince = (now.getTime() - referenceTime) / 60_000;
        if (minsSince >= AUTO_EXECUTE_MIN) {
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
