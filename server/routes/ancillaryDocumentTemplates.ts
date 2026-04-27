import type { Express } from "express";
import {
  listAncillaryDocumentTemplates,
  getAncillaryDocumentTemplateById,
} from "../repositories/ancillaryDocumentTemplates.repo";

export function registerAncillaryDocumentTemplateRoutes(app: Express) {
  // GET /api/ancillary-document-templates
  // Filters: serviceType, documentType, documentId, facilityId, active,
  //          isDefault, approvalStatus, required, limit
  app.get("/api/ancillary-document-templates", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listAncillaryDocumentTemplates>[0] = {};

      if (q.serviceType) filters.serviceType = q.serviceType;
      if (q.documentType) filters.documentType = q.documentType;
      if (q.documentId) {
        const id = parseInt(q.documentId, 10);
        if (!isNaN(id)) filters.documentId = id;
      }
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.active !== undefined) filters.active = q.active === "true";
      if (q.isDefault !== undefined) filters.isDefault = q.isDefault === "true";
      if (q.approvalStatus) filters.approvalStatus = q.approvalStatus;
      if (q.required !== undefined) filters.required = q.required === "true";

      const rows = await listAncillaryDocumentTemplates(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/ancillary-document-templates/:id
  app.get("/api/ancillary-document-templates/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getAncillaryDocumentTemplateById(id);
      if (!row) return res.status(404).json({ error: "Ancillary document template not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
