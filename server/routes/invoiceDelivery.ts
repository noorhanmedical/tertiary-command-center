// /api/invoice-delivery-queue + delivery actions.
//
// Phase 5 refactor: this route no longer imports drizzle-orm or ../db.
// All reads flow through server/repositories/invoiceDelivery.repo.ts.

import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  queueDelivery, sendEmailDelivery, sendReminderDelivery,
} from "../services/billing/invoiceDeliveryService";
import { sendOutreachEmail } from "../services/emailService";
import {
  listInvoiceDeliveryQueue,
  listDeliveryEventsForInvoice,
  getInvoiceById,
} from "../repositories/invoiceDelivery.repo";

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
  app.get("/api/invoice-delivery-queue", requireAuth, async (_req, res) => {
    try {
      const rows = await listInvoiceDeliveryQueue();
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/invoices/:id/delivery-events", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const rows = await listDeliveryEventsForInvoice(id);
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
      const inv = await getInvoiceById(id);
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
      const inv = await getInvoiceById(id);
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
