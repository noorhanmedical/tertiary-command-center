// /api/invoice-readiness/* — Phase 4 PR 4.2.

import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { evaluateInvoiceReadiness } from "../services/billing/invoiceReadinessEngine";
import {
  listInvoiceReadiness,
  upsertInvoiceReadinessSnapshot,
  listEligibleExecutionCasesForFacility,
} from "../repositories/invoiceReadiness.repo";

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

const evaluateBody = z.object({
  executionCaseId: z.number().int().positive(),
  serviceType: z.string().min(1),
});

const evaluateFacilityBody = z.object({
  facilityId: z.string().min(1),
  /** Hard ceiling so a runaway eval can't lock the DB. */
  maxCases: z.number().int().min(1).max(500).optional(),
});

export function registerInvoiceReadinessRoutes(app: Express) {
  app.get("/api/invoice-readiness", requireAuth, async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const filters: Parameters<typeof listInvoiceReadiness>[0] = {};
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.serviceType) filters.serviceType = q.serviceType;
      if (q.readinessStatus) filters.readinessStatus = q.readinessStatus;
      if (q.blockersIncludeAny) filters.blockersIncludeAny = q.blockersIncludeAny.split(",");
      if (q.executionCaseId) {
        const v = parseInt(q.executionCaseId, 10);
        if (!Number.isNaN(v)) filters.executionCaseId = v;
      }
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 200, 500) : 200;
      const rows = await listInvoiceReadiness(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/invoice-readiness/:id", requireAuth, async (req, res) => {
    try {
      const rawId = req.params.id as string;
      const id = parseInt(rawId, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const rows = await listInvoiceReadiness({}, 500);
      const row = rows.find((r) => r.id === id);
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/invoice-readiness/evaluate — single (case, service) eval.
  app.post("/api/invoice-readiness/evaluate", requireAdminOrBiller, async (req, res) => {
    try {
      const parsed = evaluateBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      const ev = await evaluateInvoiceReadiness(parsed.data);
      if (!ev) return res.status(404).json({ error: "Execution case not found" });
      const row = await upsertInvoiceReadinessSnapshot({
        executionCaseId: ev.executionCaseId,
        patientScreeningId: ev.patientScreeningId ?? null,
        procedureEventId: ev.procedureEventId ?? null,
        facilityId: ev.facilityId ?? null,
        serviceType: ev.serviceType,
        patientName: ev.patientName ?? null,
        patientDob: ev.patientDob ?? null,
        readinessStatus: ev.readinessStatus,
        blockers: ev.blockers,
        priceSnapshot: ev.priceSnapshot,
        policySnapshot: ev.policySnapshot,
        unitPrice: ev.unitPrice != null ? String(ev.unitPrice) : null,
        invoiceId: null,
        metadata: { evaluatedBy: req.session?.userId ?? null },
      } as any);
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/invoice-readiness/evaluate-facility — facility sweep.
  app.post("/api/invoice-readiness/evaluate-facility", requireAdminOrBiller, async (req, res) => {
    try {
      const parsed = evaluateFacilityBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      const eligibles = await listEligibleExecutionCasesForFacility(parsed.data.facilityId, parsed.data.maxCases ?? 200);
      const results = [];
      for (const e of eligibles) {
        if (!e.service) continue;
        const ev = await evaluateInvoiceReadiness({ executionCaseId: e.id, serviceType: e.service });
        if (!ev) continue;
        const row = await upsertInvoiceReadinessSnapshot({
          executionCaseId: ev.executionCaseId,
          patientScreeningId: ev.patientScreeningId ?? null,
          procedureEventId: ev.procedureEventId ?? null,
          facilityId: ev.facilityId ?? null,
          serviceType: ev.serviceType,
          patientName: ev.patientName ?? null,
          patientDob: ev.patientDob ?? null,
          readinessStatus: ev.readinessStatus,
          blockers: ev.blockers,
          priceSnapshot: ev.priceSnapshot,
          policySnapshot: ev.policySnapshot,
          unitPrice: ev.unitPrice != null ? String(ev.unitPrice) : null,
          invoiceId: null,
          metadata: { evaluatedBy: req.session?.userId ?? null, batchEval: true },
        } as any);
        results.push(row);
      }
      res.json({ evaluated: results.length, snapshots: results.slice(0, 100) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
