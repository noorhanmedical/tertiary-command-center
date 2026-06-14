// /api/invoices/* approval endpoints — Phase 4 PR 4.4.
//
// Mounted alongside the legacy invoice routes. Adds:
//   POST /api/invoice-batches/:id/create-drafts
//   POST /api/invoices/:id/submit-for-review
//   POST /api/invoices/:id/approve
//   POST /api/invoices/:id/void
//   POST /api/invoices/:id/revise
//   GET  /api/invoices/:id/audit  (returns approval + delivery state)

import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { createDraftsFromBatch } from "../services/billing/invoiceDraftService";
import { applyApprovalTransition } from "../services/billing/invoiceApprovalService";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { invoices } from "@shared/schema/invoices";

function requireAdminOrBiller(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  const role = req.session.role ?? "";
  if (role !== "admin" && role !== "biller") return res.status(403).json({ error: "Forbidden — admin or biller role required" });
  return next();
}

const voidBody = z.object({ reason: z.string().min(1).max(2048) });
const reviseBody = z.object({ note: z.string().optional() });

export function registerInvoiceApprovalRoutes(app: Express) {
  app.post("/api/invoice-batches/:id/create-drafts", requireAdminOrBiller, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const result = await createDraftsFromBatch(id, req.session?.userId ?? null);
      if (!result.invoiceId) return res.status(409).json({ error: result.reason ?? "could not create drafts" });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/invoices/:id/submit-for-review", requireAdminOrBiller, async (req, res) => {
    return runTransition(req, res, "submit_for_review");
  });
  app.post("/api/invoices/:id/approve", requireAdminOrBiller, async (req, res) => {
    return runTransition(req, res, "approve");
  });
  app.post("/api/invoices/:id/void", requireAdminOrBiller, async (req, res) => {
    const parsed = voidBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
    return runTransition(req, res, "void", parsed.data.reason);
  });
  app.post("/api/invoices/:id/revise", requireAdminOrBiller, async (req, res) => {
    reviseBody.safeParse(req.body); // optional body
    return runTransition(req, res, "revise");
  });

  app.get("/api/invoices/:id/audit", async (req, res) => {
    try {
      if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const [row] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json({
        invoiceId: row.id,
        approvalStatus: (row as any).approvalStatus,
        approvedByUserId: (row as any).approvedByUserId,
        approvedAt: (row as any).approvedAt,
        voidedAt: (row as any).voidedAt,
        voidReason: (row as any).voidReason,
        deliveryStatus: (row as any).deliveryStatus,
        policySnapshot: (row as any).policySnapshot,
        recipientSnapshot: (row as any).recipientSnapshot,
        dueDate: (row as any).dueDate,
        paymentTerms: (row as any).paymentTerms,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

async function runTransition(
  req: Request,
  res: Response,
  transition: "submit_for_review" | "approve" | "void" | "revise",
  reason?: string,
) {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const result = await applyApprovalTransition({
      invoiceId: id,
      transition,
      actorUserId: req.session?.userId ?? null,
      reason: reason ?? null,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
