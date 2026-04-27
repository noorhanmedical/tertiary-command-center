import type { Express } from "express";
import {
  listSchedulingTriageCases,
  getSchedulingTriageCaseById,
} from "../repositories/schedulingTriage.repo";

export function registerSchedulingTriageRoutes(app: Express) {
  // GET /api/scheduling-triage-cases
  // Filters: executionCaseId, patientScreeningId, globalScheduleEventId,
  //          facilityId, mainType, subtype, status, assignedUserId,
  //          nextOwnerRole, limit
  app.get("/api/scheduling-triage-cases", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listSchedulingTriageCases>[0] = {};

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
      if (q.mainType) filters.mainType = q.mainType;
      if (q.subtype) filters.subtype = q.subtype;
      if (q.status) filters.status = q.status;
      if (q.assignedUserId) filters.assignedUserId = q.assignedUserId;
      if (q.nextOwnerRole) filters.nextOwnerRole = q.nextOwnerRole;

      const rows = await listSchedulingTriageCases(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/scheduling-triage-cases/:id
  app.get("/api/scheduling-triage-cases/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getSchedulingTriageCaseById(id);
      if (!row) return res.status(404).json({ error: "Scheduling triage case not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
