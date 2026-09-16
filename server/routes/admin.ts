import type { Express } from "express";
import { storage } from "../storage";
import { requirePermission, legacyRequireAdmin } from "../middleware/accessControl";
import { errorPhiSafe } from "../lib/phiSafeLogger";

export function registerAdminRoutes(app: Express) {
  // Phase 3: system-ops view. Migrated to require `platform.settings.view`
  // (platform_admin / technical_admin). Legacy fallback tightens the
  // previously UNGATED endpoint to admin-only.
  app.get("/api/admin/analysis-jobs", requirePermission("platform.settings.view", { legacy: legacyRequireAdmin }), async (req, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? "100")), 200);
      const jobs = await storage.getRecentAnalysisJobs(limit);
      // PHI-safe port from main: return an explicit, sanitized projection of
      // each analysis job rather than the raw row. Never expose raw internal
      // failure detail — a failed job surfaces a generic message only.
      res.json(
        jobs.map((job) => ({
          id: job.id,
          batchId: job.batchId,
          batchName: job.batchName,
          status: job.status,
          totalPatients: job.totalPatients,
          completedPatients: job.completedPatients,
          errorMessage: job.status === "failed" ? "Analysis job failed" : null,
          startedAt: job.startedAt,
          completedAt: job.completedAt ?? null,
        })),
      );
    } catch (error: unknown) {
      // PHI-safe: log only a structural tag, never the raw error message.
      errorPhiSafe({ source: "admin_analysis_jobs", op: "tick", outcome: "failed" });
      res.status(500).json({ error: "Failed to fetch analysis job history" });
    }
  });
}
