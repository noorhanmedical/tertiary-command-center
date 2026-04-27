import type { Express } from "express";
import {
  listCompletedBillingPackages,
  getCompletedBillingPackageById,
} from "../repositories/completedBillingPackages.repo";

export function registerCompletedBillingPackageRoutes(app: Express) {
  // GET /api/completed-billing-packages
  // Filters: executionCaseId, patientScreeningId, procedureEventId,
  //          billingReadinessCheckId, billingDocumentRequestId,
  //          facilityId, serviceType, packageStatus, paymentStatus, limit
  app.get("/api/completed-billing-packages", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listCompletedBillingPackages>[0] = {};

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
      if (q.billingDocumentRequestId) {
        const id = parseInt(q.billingDocumentRequestId, 10);
        if (!isNaN(id)) filters.billingDocumentRequestId = id;
      }
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.serviceType) filters.serviceType = q.serviceType;
      if (q.packageStatus) filters.packageStatus = q.packageStatus;
      if (q.paymentStatus) filters.paymentStatus = q.paymentStatus;

      const packages = await listCompletedBillingPackages(filters, limit);
      res.json(packages);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/completed-billing-packages/:id
  app.get("/api/completed-billing-packages/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const pkg = await getCompletedBillingPackageById(id);
      if (!pkg) return res.status(404).json({ error: "Completed billing package not found" });
      res.json(pkg);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
