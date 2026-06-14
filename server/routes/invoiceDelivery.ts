// /api/invoice-delivery-queue + delivery actions — Phase 4 PR 4.5.

import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "../db";
import { eq, desc } from "drizzle-orm";
import { invoices } from "@shared/schema/invoices";
import { invoiceDeliveryEvents } from "@shared/schema/invoiceDelivery";
import {
  queueDelivery, sendEmailDelivery, sendReminderDelivery,
} from "../services/billing/invoiceDeliveryService";
import { sendOutreachEmail } from "../services/emailService";

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

const sendBody = z.object({
  subject: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
});

export function registerInvoiceDeliveryRoutes(app: Express) {
  // GET /api/invoice-delivery-queue — invoices grouped by delivery_status.
  app.get("/api/invoice-delivery-queue", requireAuth, async (req, res) => {
    try {
      const rows = await db.select().from(invoices).orderBy(desc(invoices.createdAt)).limit(500);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/invoices/:id/delivery-events", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const rows = await db.select().from(invoiceDeliveryEvents).where(eq(invoiceDeliveryEvents.invoiceId, id)).orderBy(desc(invoiceDeliveryEvents.createdAt));
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/invoices/:id/queue-delivery", requireAdminOrBiller, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const r = await queueDelivery({ invoiceId: id, actorUserId: req.session?.userId ?? null });
      if (!r.ok) return res.status(r.status).json({ error: r.error });
      res.json(r);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/invoices/:id/send-email", requireAdminOrBiller, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const parsed = sendBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      const [inv] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
      if (!inv) return res.status(404).json({ error: "Invoice not found" });
      const subject = parsed.data.subject ?? `Invoice ${inv.invoiceNumber} — ${inv.facility}`;
      const body = parsed.data.body ?? `Please find your invoice ${inv.invoiceNumber} attached or available for download.`;
      const r = await sendEmailDelivery({
        invoiceId: id,
        actorUserId: req.session?.userId ?? null,
        subject,
        body,
        send: async (params) => {
          const result = await sendOutreachEmail({
            to: params.to,
            subject: params.subject,
            body: params.body,
          });
          return { messageId: result.messageId ?? null };
        },
      });
      if (!r.ok) return res.status(r.status).json({ error: r.error });
      res.json(r);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/invoices/:id/send-reminder", requireAdminOrBiller, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const [inv] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
      if (!inv) return res.status(404).json({ error: "Invoice not found" });
      const subject = `Reminder — invoice ${inv.invoiceNumber}`;
      const body = `This is a reminder that invoice ${inv.invoiceNumber} (balance $${inv.totalBalance}) is outstanding.`;
      const r = await sendReminderDelivery({
        invoiceId: id,
        actorUserId: req.session?.userId ?? null,
        subject,
        body,
        send: async (params) => {
          const result = await sendOutreachEmail({ to: params.to, subject: params.subject, body: params.body });
          return { messageId: result.messageId ?? null };
        },
      });
      if (!r.ok) return res.status(r.status).json({ error: r.error });
      res.json(r);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
