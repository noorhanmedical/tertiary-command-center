import type { Express } from "express";
import {
  listBillingReadinessChecks,
  getBillingReadinessCheckById,
} from "../repositories/billingReadiness.repo";

export function registerBillingReadinessRoutes(app: Express) {
  // GET /api/billing-readiness-checks
  // Filters: executionCaseId, patientScreeningId, procedureEventId,
  //          serviceType, readinessStatus, limit
  app.get("/api/billing-readiness-checks", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listBillingReadinessChecks>[0] = {};

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
      if (q.serviceType) filters.serviceType = q.serviceType;
      if (q.readinessStatus) filters.readinessStatus = q.readinessStatus;

      const checks = await listBillingReadinessChecks(filters, limit);
      res.json(checks);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/billing-readiness-checks/:id
  app.get("/api/billing-readiness-checks/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const check = await getBillingReadinessCheckById(id);
      if (!check) return res.status(404).json({ error: "Billing readiness check not found" });
      res.json(check);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
