import type { Express } from "express";
import { storage } from "../storage";

export function registerAdminRoutes(app: Express) {
  app.get("/api/admin/analysis-jobs", async (req, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? "100")), 200);
      const jobs = await storage.getRecentAnalysisJobs(limit);
      res.json(jobs);
    } catch (error: any) {
      console.error("admin analysis-jobs error:", error.message);
      res.status(500).json({ error: "Failed to fetch analysis job history" });
    }
  });
}
