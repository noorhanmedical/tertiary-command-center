import type { Express } from "express";
import { z } from "zod";
import {
  listProcedureEvents,
  getProcedureEventById,
  markProcedureComplete,
  listUltrasoundTechCompletedProcedures,
} from "../repositories/procedureEvents.repo";
import { updateGlobalScheduleEvent } from "../repositories/globalSchedule.repo";

const procedureCompleteSchema = z.object({
  serviceType: z.string().min(1, "serviceType is required"),
  executionCaseId: z.number().int().optional().nullable(),
  patientScreeningId: z.number().int().optional().nullable(),
  globalScheduleEventId: z.number().int().optional().nullable(),
  patientName: z.string().optional().nullable(),
  patientDob: z.string().optional().nullable(),
  facilityId: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  completedAt: z.string().datetime({ offset: true }).optional().nullable(),
});

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

  // POST /api/procedure-events/complete
  app.post("/api/procedure-events/complete", async (req, res) => {
    try {
      const parsed = procedureCompleteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const { completedAt, globalScheduleEventId, ...rest } = parsed.data;

      const { procedureEvent, documentRows } = await markProcedureComplete({
        ...rest,
        globalScheduleEventId: globalScheduleEventId ?? undefined,
        completedAt: completedAt ? new Date(completedAt) : undefined,
        completedByUserId: req.session?.userId ?? undefined,
      });

      if (globalScheduleEventId != null) {
        void updateGlobalScheduleEvent(globalScheduleEventId, { status: "completed" }).catch((err) => {
          console.error("[procedureEvents.route] global schedule update failed:", err);
        });
      }

      return res.status(201).json({ procedureEvent, documentReadinessRows: documentRows });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  // GET /api/ultrasound-tech/completed-procedures
  // Filters: completedByUserId, facilityId, serviceType, procedureStatus,
  //          startDate, endDate, limit
  // Defaults to procedureStatus="complete" and ultrasound-relevant service
  // types when no explicit overrides are provided. Ordered by completedAt DESC.
  app.get("/api/ultrasound-tech/completed-procedures", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listUltrasoundTechCompletedProcedures>[0] = {};
      if (q.completedByUserId) filters.completedByUserId = q.completedByUserId;
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.serviceType) filters.serviceType = q.serviceType;
      if (q.procedureStatus) filters.procedureStatus = q.procedureStatus;
      if (q.startDate) {
        const d = new Date(q.startDate);
        if (!isNaN(d.getTime())) filters.startDate = d;
      }
      if (q.endDate) {
        const d = new Date(q.endDate);
        if (!isNaN(d.getTime())) filters.endDate = d;
      }
      const rows = await listUltrasoundTechCompletedProcedures(filters, limit);
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
