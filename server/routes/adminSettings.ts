import type { Express } from "express";
import {
  listAdminSettings,
  getAdminSettingById,
} from "../repositories/adminSettings.repo";

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
