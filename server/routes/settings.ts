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

const WORLD_CLOCKS_SETTING_KEY = "world_clocks";
const worldClocksUserKey = (userId: string) => `world_clocks:user:${userId}`;
const DEFAULT_WORLD_CLOCKS = [
  { label: "Manila", timeZone: "Asia/Manila" },
  { label: "Dhaka", timeZone: "Asia/Dhaka" },
  { label: "Arizona", timeZone: "America/Phoenix" },
  { label: "Houston", timeZone: "America/Chicago" },
  { label: "Michigan", timeZone: "America/Detroit" },
];

const isValidTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const worldClocksSchema = z.object({
  cities: z
    .array(
      z.object({
        label: z.string().trim().min(1, "Label is required").max(40),
        timeZone: z
          .string()
          .trim()
          .min(1, "Time zone is required")
          .refine(isValidTimeZone, "Invalid time zone"),
      }),
    )
    .max(12, "At most 12 cities allowed"),
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

  app.get("/api/settings/world-clocks", async (req, res) => {
    try {
      const { getSetting } = await import("../dbSettings");
      const userId = req.session?.userId;

      const readCities = async (key: string) => {
        const raw = await getSetting(key);
        if (!raw) return null;
        const parsed = worldClocksSchema.safeParse({ cities: JSON.parse(raw) });
        if (!parsed.success || parsed.data.cities.length === 0) return null;
        return parsed.data.cities;
      };

      // Prefer the logged-in user's personal list, then fall back to the
      // org-wide list, then the built-in defaults.
      const cities =
        (userId ? await readCities(worldClocksUserKey(userId)) : null) ??
        (await readCities(WORLD_CLOCKS_SETTING_KEY)) ??
        DEFAULT_WORLD_CLOCKS;

      res.json({ cities });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/settings/world-clocks", async (req, res) => {
    try {
      const parsed = worldClocksSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const { setSetting } = await import("../dbSettings");
      const userId = req.session?.userId;
      // Logged-in staff save to their own personal list; anonymous callers
      // (or legacy clients without a session) update the shared org-wide list.
      const key = userId ? worldClocksUserKey(userId) : WORLD_CLOCKS_SETTING_KEY;
      await setSetting(key, JSON.stringify(parsed.data.cities));
      res.json({ cities: parsed.data.cities });
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
