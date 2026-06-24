import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { engagementCallSettingsRepository } from "../repositories/engagementCallSettings.repo";
import {
  computeCallTargets,
  remainingCapacity,
  getCarryoverCounts,
  getPtoUserIdsForToday,
  deriveWorkingStatus,
  resolveWorkingToday,
  startOfTodayUtc,
} from "../services/engagement/callSettingsService";
import { ENGAGEMENT_TEAMS } from "@shared/schema";

// Engagement Center — admin Call Settings (Phase 1).
//
// Persists per-team-member call-distribution inputs in
// engagement_call_settings (one row per outreach_schedulers.id) and serves
// a read model that merges the roster + saved settings + DERIVED targets
// (completed-call KPI, scheduled KPI, visit/outreach split, capacity),
// live carryover, and platform-calendar (PTO)/manual-override working
// status. No Google Calendar. No distribution writes here — that is Phase 2.

// Sensible defaults for a roster member who has never been configured.
const SETTINGS_DEFAULTS = {
  team: "PCS" as const,
  callWorkdayPercent: 100,
  visitPercent: 75,
  baseCompletedCallKpi: 30,
  scheduledKpiPercent: 50,
  maxDailyCapacity: null as number | null,
  manualWorkingToday: null as boolean | null,
  active: true,
};

const updateSettingsSchema = z
  .object({
    team: z.enum(ENGAGEMENT_TEAMS).optional(),
    callWorkdayPercent: z.number().int().min(0).max(100).optional(),
    visitPercent: z.number().int().min(0).max(100).optional(),
    baseCompletedCallKpi: z.number().int().min(0).max(1000).optional(),
    scheduledKpiPercent: z.number().int().min(0).max(100).optional(),
    maxDailyCapacity: z.number().int().min(0).max(1000).nullable().optional(),
    manualWorkingToday: z.boolean().nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();

export function registerEngagementCallSettingsRoutes(
  app: Express,
  requireRole: (...roles: string[]) => RequestHandler,
) {
  // ─── Read model: roster × settings × derived targets × working status ───
  app.get(
    "/api/engagement/call-settings",
    async (_req: Request, res: Response) => {
      try {
        const schedulers = await storage.getOutreachSchedulers();
        const schedulerIds = schedulers.map((s) => s.id);

        const settingsRows =
          await engagementCallSettingsRepository.listForSchedulers(schedulerIds);
        const settingsByScheduler = new Map(
          settingsRows.map((r) => [r.schedulerId, r]),
        );

        const startOfToday = startOfTodayUtc();
        const carryoverBySched = await getCarryoverCounts(
          schedulerIds,
          startOfToday,
        );

        const userIds = schedulers
          .map((s) => s.userId)
          .filter((id): id is string => !!id);
        const ptoUserIds = await getPtoUserIdsForToday(userIds);
        // calendarAvailable is true only if any roster member is linked to a
        // platform user account (the basis we have for PTO/absence signals).
        const calendarAvailable = userIds.length > 0;

        const members = schedulers.map((s) => {
          const saved = settingsByScheduler.get(s.id);
          const merged = {
            team: saved?.team ?? SETTINGS_DEFAULTS.team,
            callWorkdayPercent:
              saved?.callWorkdayPercent ?? SETTINGS_DEFAULTS.callWorkdayPercent,
            visitPercent: saved?.visitPercent ?? SETTINGS_DEFAULTS.visitPercent,
            baseCompletedCallKpi:
              saved?.baseCompletedCallKpi ??
              SETTINGS_DEFAULTS.baseCompletedCallKpi,
            scheduledKpiPercent:
              saved?.scheduledKpiPercent ??
              SETTINGS_DEFAULTS.scheduledKpiPercent,
            maxDailyCapacity:
              saved?.maxDailyCapacity ?? SETTINGS_DEFAULTS.maxDailyCapacity,
            manualWorkingToday:
              saved?.manualWorkingToday ?? SETTINGS_DEFAULTS.manualWorkingToday,
            active: saved?.active ?? SETTINGS_DEFAULTS.active,
          };

          const targets = computeCallTargets(merged);
          const carryover = carryoverBySched.get(s.id) ?? 0;
          const working = deriveWorkingStatus(s.userId, ptoUserIds);
          const workingToday = resolveWorkingToday(
            merged.manualWorkingToday,
            working.calendarWorkingToday,
          );

          return {
            schedulerId: s.id,
            name: s.name,
            facility: s.facility,
            userId: s.userId ?? null,
            configured: !!saved,
            ...merged,
            ...targets,
            carryover,
            remainingCapacity: remainingCapacity(
              targets.completedCallKpi,
              carryover,
            ),
            calendarWorkingToday: working.calendarWorkingToday,
            calendarStatus: working.calendarStatus,
            ptoToday: working.ptoToday,
            manualOverrideActive: merged.manualWorkingToday != null,
            workingToday,
          };
        });

        res.json({
          members,
          calendarAvailable,
          asOfDate: new Date().toISOString().slice(0, 10),
        });
      } catch (error: unknown) {
        console.error(
          "[engagement/call-settings:get] error:",
          error instanceof Error ? error.message : error,
        );
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to load call settings",
        });
      }
    },
  );

  // ─── Upsert one team member's settings (admin-only) ─────────────────────
  app.patch(
    "/api/engagement/call-settings/:schedulerId",
    requireRole("admin"),
    async (req: Request, res: Response) => {
      const schedulerId = Number(req.params.schedulerId);
      if (!Number.isInteger(schedulerId) || schedulerId <= 0) {
        return res
          .status(400)
          .json({ error: "Invalid schedulerId", code: "bad_request" });
      }

      const parsed = updateSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message ?? "Invalid settings",
          code: "bad_request",
        });
      }

      const allSchedulers = await storage.getOutreachSchedulers();
      const scheduler = allSchedulers.find((s) => s.id === schedulerId);
      if (!scheduler) {
        return res
          .status(404)
          .json({ error: "Team member not found", code: "not_found" });
      }

      const saved = await engagementCallSettingsRepository.upsert(
        schedulerId,
        parsed.data,
      );

      const merged = {
        callWorkdayPercent: saved.callWorkdayPercent,
        visitPercent: saved.visitPercent,
        baseCompletedCallKpi: saved.baseCompletedCallKpi,
        scheduledKpiPercent: saved.scheduledKpiPercent,
        maxDailyCapacity: saved.maxDailyCapacity,
      };
      const targets = computeCallTargets(merged);
      const carryover =
        (await getCarryoverCounts([schedulerId])).get(schedulerId) ?? 0;

      res.json({
        ...saved,
        ...targets,
        carryover,
        remainingCapacity: remainingCapacity(targets.completedCallKpi, carryover),
      });
    },
  );
}
