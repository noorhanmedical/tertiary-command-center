// /api/operational-summary — Phase 3 PR 3.8.

import type { Express, Request, Response, NextFunction } from "express";
import { computeOperationalSummary } from "../services/exceptionIntelligence/operationalSummaryService";

function requireAdminOrBiller(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  const role = req.session.role ?? "";
  if (role !== "admin" && role !== "biller") return res.status(403).json({ error: "Forbidden — admin or biller role required" });
  return next();
}

export function registerOperationalSummaryRoutes(app: Express) {
  app.get("/api/operational-summary", requireAdminOrBiller, async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const summary = await computeOperationalSummary({ facilityId: q.facilityId ?? null });
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
