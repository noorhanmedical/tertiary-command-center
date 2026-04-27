import type { Express } from "express";
import {
  listCooldownRecords,
  getCooldownRecordById,
} from "../repositories/cooldown.repo";

export function registerCooldownRoutes(app: Express) {
  // GET /api/cooldown-records
  // Filters: executionCaseId, patientScreeningId, facilityId,
  //          serviceType, cooldownStatus, overrideStatus, limit
  app.get("/api/cooldown-records", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listCooldownRecords>[0] = {};

      if (q.executionCaseId) {
        const id = parseInt(q.executionCaseId, 10);
        if (!isNaN(id)) filters.executionCaseId = id;
      }
      if (q.patientScreeningId) {
        const id = parseInt(q.patientScreeningId, 10);
        if (!isNaN(id)) filters.patientScreeningId = id;
      }
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.serviceType) filters.serviceType = q.serviceType;
      if (q.cooldownStatus) filters.cooldownStatus = q.cooldownStatus;
      if (q.overrideStatus) filters.overrideStatus = q.overrideStatus;

      const rows = await listCooldownRecords(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/cooldown-records/:id
  app.get("/api/cooldown-records/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getCooldownRecordById(id);
      if (!row) return res.status(404).json({ error: "Cooldown record not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
