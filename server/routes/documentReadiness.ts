import type { Express } from "express";
import {
  listDocumentRequirements,
  getDocumentRequirementById,
  listCaseDocumentReadiness,
  getCaseDocumentReadinessById,
} from "../repositories/documentReadiness.repo";

export function registerDocumentReadinessRoutes(app: Express) {
  // GET /api/document-requirements
  // Filters: serviceType, documentType, facilityId, trigger, active, limit
  app.get("/api/document-requirements", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listDocumentRequirements>[0] = {};

      if (q.serviceType) filters.serviceType = q.serviceType;
      if (q.documentType) filters.documentType = q.documentType;
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.trigger) filters.trigger = q.trigger;
      if (q.active !== undefined) filters.active = q.active === "true";

      const rows = await listDocumentRequirements(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/document-requirements/:id
  app.get("/api/document-requirements/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getDocumentRequirementById(id);
      if (!row) return res.status(404).json({ error: "Document requirement not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/case-document-readiness
  // Filters: executionCaseId, patientScreeningId, facilityId, serviceType,
  //          documentType, documentStatus, blocksBilling, limit
  app.get("/api/case-document-readiness", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listCaseDocumentReadiness>[0] = {};

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
      if (q.documentType) filters.documentType = q.documentType;
      if (q.documentStatus) filters.documentStatus = q.documentStatus;
      if (q.blocksBilling !== undefined) filters.blocksBilling = q.blocksBilling === "true";

      const rows = await listCaseDocumentReadiness(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/case-document-readiness/:id
  app.get("/api/case-document-readiness/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getCaseDocumentReadinessById(id);
      if (!row) return res.status(404).json({ error: "Case document readiness not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
