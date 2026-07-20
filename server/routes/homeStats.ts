// Home stats route — powers HomeLiveDashboard (Replit V2 restore).
//
// Route file responsibilities: auth + delegation only.
// Aggregation lives in ../services/homeStats/homeStatsService.

import type { Express, Request, Response, NextFunction } from "express";
import { buildHomeStats } from "../services/homeStats/homeStatsService";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  return next();
}

export function registerHomeStatsRoutes(app: Express) {
  app.get("/api/home-stats", requireAuth, async (req, res) => {
    try {
      // clinicContext middleware attaches req.clinicId:
      //   • admin role → req.clinicId = null (Home Stats returns
      //     `sourceMissing: true` for the metrics that need a clinic
      //     scope; admin should use Mission Control for platform-wide).
      //   • other roles → req.clinicId = session clinicId (or null if
      //     unassigned; the service will return sourceMissing for the
      //     tenant-scoped metrics).
      const clinicId = req.clinicId ?? null;
      const stats = await buildHomeStats({ clinicId });
      res.json(stats);
    } catch (error: any) {
      console.error("[home-stats] error:", error?.message ?? error);
      res
        .status(500)
        .json({ error: error?.message ?? "Failed to load home stats" });
    }
  });
}
