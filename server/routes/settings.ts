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
import {
  getPhoneProviderPreferences,
  savePhoneProviderDefault,
  clearPhoneProviderDefault,
} from "../repositories/adminSettings.repo";
import { SELECTABLE_PHONE_PROVIDER_IDS } from "@shared/phoneProvider";

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

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session?.role !== "admin") {
    return res.status(403).json({ error: "Forbidden — requires admin role" });
  }
  return next();
}

// ─── World Time image registry ──────────────────────────────────────────────
// Backing store for the premium World Time card imagery + its approval state
// machine. Runtime dashboard reads APPROVED images only; image discovery is an
// admin/configuration workflow (never at render time). Stored as a single
// JSON map under one settings key so no DB migration is required.
const WORLD_TIME_IMAGES_SETTING_KEY = "world_time_images";

type WorldTimeImageStatus =
  | "no_image"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "needs_replacement";

type WorldTimeImageRecord = {
  assetUrl: string;
  landmarkName: string;
  imagePosition: string;
  sourceName?: string;
  sourceReference?: string;
  status: WorldTimeImageStatus;
  proposedAt?: string;
  proposedBy?: string;
  approvedAt?: string;
  approvedBy?: string;
};

const wtSlugify = (label: string): string =>
  label
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Seeded, pre-approved imagery for the currently-configured locations. These
// are the operator-approved defaults; they render immediately and are only
// overridden by explicit admin action persisted in the settings store.
const DEFAULT_WORLD_TIME_IMAGES: Record<string, WorldTimeImageRecord> = {
  arizona: { assetUrl: "/world-time/arizona.svg", landmarkName: "Sonoran Desert", imagePosition: "center 58%", status: "approved", approvedBy: "system", approvedAt: "2026-01-01T00:00:00.000Z" },
  houston: { assetUrl: "/world-time/houston.svg", landmarkName: "Houston Skyline", imagePosition: "center 48%", status: "approved", approvedBy: "system", approvedAt: "2026-01-01T00:00:00.000Z" },
  michigan: { assetUrl: "/world-time/michigan.svg", landmarkName: "Detroit Riverfront", imagePosition: "center 52%", status: "approved", approvedBy: "system", approvedAt: "2026-01-01T00:00:00.000Z" },
  dhaka: { assetUrl: "/world-time/dhaka.svg", landmarkName: "Dhaka Skyline & Mosque", imagePosition: "center 45%", status: "approved", approvedBy: "system", approvedAt: "2026-01-01T00:00:00.000Z" },
  manila: { assetUrl: "/world-time/manila.svg", landmarkName: "Manila Bay Skyline", imagePosition: "center 50%", status: "approved", approvedBy: "system", approvedAt: "2026-01-01T00:00:00.000Z" },
};

async function readWorldTimeRegistry(): Promise<Record<string, WorldTimeImageRecord>> {
  const { getSetting } = await import("../dbSettings");
  const merged: Record<string, WorldTimeImageRecord> = { ...DEFAULT_WORLD_TIME_IMAGES };
  const raw = await getSetting(WORLD_TIME_IMAGES_SETTING_KEY);
  if (raw) {
    try {
      const stored = JSON.parse(raw) as Record<string, WorldTimeImageRecord>;
      // Stored entries win (admin edits/approvals override seeded defaults).
      for (const [slug, rec] of Object.entries(stored)) merged[slug] = rec;
    } catch {
      /* corrupt value → fall back to seeded defaults */
    }
  }
  return merged;
}

async function writeWorldTimeRegistry(reg: Record<string, WorldTimeImageRecord>): Promise<void> {
  const { setSetting } = await import("../dbSettings");
  await setSetting(WORLD_TIME_IMAGES_SETTING_KEY, JSON.stringify(reg));
}

const worldTimeImageProposalSchema = z.object({
  assetUrl: z.string().trim().min(1).max(2048),
  landmarkName: z.string().trim().min(1).max(120),
  imagePosition: z.string().trim().max(40).optional(),
  sourceName: z.string().trim().max(200).optional(),
  sourceReference: z.string().trim().max(2048).optional(),
});

// Phone-provider default persistence. Org/facility scopes are admin-only;
// team-member scope is the logged-in user's own preference.
const phoneProviderSaveSchema = z.object({
  scope: z.enum(["organization", "facility", "team_member"]),
  providerId: z.enum(SELECTABLE_PHONE_PROVIDER_IDS),
  facilityId: z.string().trim().min(1).optional(),
});
const phoneProviderClearSchema = z.object({
  scope: z.enum(["organization", "facility", "team_member"]),
  facilityId: z.string().trim().min(1).optional(),
});

export function registerSettingsRoutes(app: Express) {
  // ─── Phone provider defaults ─────────────────────────────────────
  // GET resolves persisted org/facility/team-member defaults for an
  // optional facility scope + the logged-in user. Each layer is the
  // EXACT persisted value; the client resolver applies precedence
  // (team-member → facility → org → manual). localStorage / env are
  // client-side FALLBACK only, never returned here.
  app.get("/api/settings/phone-provider", async (req, res) => {
    try {
      const userId = req.session?.userId ?? null;
      const facilityId =
        typeof req.query.facilityId === "string" && req.query.facilityId.trim().length > 0
          ? req.query.facilityId.trim()
          : null;
      const prefs = await getPhoneProviderPreferences({ facilityId, userId });
      res.json(prefs);
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed to read phone provider settings" });
    }
  });

  // PUT persists a default at a scope level. organization/facility are
  // admin-only; team_member writes the logged-in user's own preference.
  app.put("/api/settings/phone-provider", async (req, res) => {
    try {
      const parsed = phoneProviderSaveSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const { scope, providerId } = parsed.data;
      const role = req.session?.role;
      const userId = req.session?.userId ?? null;

      if (scope === "organization" || scope === "facility") {
        if (role !== "admin") {
          return res.status(403).json({ error: "Forbidden — organization/facility defaults require admin role" });
        }
        if (scope === "facility" && !parsed.data.facilityId) {
          return res.status(400).json({ error: "facilityId is required for facility scope" });
        }
        const saved = await savePhoneProviderDefault({
          scope,
          providerId,
          facilityId: parsed.data.facilityId ?? null,
        });
        return res.json({ ok: true, setting: saved });
      }

      // team_member — must be authenticated; writes the caller's own row.
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const saved = await savePhoneProviderDefault({ scope: "team_member", providerId, userId });
      return res.json({ ok: true, setting: saved });
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed to save phone provider setting" });
    }
  });

  // DELETE clears a persisted default at a scope level (falls through to
  // the next precedence layer). Same authz as PUT.
  app.delete("/api/settings/phone-provider", async (req, res) => {
    try {
      const parsed = phoneProviderClearSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const { scope } = parsed.data;
      const role = req.session?.role;
      const userId = req.session?.userId ?? null;

      if (scope === "organization" || scope === "facility") {
        if (role !== "admin") {
          return res.status(403).json({ error: "Forbidden — organization/facility defaults require admin role" });
        }
        const cleared = await clearPhoneProviderDefault({ scope, facilityId: parsed.data.facilityId ?? null });
        return res.json({ ok: true, cleared });
      }
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const cleared = await clearPhoneProviderDefault({ scope: "team_member", userId });
      return res.json({ ok: true, cleared });
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed to clear phone provider setting" });
    }
  });

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

  // ─── World Time card imagery ──────────────────────────────────────────────
  // Public (dashboard) read: returns each location's status but exposes the
  // asset URL ONLY for APPROVED images. An unapproved/pending/rejected
  // candidate can therefore never leak onto the production-facing card.
  app.get("/api/settings/world-time/images", async (_req, res) => {
    try {
      const reg = await readWorldTimeRegistry();
      const images: Record<string, unknown> = {};
      for (const [slug, rec] of Object.entries(reg)) {
        images[slug] =
          rec.status === "approved"
            ? {
                status: rec.status,
                landmarkName: rec.landmarkName,
                imagePosition: rec.imagePosition,
                assetUrl: rec.assetUrl,
              }
            : { status: rec.status, landmarkName: rec.landmarkName, imagePosition: rec.imagePosition };
      }
      res.json({ images });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin read: full registry INCLUDING pending candidate asset URLs, so the
  // approval surface can render the exact production preview before approval.
  app.get("/api/admin/world-time/images", requireAdmin, async (_req, res) => {
    try {
      res.json({ images: await readWorldTimeRegistry() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin propose/replace a candidate image for a location. Selecting/saving is
  // NOT approval — this moves the record to PENDING_APPROVAL and records
  // proposal audit metadata. The location's timezone card keeps working on the
  // fallback gradient until an image is explicitly approved.
  app.put("/api/admin/world-time/images/:id", requireAdmin, async (req, res) => {
    try {
      const id = wtSlugify(String(req.params.id ?? ""));
      if (!id) return res.status(400).json({ error: "Invalid location id" });
      const parsed = worldTimeImageProposalSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const reg = await readWorldTimeRegistry();
      reg[id] = {
        assetUrl: parsed.data.assetUrl,
        landmarkName: parsed.data.landmarkName,
        imagePosition: parsed.data.imagePosition || "center center",
        sourceName: parsed.data.sourceName,
        sourceReference: parsed.data.sourceReference,
        status: "pending_approval",
        proposedAt: new Date().toISOString(),
        proposedBy: req.session?.userId ?? "unknown",
      };
      await writeWorldTimeRegistry(reg);
      res.json({ id, record: reg[id] });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin APPROVE — the only action that makes an image operationally visible.
  app.post("/api/admin/world-time/images/:id/approve", requireAdmin, async (req, res) => {
    try {
      const id = wtSlugify(String(req.params.id ?? ""));
      const reg = await readWorldTimeRegistry();
      const rec = reg[id];
      if (!rec) return res.status(404).json({ error: "No image proposed for this location" });
      rec.status = "approved";
      rec.approvedAt = new Date().toISOString();
      rec.approvedBy = req.session?.userId ?? "unknown";
      reg[id] = rec;
      await writeWorldTimeRegistry(reg);
      res.json({ id, record: rec });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin REJECT — candidate stays unavailable; fallback gradient remains.
  app.post("/api/admin/world-time/images/:id/reject", requireAdmin, async (req, res) => {
    try {
      const id = wtSlugify(String(req.params.id ?? ""));
      const reg = await readWorldTimeRegistry();
      const rec = reg[id];
      if (!rec) return res.status(404).json({ error: "No image proposed for this location" });
      rec.status = "rejected";
      reg[id] = rec;
      await writeWorldTimeRegistry(reg);
      res.json({ id, record: rec });
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
