// /api/billing-reports/* — Phase 4 PR 4.8.

import type { Express, Request, Response, NextFunction } from "express";
import { buildEodReport, buildWeeklyReport, buildMonthlyReport } from "../services/billing/billingReportService";

function requireAdminOrBiller(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  const role = req.session.role ?? "";
  if (role !== "admin" && role !== "biller") return res.status(403).json({ error: "Forbidden — admin or biller role required" });
  return next();
}

export function registerBillingReportsRoutes(app: Express) {
  app.get("/api/billing-reports/eod", requireAdminOrBiller, async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const date = q.date ? new Date(q.date) : new Date();
      if (Number.isNaN(date.getTime())) return res.status(400).json({ error: "Invalid date" });
      const report = await buildEodReport(date, { facilityId: q.facilityId ?? null });
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/billing-reports/weekly", requireAdminOrBiller, async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const ws = q.weekStart ? new Date(q.weekStart) : new Date();
      if (Number.isNaN(ws.getTime())) return res.status(400).json({ error: "Invalid weekStart" });
      const report = await buildWeeklyReport(ws, { facilityId: q.facilityId ?? null });
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/billing-reports/monthly", requireAdminOrBiller, async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const month = q.month ?? new Date().toISOString().slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "month must be YYYY-MM" });
      const report = await buildMonthlyReport(month, { facilityId: q.facilityId ?? null });
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/billing-reports/facility/:facilityId", requireAdminOrBiller, async (req, res) => {
    try {
      const facilityId = req.params.facilityId as string;
      const today = new Date();
      const [eod, weekly, monthly] = await Promise.all([
        buildEodReport(today, { facilityId }),
        buildWeeklyReport(today, { facilityId }),
        buildMonthlyReport(today.toISOString().slice(0, 7), { facilityId }),
      ]);
      res.json({ facilityId, eod, weekly, monthly });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
