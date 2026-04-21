import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { VALID_FACILITIES, facilityToSettingKey } from "./helpers";
import { getPlatformSettingsSnapshot } from "../services/platformSettingsService";
import { buildScheduleDashboard } from "../services/scheduleDashboardService";
import { storage } from "../storage";
import {
  DEFAULT_INVOICE_REMINDER_THRESHOLD_DAYS,
  INVOICE_REMINDER_SETTING_KEY,
  getReminderThresholdDays,
  sendRemindersNow,
} from "../services/invoiceReminderService";

const VALID_QUAL_MODES = ["permissive", "standard", "conservative"] as const;
const qualModeSchema = z.object({
  facility: z.enum(VALID_FACILITIES),
  mode: z.enum(VALID_QUAL_MODES),
});

const invoiceReminderSchema = z.object({
  thresholdDays: z.coerce.number().int().min(1).max(365),
});

function requireAdminOrBiller(req: Request, res: Response, next: NextFunction) {
  const role = req.session?.role;
  if (role !== "admin" && role !== "biller") {
    return res.status(403).json({ error: "Forbidden — requires admin or biller role" });
  }
  return next();
}

export function registerSettingsRoutes(app: Express) {
  app.get("/api/settings/platform", async (_req, res) => {
    try {
      res.json(getPlatformSettingsSnapshot());
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load platform settings" });
    }
  });

  app.get("/api/schedule/dashboard", async (req, res) => {
    try {
      const weekStart =
        typeof req.query.weekStart === "string" && req.query.weekStart.trim().length > 0
          ? req.query.weekStart.trim()
          : undefined;
      const payload = await buildScheduleDashboard(storage, weekStart);
      res.json(payload);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load schedule dashboard" });
    }
  });

  app.get("/api/settings/qualification-modes", async (_req, res) => {
    try {
      const { getSetting } = await import("../dbSettings");
      const results: Record<string, string> = {};
      for (const facility of VALID_FACILITIES) {
        const key = facilityToSettingKey(facility);
        const val = await getSetting(key);
        results[facility] = val ?? "permissive";
      }
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/settings/invoice-reminders", requireAdminOrBiller, async (_req, res) => {
    try {
      const thresholdDays = await getReminderThresholdDays();
      res.json({ thresholdDays, defaultThresholdDays: DEFAULT_INVOICE_REMINDER_THRESHOLD_DAYS });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/settings/invoice-reminders", requireAdminOrBiller, async (req, res) => {
    try {
      const parsed = invoiceReminderSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const { setSetting } = await import("../dbSettings");
      await setSetting(INVOICE_REMINDER_SETTING_KEY, String(parsed.data.thresholdDays));
      res.json({ thresholdDays: parsed.data.thresholdDays });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/settings/invoice-reminders/run", requireAdminOrBiller, async (_req, res) => {
    try {
      const summary = await sendRemindersNow(new Date());
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/settings/qualification-modes", async (req, res) => {
    try {
      const parsed = qualModeSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      const { facility, mode } = parsed.data;
      const { setSetting } = await import("../dbSettings");
      const key = facilityToSettingKey(facility);
      await setSetting(key, mode);
      res.json({ facility, mode });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
