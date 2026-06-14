// /api/invoice-batches/* — Phase 4 PR 4.3.

import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { buildInvoiceBatchPreview } from "../services/billing/invoiceBatchBuilder";
import {
  listInvoiceBatches, getInvoiceBatchById, listInvoiceBatchItems, updateInvoiceBatchStatus,
} from "../repositories/invoiceBatches.repo";

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

const previewSchema = z.object({
  facilityId: z.string().min(1),
  invoicePeriodStart: z.string().optional().nullable(),
  invoicePeriodEnd: z.string().optional().nullable(),
  cutoffAt: z.string().optional().nullable(),
});

const generateDueSchema = z.object({
  facilityIds: z.array(z.string()).min(1),
});

export function registerInvoiceBatchRoutes(app: Express) {
  app.get("/api/invoice-batches", requireAuth, async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const rows = await listInvoiceBatches({ facilityId: q.facilityId, batchStatus: q.batchStatus }, 200);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/invoice-batches/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const batch = await getInvoiceBatchById(id);
      if (!batch) return res.status(404).json({ error: "Not found" });
      const items = await listInvoiceBatchItems(id);
      res.json({ batch, items });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/invoice-batches/preview", requireAdminOrBiller, async (req, res) => {
    try {
      const parsed = previewSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      const result = await buildInvoiceBatchPreview({
        facilityId: parsed.data.facilityId,
        invoicePeriodStart: parsed.data.invoicePeriodStart ?? null,
        invoicePeriodEnd: parsed.data.invoicePeriodEnd ?? null,
        cutoffAt: parsed.data.cutoffAt ?? null,
        createdByUserId: req.session?.userId ?? null,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/invoice-batches/generate-due", requireAdminOrBiller, async (req, res) => {
    try {
      const parsed = generateDueSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      const results = [];
      for (const facilityId of parsed.data.facilityIds) {
        const r = await buildInvoiceBatchPreview({
          facilityId,
          createdByUserId: req.session?.userId ?? null,
        });
        results.push({ facilityId, ...r });
      }
      res.json({ generated: results.length, results });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/invoice-batches/:id/refresh", requireAdminOrBiller, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const batch = await getInvoiceBatchById(id);
      if (!batch) return res.status(404).json({ error: "Not found" });
      if (batch.batchStatus !== "draft_preview" && batch.batchStatus !== "ready_for_review") {
        return res.status(409).json({ error: `Cannot refresh batch in status "${batch.batchStatus}"` });
      }
      const result = await buildInvoiceBatchPreview({
        facilityId: batch.facilityId,
        invoicePeriodStart: batch.invoicePeriodStart,
        invoicePeriodEnd: batch.invoicePeriodEnd,
        cutoffAt: batch.cutoffAt.toISOString(),
        createdByUserId: req.session?.userId ?? null,
      });
      // PR 4.3 — refresh returns a NEW preview batch. The previous
      // batch is left intact so the audit trail survives. PR 4.7
      // worklist can show both.
      res.json({ newBatchId: result.batchId, ...result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/invoice-batches/:id/void", requireAdminOrBiller, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const updated = await updateInvoiceBatchStatus(id, "voided");
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
