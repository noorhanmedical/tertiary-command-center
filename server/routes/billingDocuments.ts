import type { Express } from "express";
import {
  listBillingDocumentRequests,
  getBillingDocumentRequestById,
} from "../repositories/billingDocuments.repo";

export function registerBillingDocumentRoutes(app: Express) {
  // GET /api/billing-document-requests
  // Filters: executionCaseId, patientScreeningId, procedureEventId,
  //          billingReadinessCheckId, serviceType, requestStatus, limit
  app.get("/api/billing-document-requests", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listBillingDocumentRequests>[0] = {};

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
      if (q.billingReadinessCheckId) {
        const id = parseInt(q.billingReadinessCheckId, 10);
        if (!isNaN(id)) filters.billingReadinessCheckId = id;
      }
      if (q.serviceType) filters.serviceType = q.serviceType;
      if (q.requestStatus) filters.requestStatus = q.requestStatus;

      const requests = await listBillingDocumentRequests(filters, limit);
      res.json(requests);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/billing-document-requests/:id
  app.get("/api/billing-document-requests/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const request = await getBillingDocumentRequestById(id);
      if (!request) return res.status(404).json({ error: "Billing document request not found" });
      res.json(request);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
