import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { INVOICE_STATUSES } from "@shared/schema";
import { logAudit } from "../services/auditService";

const requireBillerOrAdmin = (req: Request, res: Response, next: NextFunction) => {
  const role = req.session?.role;
  if (role !== "admin" && role !== "biller") {
    return res.status(403).json({ message: "Forbidden — requires admin or biller role" });
  }
  return next();
};

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

const createInvoiceSchema = z.object({
  facility: z.string().min(1),
  invoiceDate: dateString,
  fromDate: dateString.nullable().optional(),
  toDate: dateString.nullable().optional(),
  notes: z.string().nullable().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(INVOICE_STATUSES),
});

function num(v: string | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function userIdOf(req: Request): string | null {
  const u = (req as Request & { user?: { id?: string } }).user;
  return u?.id ?? null;
}

export function registerInvoiceRoutes(app: Express) {
  app.get("/api/invoices", requireBillerOrAdmin, async (_req, res) => {
    try {
      const rows = await storage.getAllInvoices();
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/invoices/:id", requireBillerOrAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invoice = await storage.getInvoice(id);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      const lineItems = await storage.getInvoiceLineItems(id);
      res.json({ invoice, lineItems });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/invoices", requireBillerOrAdmin, async (req, res) => {
    try {
      const parsed = createInvoiceSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      const { facility, invoiceDate, fromDate, toDate, notes } = parsed.data;

      const records = await storage.getAllBillingRecords();
      const matching = records.filter((r) => {
        if (r.facility !== facility) return false;
        if (fromDate && (!r.dateOfService || r.dateOfService < fromDate)) return false;
        if (toDate && (!r.dateOfService || r.dateOfService > toDate)) return false;
        return true;
      });

      if (matching.length === 0) {
        return res.status(400).json({ error: "No billing records found for this clinic and date range." });
      }

      let totalCharges = 0;
      let totalPaid = 0;
      let totalBalance = 0;

      const lineItems = matching.map((r) => {
        const charges = num(r.totalCharges);
        const paid = num(r.paidAmount) + num(r.insurancePaidAmount) + num(r.secondaryPaidAmount);
        const balance = r.balanceRemaining != null ? num(r.balanceRemaining) : Math.max(0, charges - paid);
        totalCharges += charges;
        totalPaid += paid;
        totalBalance += balance;
        return {
          billingRecordId: r.id,
          patientName: r.patientName,
          dateOfService: r.dateOfService,
          service: r.service,
          mrn: r.mrn,
          clinician: r.clinician,
          totalCharges: charges.toFixed(2),
          paidAmount: paid.toFixed(2),
          balanceRemaining: balance.toFixed(2),
        };
      });

      const invoiceNumber = await storage.getNextInvoiceNumber();

      const invoice = await storage.createInvoiceWithLineItems(
        {
          invoiceNumber,
          facility,
          invoiceDate,
          fromDate: fromDate ?? null,
          toDate: toDate ?? null,
          status: "Draft",
          notes: notes ?? null,
          totalCharges: totalCharges.toFixed(2),
          totalPaid: totalPaid.toFixed(2),
          totalBalance: totalBalance.toFixed(2),
          createdByUserId: userIdOf(req),
        },
        lineItems,
      );

      void logAudit(req, "create", "invoice", invoice.id, { facility, invoiceNumber, lineItemCount: lineItems.length });
      res.status(201).json(invoice);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/invoices/:id/status", requireBillerOrAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = updateStatusSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid status" });
      const updated = await storage.updateInvoiceStatus(id, parsed.data.status);
      if (!updated) return res.status(404).json({ error: "Invoice not found" });
      void logAudit(req, "update", "invoice", id, { status: parsed.data.status });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/invoices/:id", requireBillerOrAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteInvoice(id);
      void logAudit(req, "delete", "invoice", id, null);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
