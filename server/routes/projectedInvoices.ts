import type { Express } from "express";
import {
  listProjectedInvoiceRows,
  getProjectedInvoiceRowById,
} from "../repositories/projectedInvoices.repo";

export function registerProjectedInvoiceRoutes(app: Express) {
  // GET /api/projected-invoice-rows
  // Filters: executionCaseId, patientScreeningId, procedureEventId,
  //          facilityId, serviceType, projectedStatus, realInvoiceLineItemId, limit
  app.get("/api/projected-invoice-rows", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listProjectedInvoiceRows>[0] = {};

      if (q.executionCaseId) {
        const id = parseInt(q.executionCaseId, 10);
        if (!isNaN(id)) filters.executionCaseId = id;
      }
      if (q.patientScreeningId) {
        const id = parseInt(q.patientScreeningId, 10);
        if (!isNaN(id)) filters.patientScreeningId = id;
      }
      if (q.procedureEventId) {
        const id = parseInt(q.procedureEventId, 10);
        if (!isNaN(id)) filters.procedureEventId = id;
      }
      if (q.realInvoiceLineItemId) {
        const id = parseInt(q.realInvoiceLineItemId, 10);
        if (!isNaN(id)) filters.realInvoiceLineItemId = id;
      }
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.serviceType) filters.serviceType = q.serviceType;
      if (q.projectedStatus) filters.projectedStatus = q.projectedStatus;

      const rows = await listProjectedInvoiceRows(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/projected-invoice-rows/:id
  app.get("/api/projected-invoice-rows/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getProjectedInvoiceRowById(id);
      if (!row) return res.status(404).json({ error: "Projected invoice row not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
