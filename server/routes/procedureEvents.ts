import type { Express } from "express";
import {
  listProcedureEvents,
  getProcedureEventById,
} from "../repositories/procedureEvents.repo";

export function registerProcedureEventRoutes(app: Express) {
  // GET /api/procedure-events
  // Filters: executionCaseId, patientScreeningId, globalScheduleEventId,
  //          facilityId, serviceType, procedureStatus, limit
  app.get("/api/procedure-events", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listProcedureEvents>[0] = {};

      if (q.executionCaseId) {
        const id = parseInt(q.executionCaseId, 10);
        if (!isNaN(id)) filters.executionCaseId = id;
      }
      if (q.patientScreeningId) {
        const id = parseInt(q.patientScreeningId, 10);
        if (!isNaN(id)) filters.patientScreeningId = id;
      }
      if (q.globalScheduleEventId) {
        const id = parseInt(q.globalScheduleEventId, 10);
        if (!isNaN(id)) filters.globalScheduleEventId = id;
      }
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.serviceType) filters.serviceType = q.serviceType;
      if (q.procedureStatus) filters.procedureStatus = q.procedureStatus;

      const rows = await listProcedureEvents(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/procedure-events/:id
  app.get("/api/procedure-events/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getProcedureEventById(id);
      if (!row) return res.status(404).json({ error: "Procedure event not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
