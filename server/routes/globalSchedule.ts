import type { Express } from "express";
import {
  listGlobalScheduleEvents,
  getGlobalScheduleEventById,
} from "../repositories/globalSchedule.repo";

export function registerGlobalScheduleRoutes(app: Express) {
  // GET /api/global-schedule-events
  // Filters: facilityId, eventType, status, assignedUserId, assignedRole,
  //          executionCaseId, patientScreeningId, startDate, endDate, limit
  app.get("/api/global-schedule-events", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listGlobalScheduleEvents>[0] = {};

      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.eventType) filters.eventType = q.eventType;
      if (q.status) filters.status = q.status;
      if (q.assignedUserId) filters.assignedUserId = q.assignedUserId;
      if (q.assignedRole) filters.assignedRole = q.assignedRole;
      if (q.executionCaseId) {
        const id = parseInt(q.executionCaseId, 10);
        if (!isNaN(id)) filters.executionCaseId = id;
      }
      if (q.patientScreeningId) {
        const id = parseInt(q.patientScreeningId, 10);
        if (!isNaN(id)) filters.patientScreeningId = id;
      }
      if (q.startDate) {
        const d = new Date(q.startDate);
        if (!isNaN(d.getTime())) filters.startDate = d;
      }
      if (q.endDate) {
        const d = new Date(q.endDate);
        if (!isNaN(d.getTime())) filters.endDate = d;
      }

      const rows = await listGlobalScheduleEvents(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/global-schedule-events/:id
  app.get("/api/global-schedule-events/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getGlobalScheduleEventById(id);
      if (!row) return res.status(404).json({ error: "Global schedule event not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
