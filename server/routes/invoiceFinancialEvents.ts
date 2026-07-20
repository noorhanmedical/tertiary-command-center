// /api/invoices/:id/{payments,adjustments,denials,remittance-events,financial-events} — Phase 4 PR 4.6.

import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "../db";
import { eq, desc } from "drizzle-orm";
import { invoicePayments } from "@shared/schema/invoices";
import {
  invoiceAdjustments, invoiceDenials, remittanceEvents,
} from "@shared/schema/invoiceFinancialEvents";
import {
  postPayment, postAdjustment, postDenial, postRemittanceEvent, patchDenialStatus,
} from "../services/billing/invoiceFinancialService";

function requireAdminOrBiller(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  const role = req.session.role ?? "";
  if (role !== "admin" && role !== "biller") return res.status(403).json({ error: "Forbidden — admin or biller role required" });
  return next();
}
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: "Not authenticated" });
  return next();
}

// paymentDate is stored as text on invoice_payments and consumed by
// text-range comparisons in the Home Stats finance sum. Enforce the
// YYYY-MM-DD shape at the boundary so a caller cannot poison the
// column with "01/05/2025" (which would then be excluded from every
// range query silently).
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const paymentBody = z.object({
  amount: z.number().positive(),
  paymentDate: z
    .string()
    .regex(ISO_DATE_RE, "paymentDate must be YYYY-MM-DD")
    .optional()
    .nullable(),
  paymentMethod: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
const adjustmentBody = z.object({
  lineItemId: z.number().int().optional().nullable(),
  adjustmentType: z.enum(["write_off", "contractual", "correction", "discount", "dispute_hold", "manual"]),
  amount: z.number(),
  reason: z.string().optional().nullable(),
});
const denialBody = z.object({
  lineItemId: z.number().int().optional().nullable(),
  denialCode: z.string().optional().nullable(),
  denialReason: z.string().optional().nullable(),
  payer: z.string().optional().nullable(),
  nextActionAt: z.string().optional().nullable(),
});
const remittanceBody = z.object({
  payer: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  amount: z.number().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
});
const denialPatchBody = z.object({
  status: z.enum(["open", "appealed", "overturned", "upheld", "closed"]),
});

export function registerInvoiceFinancialRoutes(app: Express) {
  app.post("/api/invoices/:id/payments", requireAdminOrBiller, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const parsed = paymentBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      const r = await postPayment({ invoiceId: id, actorUserId: req.session?.userId ?? null, ...parsed.data } as any);
      if ("error" in r) return res.status(r.status).json({ error: r.error });
      res.json(r);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/invoices/:id/adjustments", requireAdminOrBiller, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const parsed = adjustmentBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      const r = await postAdjustment({ invoiceId: id, actorUserId: req.session?.userId ?? null, ...parsed.data } as any);
      if ("error" in r) return res.status(r.status).json({ error: r.error });
      res.json(r);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/invoices/:id/denials", requireAdminOrBiller, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const parsed = denialBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      const r = await postDenial({ invoiceId: id, actorUserId: req.session?.userId ?? null, ...parsed.data } as any);
      if ("error" in r) return res.status(r.status).json({ error: r.error });
      res.json(r);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/invoices/:id/remittance-events", requireAdminOrBiller, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const parsed = remittanceBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      const r = await postRemittanceEvent({ invoiceId: id, actorUserId: req.session?.userId ?? null, ...parsed.data } as any);
      res.json(r);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/invoices/:id/financial-events", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const [payments, adjustments, denials, remittances] = await Promise.all([
        db.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, id)).orderBy(desc(invoicePayments.createdAt)),
        db.select().from(invoiceAdjustments).where(eq(invoiceAdjustments.invoiceId, id)).orderBy(desc(invoiceAdjustments.createdAt)),
        db.select().from(invoiceDenials).where(eq(invoiceDenials.invoiceId, id)).orderBy(desc(invoiceDenials.createdAt)),
        db.select().from(remittanceEvents).where(eq(remittanceEvents.invoiceId, id)).orderBy(desc(remittanceEvents.createdAt)),
      ]);
      res.json({ payments, adjustments, denials, remittances });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/denials/:id/status", requireAdminOrBiller, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const parsed = denialPatchBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      const r = await patchDenialStatus(id, parsed.data.status, req.session?.userId ?? null);
      if ("error" in r) return res.status(r.status).json({ error: r.error });
      res.json(r);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
