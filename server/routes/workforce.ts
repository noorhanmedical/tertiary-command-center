// Workforce control surface (Phase 3) — real-time availability + shift
// overrides for a roster team member, with SAFE early-departure redistribution.
//
//   GET  /api/engagement/workforce/:schedulerId/shift?date=YYYY-MM-DD
//        → resolved shift day (override → recurring default → none) + raw row
//   POST /api/engagement/workforce/:schedulerId/availability
//        → set right-now availability (break / meeting / finish_current_only /
//          unavailable / back to available). Leaving states trigger a scoped
//          redistribution of DUE work only (future callbacks preserved).
//   POST /api/engagement/workforce/:schedulerId/shift
//        → set / override a date's shift (late start, early end, day off,
//          capacity override). Taking the member OFF *now* redistributes DUE
//          work; otherwise the real-time gate stops new work at the boundary.
//
// All endpoints are manager-scoped (requireManagerOrAdmin + the target
// scheduler must be within the caller's scope; admin is org-wide). These
// COORDINATE existing canonical services (workforceAvailability →
// releaseAndRedistributeCanonical → applyDistribution). No new allocator, no
// Settings/Team-Portal redesign (that is a later phase).

import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  WORKFORCE_AVAILABILITY_STATES,
  type WorkforceAvailabilityState,
} from "@shared/schema/workforceShifts";
import {
  setMemberAvailabilityState,
  setMemberShift,
} from "../services/engagement/workforceAvailability";
import { getShift } from "../repositories/workforceShifts.repo";
import { resolveShiftDay } from "../services/engagement/workforceService";
import { engagementCallSettingsRepository } from "../repositories/engagementCallSettings.repo";
import { resolveClinicTimeZone } from "../services/engagement/clinicTimeZone";
import {
  operationalDateInTimeZone,
  weekdayInTimeZone,
} from "../lib/clinicTime";
import { storage } from "../storage";
import {
  requireManagerOrAdmin,
  schedulerIdsInScope,
  type ManagerScope,
} from "../services/teams/managerScope";
import { logAudit } from "../services/auditService";

// Availability states a human can explicitly SET. `off_shift` is DERIVED from
// the shift window (before/after shift) and is never set directly.
const SETTABLE_AVAILABILITY_STATES = WORKFORCE_AVAILABILITY_STATES.filter(
  (s) => s !== "off_shift",
) as Exclude<WorkforceAvailabilityState, "off_shift">[];

const availabilitySchema = z
  .object({
    state: z.enum(SETTABLE_AVAILABILITY_STATES as [string, ...string[]]),
    reason: z.string().max(500).nullable().optional(),
  })
  .strict();

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const shiftSchema = z
  .object({
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "workDate must be YYYY-MM-DD"),
    working: z.boolean().optional(),
    shiftStart: z.string().regex(HHMM, "shiftStart must be HH:MM").nullable().optional(),
    shiftEnd: z.string().regex(HHMM, "shiftEnd must be HH:MM").nullable().optional(),
    capacityOverride: z.number().int().min(0).max(1000).nullable().optional(),
  })
  .strict();

function parseSchedulerId(req: Request, res: Response): number | null {
  const schedulerId = Number(req.params.schedulerId);
  if (!Number.isInteger(schedulerId) || schedulerId <= 0) {
    res.status(400).json({ error: "Invalid schedulerId", code: "bad_request" });
    return null;
  }
  return schedulerId;
}

/** Manager scope gate: admin passes; a manager may only act on schedulers in
 *  their team scope. Returns true when allowed (else writes 403 and false). */
async function assertSchedulerInScope(
  scope: ManagerScope,
  schedulerId: number,
  res: Response,
): Promise<boolean> {
  if (scope.isAdmin) return true;
  const ids = await schedulerIdsInScope(scope);
  if (ids && ids.includes(schedulerId)) return true;
  res.status(403).json({ error: "Team member is outside your team scope", code: "forbidden" });
  return false;
}

const actorOf = (req: Request): string | null =>
  (req.session as { userId?: string }).userId ?? null;

export function registerWorkforceRoutes(app: Express) {
  // ─── Resolved shift day for a date (override → recurring default → none) ──
  app.get(
    "/api/engagement/workforce/:schedulerId/shift",
    requireManagerOrAdmin,
    async (req: Request, res: Response) => {
      const schedulerId = parseSchedulerId(req, res);
      if (schedulerId == null) return;
      const scope = (req as { managerScope?: ManagerScope }).managerScope!;
      if (!(await assertSchedulerInScope(scope, schedulerId, res))) return;

      try {
        const rosters = await storage.getOutreachSchedulers();
        const roster = rosters.find((r) => r.id === schedulerId);
        if (!roster) {
          return res.status(404).json({ error: "Team member not found", code: "not_found" });
        }
        const tz = (await resolveClinicTimeZone(roster.clinicId ?? null)).timeZone;
        const dateParam = typeof req.query.date === "string" ? req.query.date : null;
        const workDate =
          dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
            ? dateParam
            : operationalDateInTimeZone(new Date(), tz);
        // Weekday of the requested date (noon UTC avoids DST edge flips).
        const weekday = weekdayInTimeZone(new Date(`${workDate}T12:00:00Z`), tz);
        const settings = await engagementCallSettingsRepository.getByScheduler(schedulerId);
        const override = await getShift(schedulerId, workDate);
        const shiftDay = resolveShiftDay({
          weekday,
          override: override
            ? {
                working: override.working,
                shiftStart: override.shiftStart,
                shiftEnd: override.shiftEnd,
                capacityOverride: override.capacityOverride,
              }
            : null,
          defaultShiftStart: settings?.defaultShiftStart ?? null,
          defaultShiftEnd: settings?.defaultShiftEnd ?? null,
          workWeekdays: (settings?.workWeekdays as number[] | null) ?? null,
        });
        return res.json({ schedulerId, workDate, timeZone: tz, shiftDay, override: override ?? null });
      } catch (error: unknown) {
        console.error(
          "[workforce/shift:get] error:",
          error instanceof Error ? error.message : error,
        );
        return res.status(500).json({ error: "Failed to load shift" });
      }
    },
  );

  // ─── Set right-now availability (break / meeting / leaving / back) ───────
  app.post(
    "/api/engagement/workforce/:schedulerId/availability",
    requireManagerOrAdmin,
    async (req: Request, res: Response) => {
      const schedulerId = parseSchedulerId(req, res);
      if (schedulerId == null) return;
      const scope = (req as { managerScope?: ManagerScope }).managerScope!;
      if (!(await assertSchedulerInScope(scope, schedulerId, res))) return;

      const parsed = availabilitySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message ?? "Invalid availability",
          code: "bad_request",
        });
      }
      try {
        const result = await setMemberAvailabilityState(
          schedulerId,
          parsed.data.state as WorkforceAvailabilityState,
          parsed.data.reason ?? null,
          actorOf(req),
        );
        void logAudit(req, "update", "workforce_availability", schedulerId, {
          state: parsed.data.state,
          reason: parsed.data.reason ?? null,
          redistributed: result.redistribution?.redistributed ?? 0,
          released: result.redistribution?.released ?? 0,
        });
        return res.json(result);
      } catch (error: unknown) {
        console.error(
          "[workforce/availability:post] error:",
          error instanceof Error ? error.message : error,
        );
        return res.status(500).json({ error: "Failed to set availability" });
      }
    },
  );

  // ─── Set / override a date's shift (late start / early end / off / cap) ──
  app.post(
    "/api/engagement/workforce/:schedulerId/shift",
    requireManagerOrAdmin,
    async (req: Request, res: Response) => {
      const schedulerId = parseSchedulerId(req, res);
      if (schedulerId == null) return;
      const scope = (req as { managerScope?: ManagerScope }).managerScope!;
      if (!(await assertSchedulerInScope(scope, schedulerId, res))) return;

      const parsed = shiftSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message ?? "Invalid shift",
          code: "bad_request",
        });
      }
      // A partial/inverted window is a client error worth surfacing (the
      // service treats it fail-safe, but the admin almost certainly meant a
      // valid window). Reject only when BOTH ends are present and inverted.
      const { shiftStart, shiftEnd } = parsed.data;
      if (
        typeof shiftStart === "string" &&
        typeof shiftEnd === "string" &&
        shiftEnd <= shiftStart
      ) {
        return res.status(400).json({
          error: "shiftEnd must be after shiftStart",
          code: "bad_request",
        });
      }
      try {
        const result = await setMemberShift(
          schedulerId,
          {
            workDate: parsed.data.workDate,
            working: parsed.data.working,
            shiftStart: parsed.data.shiftStart,
            shiftEnd: parsed.data.shiftEnd,
            capacityOverride: parsed.data.capacityOverride,
            source: "manual",
          },
          actorOf(req),
        );
        void logAudit(req, "update", "workforce_shift", schedulerId, {
          ...parsed.data,
          redistributed: result.redistribution?.redistributed ?? 0,
          released: result.redistribution?.released ?? 0,
        });
        return res.json(result);
      } catch (error: unknown) {
        console.error(
          "[workforce/shift:post] error:",
          error instanceof Error ? error.message : error,
        );
        return res.status(500).json({ error: "Failed to set shift" });
      }
    },
  );
}
