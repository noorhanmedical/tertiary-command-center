import type { Express } from "express";
import { storage } from "../storage";
import { requirePermission, legacyRequireAdmin } from "../middleware/accessControl";

export function registerAdminRoutes(app: Express) {
  // Phase 3: system-ops view. Migrated to require `platform.settings.view`
  // (platform_admin / technical_admin). Legacy fallback tightens the
  // previously UNGATED endpoint to admin-only.
  app.get("/api/admin/analysis-jobs", requirePermission("platform.settings.view", { legacy: legacyRequireAdmin }), async (req, res) => {
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
