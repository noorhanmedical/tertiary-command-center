import type { Express } from "express";
import {
  listCashPriceSettings,
  getCashPriceSettingById,
} from "../repositories/cashPricing.repo";

export function registerCashPricingRoutes(app: Express) {
  // GET /api/cash-price-settings
  // Filters: serviceType, facilityId, payerType, active, limit
  app.get("/api/cash-price-settings", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listCashPriceSettings>[0] = {};

      if (q.serviceType) filters.serviceType = q.serviceType;
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.payerType) filters.payerType = q.payerType;
      if (q.active !== undefined) filters.active = q.active === "true";

      const settings = await listCashPriceSettings(filters, limit);
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/cash-price-settings/:id
  app.get("/api/cash-price-settings/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const setting = await getCashPriceSettingById(id);
      if (!setting) return res.status(404).json({ error: "Cash price setting not found" });
      res.json(setting);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
