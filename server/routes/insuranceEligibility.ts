import type { Express } from "express";
import {
  listInsuranceEligibilityReviews,
  getInsuranceEligibilityReviewById,
} from "../repositories/insuranceEligibility.repo";

export function registerInsuranceEligibilityRoutes(app: Express) {
  // GET /api/insurance-eligibility-reviews
  // Filters: executionCaseId, patientScreeningId, facilityId,
  //          eligibilityStatus, approvalStatus, priorityClass,
  //          insuranceType, limit
  app.get("/api/insurance-eligibility-reviews", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listInsuranceEligibilityReviews>[0] = {};

      if (q.executionCaseId) {
        const id = parseInt(q.executionCaseId, 10);
        if (!isNaN(id)) filters.executionCaseId = id;
      }
      if (q.patientScreeningId) {
        const id = parseInt(q.patientScreeningId, 10);
        if (!isNaN(id)) filters.patientScreeningId = id;
      }
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.eligibilityStatus) filters.eligibilityStatus = q.eligibilityStatus;
      if (q.approvalStatus) filters.approvalStatus = q.approvalStatus;
      if (q.priorityClass) filters.priorityClass = q.priorityClass;
      if (q.insuranceType) filters.insuranceType = q.insuranceType;

      const rows = await listInsuranceEligibilityReviews(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/insurance-eligibility-reviews/:id
  app.get("/api/insurance-eligibility-reviews/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getInsuranceEligibilityReviewById(id);
      if (!row) return res.status(404).json({ error: "Insurance eligibility review not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
