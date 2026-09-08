// ─── Sudden-absence watcher ──────────────────────────────────────────────
// Heuristic: a scheduler is presumed absent when, while they are SCHEDULED and
// ACTIVE right now (in THEIR clinic timezone), all of the following hold:
//   • They have active assignments today.
//   • They have not logged a single call within the effective inactivity
//     window (bounded at their shift start — pre-shift silence never counts).
//   • They have no approved PTO covering their clinic-local day.
//   • They have not explicitly gone on break / into a meeting / left early
//     (an explicit non-accepting availability state is intentional, not a
//     surprise absence — early departure is redistributed by its own path).
// When triggered we create an `absence_alert` Plexus task carrying a JSON
// "proposal" in the description so an admin can act with one click. Auto-
// execution is governed by env: ABSENCE_AUTO_EXECUTE_MIN (default off).
//
// Phase 3 shift-awareness: the OLD server-local 9–17 gate blocked the entire
// tick outside the server's own daytime, which is wrong once clinics span
// timezones (a Manila/Dubai clinic would never be watched, or watched at the
// wrong hours). Windowing is now decided PER MEMBER in their clinic timezone:
//   • a member with a configured shift → evaluated only inside [start+grace,
//     end); inactivity is measured from shift start (+ grace ramp-up).
//   • a member with NO shift (opt-in backward compat) → evaluated during
//     clinic-local business hours with the pre-Phase-3 rolling stale window.
//
// This is intentionally cheap — it runs every 10 minutes in-process and
// uses the advisory lock so only one app instance fires alerts even when
// horizontally scaled.

import { storage } from "../storage";
import { withAdvisoryLock } from "../lib/advisoryLock";
import { releaseAndRedistributeCanonical } from "./engagement/absenceRedistribution";
import { openai, withRetry } from "./aiClient";
import {
  classifyLogSafeError,
  errorPhiSafe,
  warnPhiSafe,
} from "../lib/phiSafeLogger";
import { resolveClinicTimeZone } from "./engagement/clinicTimeZone";
import {
  DEFAULT_CLINIC_TIME_ZONE,
  operationalDateInTimeZone,
  weekdayInTimeZone,
  localMinutesInTimeZone,
} from "../lib/clinicTime";
import {
  resolveShiftDay,
  resolvePlannedWorking,
  resolveAbsenceEvaluation,
} from "./engagement/workforceService";
import { resolveWorkingToday } from "./engagement/callSettingsService";
import { memberHoldsActiveClaim } from "./engagement/workClaimService";
import { listShiftsForDate } from "../repositories/workforceShifts.repo";
import { engagementCallSettingsRepository } from "../repositories/engagementCallSettings.repo";
import {
  type WorkforceAvailabilityState,
  type TeamMemberShift,
} from "@shared/schema/workforceShifts";

const TICK_MS = Number(process.env.ABSENCE_TICK_MS ?? 10 * 60 * 1000);
const STALE_CALL_WINDOW_MIN = Number(process.env.ABSENCE_STALE_CALL_WINDOW_MIN ?? 90);
// Spec: alert fires when (no calls in 90 min) AND (untouched-assignment older
// than 60 min) AND (no PTO). Untouched default = 60 minutes.
const UNTOUCHED_ASSIGNMENT_MIN = Number(process.env.ABSENCE_UNTOUCHED_ASSIGNMENT_MIN ?? 60);
const BUSINESS_HOUR_START = Number(process.env.ABSENCE_BUSINESS_HOUR_START ?? 9);
const BUSINESS_HOUR_END = Number(process.env.ABSENCE_BUSINESS_HOUR_END ?? 17);
// Default 30 min from spec — admin has 30 min to act before auto-exec fires.
const AUTO_EXECUTE_MIN = Number(process.env.ABSENCE_AUTO_EXECUTE_MIN ?? 30);
const ENABLE_AI_PROPOSAL = process.env.ABSENCE_AI_PROPOSAL_DISABLED !== "1";

let started = false;
let kickoffTimer: NodeJS.Timeout | null = null;
let tickInterval: NodeJS.Timeout | null = null;

export function startAbsenceWatcher() {
  if (started) return;
  if (process.env.NODE_ENV === "test") return;
  if (process.env.ABSENCE_WATCHER_DISABLED === "1") return;
  started = true;
  // Stagger first tick a bit so app start isn't slowed.
  kickoffTimer = setTimeout(() => {
    runOnce().catch((error: unknown) => {
      errorPhiSafe({
        source: "application_lifecycle",
        operation: "background_services",
        outcome: "failed",
        category: classifyLogSafeError(error),
      });
    });
    tickInterval = setInterval(() => {
      runOnce().catch((error: unknown) => {
        errorPhiSafe({
          source: "application_lifecycle",
          operation: "background_services",
          outcome: "failed",
          category: classifyLogSafeError(error),
        });
      });
    }, TICK_MS);
  }, 30_000);
}

export function stopAbsenceWatcher() {
  if (kickoffTimer) { clearTimeout(kickoffTimer); kickoffTimer = null; }
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
  started = false;
}

export async function runOnce(now: Date = new Date()): Promise<void> {
  // The advisory-lock bucket is a coordination token only (10-min granularity
  // on the shared wall clock) — NOT a business gate. Which members are actually
  // evaluated is decided per member below, each in their own clinic timezone.
  const bucket = `${now.toISOString().slice(0, 13)}:${Math.floor(now.getMinutes() / 10)}`;
  const lockName = `absence_watcher:${bucket}`;
  const serverToday = now.toISOString().slice(0, 10);

  await withAdvisoryLock(lockName, async () => {
    const schedulers = await storage.getOutreachSchedulers();
    const schedulerIds = schedulers.map((s) => s.id);
    if (schedulerIds.length === 0) return;

    // ── Resolve each member's clinic timezone → local date / weekday / minutes.
    // Shift wall-clock times are interpreted in the member's roster-clinic tz
    // (Phase 2). Members with no clinic fall back to the Central default.
    const distinctClinicIds = Array.from(
      new Set(schedulers.map((s) => s.clinicId).filter((c): c is number => c != null)),
    );
    const tzByClinic = new Map<number, string>();
    await Promise.all(
      distinctClinicIds.map(async (cid) => {
        tzByClinic.set(cid, (await resolveClinicTimeZone(cid)).timeZone);
      }),
    );
    const tzOf = (clinicId: number | null | undefined): string =>
      clinicId != null ? tzByClinic.get(clinicId) ?? DEFAULT_CLINIC_TIME_ZONE : DEFAULT_CLINIC_TIME_ZONE;
    const localBySched = new Map<number, { tz: string; date: string; weekday: number; minutes: number }>();
    for (const s of schedulers) {
      const tz = tzOf(s.clinicId ?? null);
      localBySched.set(s.id, {
        tz,
        date: operationalDateInTimeZone(now, tz),
        weekday: weekdayInTimeZone(now, tz),
        minutes: localMinutesInTimeZone(now, tz),
      });
    }
    const distinctDates = Array.from(new Set(Array.from(localBySched.values()).map((v) => v.date))).sort();
    const minDate = distinctDates[0] ?? serverToday;
    const maxDate = distinctDates[distinctDates.length - 1] ?? serverToday;

    // Assignments snapshot (active queue) + PTO across the clinic-local date
    // range + per-member shift rows + call-settings (shift defaults + manual
    // working override), all fetched once.
    const [assignments, ptoRows, settingsRows] = await Promise.all([
      storage.listActiveSchedulerAssignments({ asOfDate: serverToday }),
      storage.getPtoRequests({ status: "approved", fromDate: minDate, toDate: maxDate }),
      engagementCallSettingsRepository.listForSchedulers(schedulerIds),
    ]);
    const settingsByScheduler = new Map(settingsRows.map((r) => [r.schedulerId, r]));

    // PTO matcher keyed by (userId, clinic-local date).
    const onPto = (userId: string, date: string): boolean =>
      ptoRows.some((r) => r.userId === userId && r.startDate <= date && r.endDate >= date);

    const shiftByKey = new Map<string, TeamMemberShift>();
    await Promise.all(
      distinctDates.map(async (d) => {
        const m = await listShiftsForDate(schedulerIds, d);
        for (const [sid, row] of m) shiftByKey.set(`${sid}:${d}`, row);
      }),
    );

    const loadByScheduler = new Map<number, number>();
    for (const a of assignments) {
      loadByScheduler.set(a.schedulerId, (loadByScheduler.get(a.schedulerId) ?? 0) + 1);
    }

    for (const sc of schedulers) {
      const load = loadByScheduler.get(sc.id) ?? 0;
      if (load === 0) continue;
      if (!sc.userId) continue; // No way to look up call activity without a user.

      const ctx = localBySched.get(sc.id)!;
      const today = ctx.date; // clinic-local operational day for this member.
      if (onPto(sc.userId, today)) continue;

      // ── SHIFT dimension (opt-in): resolve this member's window for today.
      const settings = settingsByScheduler.get(sc.id);
      const shiftRow = shiftByKey.get(`${sc.id}:${today}`) ?? null;
      const shiftDay = resolveShiftDay({
        weekday: ctx.weekday,
        override: shiftRow
          ? {
              working: shiftRow.working,
              shiftStart: shiftRow.shiftStart,
              shiftEnd: shiftRow.shiftEnd,
              capacityOverride: shiftRow.capacityOverride,
            }
          : null,
        defaultShiftStart: settings?.defaultShiftStart ?? null,
        defaultShiftEnd: settings?.defaultShiftEnd ?? null,
        workWeekdays: (settings?.workWeekdays as number[] | null) ?? null,
      });

      // Planned working today = manual > PTO > roster AND the shift is not
      // scheduled OFF (day off / non-work weekday). PTO already gated above,
      // so calendarWorkingToday is effectively true for anyone we reach.
      const legacyWorkingToday = resolveWorkingToday(settings?.manualWorkingToday ?? null, true);
      const plannedWorking = resolvePlannedWorking(legacyWorkingToday, shiftDay.shiftWorking);
      const availState = (shiftRow?.availabilityState as WorkforceAvailabilityState | null) ?? null;

      // Shift-aware windowing + effective inactivity cutoff (clinic-local, in
      // their tz) — a single pure decision (unit-tested in workforceShifts).
      const gate = resolveAbsenceEvaluation({
        plannedWorking,
        availabilityState: availState,
        window: shiftDay.window,
        nowLocalMinutes: ctx.minutes,
        nowMs: now.getTime(),
        staleWindowMin: STALE_CALL_WINDOW_MIN,
        businessHourStart: BUSINESS_HOUR_START,
        businessHourEnd: BUSINESS_HOUR_END,
      });
      if (!gate.evaluate) continue; // not scheduled / off-shift / break / ramp-up
      const staleCutoffMs = gate.staleCutoffMs;

      const todayCalls = await storage.listOutreachCallsForSchedulerToday(sc.userId, today);
      const lastCall = todayCalls[0];
      const lastCallTime = lastCall ? new Date(lastCall.startedAt as unknown as string).getTime() : 0;
      const stale = lastCallTime < staleCutoffMs;

      // Untouched-assignment check: oldest assigned_at age in minutes.
      const myAssignments = assignments.filter((a) => a.schedulerId === sc.id);
      const oldestAssignedMs = myAssignments.reduce((acc, a) => {
        const t = new Date(a.assignedAt as unknown as string).getTime();
        return isNaN(t) ? acc : Math.min(acc, t);
      }, Number.POSITIVE_INFINITY);
      const oldestAgeMin = oldestAssignedMs === Number.POSITIVE_INFINITY
        ? 0 : (now.getTime() - oldestAssignedMs) / 60_000;
      const untouched = oldestAgeMin >= UNTOUCHED_ASSIGNMENT_MIN;

      // Strict AND per spec: stale calls AND untouched assignments AND
      // no PTO (PTO is gated above). Reduces false-alert risk vs OR.
      if (!(stale && untouched)) continue;

      // Phase 4 — ACTIVE-WORK AWARENESS. A VALID (non-expired) active claim by
      // this member is positive proof they are working RIGHT NOW (on a call,
      // before disposition), so "no recent completed calls" is a false alarm —
      // do NOT flag them absent. An EXPIRED claim does NOT suppress
      // (memberHoldsActiveClaim counts only non-expired claims), so a member
      // who truly walked away (lease lapsed) is still caught.
      if (await memberHoldsActiveClaim(sc.id, now)) continue;

      // Find any open absence task for this scheduler+day. If one exists,
      // we DO NOT create another — but we DO consider it for auto-execution
      // once the approval window has elapsed since the alert was created.
      // If no task exists yet, we create the alert first; auto-exec will
      // be considered on the next tick after the window passes.
      const existingTasks = await storage.getUrgentTasks();
      const existingAlert = existingTasks.find((t) =>
        t.taskType === "absence_alert" && t.status !== "resolved" &&
        (t.description ?? "").includes(`"schedulerId":${sc.id}`) &&
        (t.description ?? "").includes(`"asOfDate":"${today}"`),
      );
      if (existingAlert) {
        // Approval window check: only auto-execute after AUTO_EXECUTE_MIN
        // minutes have elapsed since the alert was created AND the alert
        // is still unacted (status === 'open'). This guarantees admin gets
        // the full window to approve/reject before automation kicks in.
        if (
          AUTO_EXECUTE_MIN > 0 &&
          existingAlert.status === "open" &&
          existingAlert.createdAt
        ) {
          const alertAgeMin =
            (now.getTime() - new Date(existingAlert.createdAt as unknown as string).getTime()) / 60_000;
          if (alertAgeMin >= AUTO_EXECUTE_MIN) {
            try {
              await releaseAndRedistributeCanonical(sc.id, "absence_auto_execute");
              await storage.updateTask(existingAlert.id, { status: "resolved" });
            } catch (error: unknown) {
              errorPhiSafe({
                source: "application_lifecycle",
                operation: "background_services",
                outcome: "failed",
                category: classifyLogSafeError(error),
              });
            }
          }
        }
        continue;
      }

      // AI-generated reassignment narrative (best-effort; falls back to
      // canonical recommendation text if the model call fails or is disabled).
      let aiSummary = "Recommend release + redistribute to remaining schedulers.";
      let aiPlan: { actions: Array<{ type: string; reason: string }> } = {
        actions: [{ type: "release_and_redistribute", reason: "scheduler unresponsive" }],
      };
      const aiKeyConfigured = !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
      if (ENABLE_AI_PROPOSAL && aiKeyConfigured) {
        try {
          const prompt = `Scheduler ${sc.name} at ${sc.facility} has ${load} active patient calls ` +
            `for ${today}. They ${todayCalls.length === 0 ? "have not logged any calls today" : `last logged a call at ${new Date(lastCallTime).toISOString()}`}, ` +
            `oldest assignment is ${Math.round(oldestAgeMin)} min old. Reply with a JSON object ` +
            `{"summary":"one sentence","actions":[{"type":"release_and_redistribute","reason":"..."}]}`;
          const resp = await withRetry(() => openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: "You are an operations assistant. Return ONLY a JSON object." },
              { role: "user", content: prompt },
            ],
            response_format: { type: "json_object" },
            max_tokens: 200,
          }), 2, "openai_request");
          const raw = resp.choices?.[0]?.message?.content ?? "";
          const parsed = JSON.parse(raw);
          if (typeof parsed.summary === "string") aiSummary = parsed.summary;
          if (Array.isArray(parsed.actions)) aiPlan = { actions: parsed.actions };
        } catch (error: unknown) {
          warnPhiSafe({
            source: "ai_operation",
            operation: "openai_request",
            outcome: "failed",
            category: classifyLogSafeError(error),
          });
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

      // First detection: alert is just created — auto-execution is deferred
      // to the NEXT tick that finds the alert still open and past the window.
      // This guarantees admins always get the full approval window.
    }
  });
}
