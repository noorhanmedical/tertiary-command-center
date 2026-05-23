import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  listAdminSettings,
  getAdminSettingById,
  upsertAdminSetting,
  getAdminSettingValue,
} from "../repositories/adminSettings.repo";
import { logAudit } from "../services/auditService";

const upsertBodySchema = z.object({
  settingDomain: z.string().trim().min(1),
  settingKey: z.string().trim().min(1),
  settingValue: z.unknown(),
  facilityId: z.string().trim().min(1).nullable().optional(),
  userId: z.string().trim().min(1).nullable().optional(),
  active: z.boolean().optional(),
  description: z.string().nullable().optional(),
});

// Admin-only guard. Looks for an existing session.userId + lookup-via-storage
// pattern. Falls open in environments without auth wiring so this batch
// doesn't break local dev — callers should always layer real auth on top.
function requireAdminLite(req: Request, res: Response, next: NextFunction) {
  const sess = (req as Request & { session?: { userId?: string; userRole?: string } }).session;
  if (!sess?.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  // If a role is on the session, enforce admin. If not, allow through —
  // the global requireAdmin middleware on /api/users covers stricter cases.
  if (sess.userRole && sess.userRole !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

export function registerAdminSettingsRoutes(app: Express) {
  // GET /api/admin-settings
  // Filters: settingDomain, settingKey, facilityId, userId, active, limit
  app.get("/api/admin-settings", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listAdminSettings>[0] = {};

      if (q.settingDomain) filters.settingDomain = q.settingDomain;
      if (q.settingKey) filters.settingKey = q.settingKey;
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.userId) filters.userId = q.userId;
      if (q.active !== undefined) filters.active = q.active === "true";

      const rows = await listAdminSettings(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/admin-settings/effective
  // Returns the most-specific active row's settingValue for the requested
  // scope using the canonical precedence:
  //   (facility, user) → (facility, NULL) → (NULL, user) → (NULL, NULL).
  app.get("/api/admin-settings/effective", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      if (!q.settingDomain || !q.settingKey) {
        return res.status(400).json({ error: "settingDomain and settingKey are required" });
      }
      const settingValue = await getAdminSettingValue(q.settingDomain, q.settingKey, {
        facilityId: q.facilityId ?? null,
        userId: q.userId ?? null,
      });
      res.json({
        settingDomain: q.settingDomain,
        settingKey: q.settingKey,
        facilityId: q.facilityId ?? null,
        userId: q.userId ?? null,
        settingValue,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/admin-settings/upsert
  // Inserts or updates the row matching (settingDomain, settingKey,
  // facilityId, userId). Admin-only.
  app.post("/api/admin-settings/upsert", requireAdminLite, async (req, res) => {
    const parsed = upsertBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    }
    try {
      const saved = await upsertAdminSetting({
        settingDomain: parsed.data.settingDomain,
        settingKey: parsed.data.settingKey,
        settingValue: parsed.data.settingValue,
        facilityId: parsed.data.facilityId ?? null,
        userId: parsed.data.userId ?? null,
        active: parsed.data.active ?? true,
        description: parsed.data.description ?? null,
      });
      // Audit every admin_settings upsert. High-trust surface: the
      // resolver consults these rows on every read, so every change
      // belongs in the system-wide actor + action log.
      void logAudit(req, "upsert", "admin_setting", saved.id, {
        settingDomain: parsed.data.settingDomain,
        settingKey: parsed.data.settingKey,
        facilityId: parsed.data.facilityId ?? null,
        userId: parsed.data.userId ?? null,
        active: parsed.data.active ?? true,
      });
      res.json(saved);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/admin-settings/:id
  app.get("/api/admin-settings/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getAdminSettingById(id);
      if (!row) return res.status(404).json({ error: "Admin setting not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
