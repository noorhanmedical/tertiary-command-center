import type { Express } from "express";
import { storage } from "../storage";
import { getRequestId } from "../middleware/requestObservability";
import { classifyLogSafeError, errorPhiSafe } from "../lib/phiSafeLogger";
import { requirePermission, legacyRequireAdmin } from "../middleware/accessControl";

export function registerAdminRoutes(app: Express) {
  // Phase 3: system-ops view. Migrated to require `platform.settings.view`
  // (platform_admin / technical_admin). Legacy fallback tightens the
  // previously UNGATED endpoint to admin-only.
  app.get("/api/admin/analysis-jobs", requirePermission("platform.settings.view", { legacy: legacyRequireAdmin }), async (req, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? "100")), 200);
      const jobs = await storage.getRecentAnalysisJobs(limit);
      res.json(jobs.map((job) => ({
        id: job.id,
        batchId: job.batchId,
        batchName: job.batchName,
        status: job.status,
        totalPatients: job.totalPatients,
        completedPatients: job.completedPatients,
        errorMessage: job.status === "failed" ? "Analysis job failed" : null,
        startedAt: job.startedAt,
        completedAt: job.completedAt ?? null,
      })));
    } catch (error: unknown) {
      errorPhiSafe({
        source: "batch_analysis",
        operation: "batch_analysis",
        outcome: "failed",
        category: classifyLogSafeError(error),
        requestId: getRequestId(),
      });
      res.status(500).json({ error: "Failed to fetch analysis job history" });
    }
  });
}
