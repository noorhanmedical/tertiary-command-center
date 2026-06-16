// /api/exceptions/* — Phase 3 PR 3.2 + PR 3.3.

import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { evaluateExceptions } from "../services/exceptionIntelligence/exceptionSnapshotEngine";
import { listExceptions, getException } from "../repositories/exceptionSnapshots.repo";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  return next();
}

function requireAdminOrBiller(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  const role = req.session.role ?? "";
  if (role !== "admin" && role !== "biller") return res.status(403).json({ error: "Forbidden — admin or biller role required" });
  return next();
}

const evalBody = z.object({
  facilityId: z.string().optional().nullable(),
  testType: z.string().optional().nullable(),
});

export function registerExceptionsRoutes(app: Express) {
  app.get("/api/exceptions", requireAuth, async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const filters: Parameters<typeof listExceptions>[0] = {};
      if (q.status) filters.status = q.status.includes(",") ? q.status.split(",") : q.status;
      if (q.severity) filters.severity = q.severity.includes(",") ? q.severity.split(",") : q.severity;
      if (q.exceptionType) filters.exceptionType = q.exceptionType.includes(",") ? q.exceptionType.split(",") : q.exceptionType;
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.ownerRole) filters.ownerRole = q.ownerRole;
      if (q.executionCaseId) filters.executionCaseId = parseInt(q.executionCaseId, 10);
      if (q.invoiceId) filters.invoiceId = parseInt(q.invoiceId, 10);
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 200, 1000) : 200;
      const rows = await listExceptions(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/exceptions/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getException(id);
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/exceptions/evaluate", requireAdminOrBiller, async (req, res) => {
    try {
      const parsed = evalBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      const result = await evaluateExceptions({ facilityId: parsed.data.facilityId ?? null, testType: parsed.data.testType ?? null });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/exceptions/evaluate-facility", requireAdminOrBiller, async (req, res) => {
    try {
      const parsed = z.object({ facilityId: z.string().min(1) }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      const result = await evaluateExceptions({ facilityId: parsed.data.facilityId });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/exceptions/evaluate-all-safe", requireAdminOrBiller, async (_req, res) => {
    try {
      const result = await evaluateExceptions();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
