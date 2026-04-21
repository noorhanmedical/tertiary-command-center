import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { INVOICE_STATUSES, PAYMENT_METHODS } from "@shared/schema";
import { logAudit } from "../services/auditService";
import { sendOutreachEmail } from "../services/emailService";

const requireBillerOrAdmin = (req: Request, res: Response, next: NextFunction) => {
  const role = req.session?.role;
  if (role !== "admin" && role !== "biller") {
    return res.status(403).json({ error: "Forbidden — requires admin or biller role" });
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

const emailAddress = z.string().trim().email("A valid email address is required.");

// Cap the encoded PDF at ~10 MB (base64 is ~4/3 the size of the bytes it
// encodes, so 14 MB of base64 ≈ 10 MB of PDF). Prevents an authenticated
// user from posting an arbitrarily large attachment.
const MAX_PDF_BASE64_BYTES = 14 * 1024 * 1024;

const sendInvoiceEmailSchema = z.object({
  to: z.array(emailAddress).min(1, "At least one recipient is required."),
  cc: z.array(emailAddress).optional(),
  subject: z.string().trim().min(1, "Subject is required."),
  message: z.string().min(1, "Message is required."),
  pdfBase64: z
    .string()
    .min(1, "Invoice PDF is required.")
    .max(MAX_PDF_BASE64_BYTES, "Invoice PDF is too large to email (max ~10 MB)."),
  pdfFilename: z.string().trim().min(1).optional(),
});

const createPaymentSchema = z.object({
  amount: z.union([z.number(), z.string()]).transform((v) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    if (isNaN(n)) throw new Error("Invalid amount");
    return n;
  }).refine((n) => n > 0, "Amount must be greater than 0"),
  paymentDate: dateString,
  method: z.enum(PAYMENT_METHODS).default("Check"),
  reference: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

function num(v: string | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function userIdOf(req: Request): string | null {
  // Session is the canonical identity source — req.user was a leftover from a
  // passport-style auth that this app never adopted.
  return req.session?.userId ?? null;
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

  app.get("/api/invoices/aging", requireBillerOrAdmin, async (_req, res) => {
    try {
      const all = await storage.getAllInvoices();
      const outstanding = all.filter((i) => num(i.totalBalance) > 0.005);

      const today = new Date();
      const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

      const ageDays = (dateStr: string): number => {
        const parts = dateStr.split("-").map(Number);
        if (parts.length !== 3 || parts.some(isNaN)) return 0;
        const [y, m, d] = parts;
        const t = Date.UTC(y, m - 1, d);
        return Math.floor((todayUtc - t) / 86400000);
      };

      const bucketFor = (days: number): "0-30" | "31-60" | "60+" => {
        if (days <= 30) return "0-30";
        if (days <= 60) return "31-60";
        return "60+";
      };

      const byClinic = new Map<string, {
        facility: string;
        invoiceCount: number;
        totalBalance: number;
        buckets: { "0-30": number; "31-60": number; "60+": number };
        bucketCounts: { "0-30": number; "31-60": number; "60+": number };
      }>();

      const totals = {
        totalBalance: 0,
        invoiceCount: outstanding.length,
        buckets: { "0-30": 0, "31-60": 0, "60+": 0 } as Record<"0-30" | "31-60" | "60+", number>,
        bucketCounts: { "0-30": 0, "31-60": 0, "60+": 0 } as Record<"0-30" | "31-60" | "60+", number>,
      };

      for (const inv of outstanding) {
        const bal = num(inv.totalBalance);
        const days = ageDays(inv.invoiceDate);
        const bucket = bucketFor(days);
        const facility = inv.facility;
        let row = byClinic.get(facility);
        if (!row) {
          row = {
            facility,
            invoiceCount: 0,
            totalBalance: 0,
            buckets: { "0-30": 0, "31-60": 0, "60+": 0 },
            bucketCounts: { "0-30": 0, "31-60": 0, "60+": 0 },
          };
          byClinic.set(facility, row);
        }
        row.invoiceCount += 1;
        row.totalBalance += bal;
        row.buckets[bucket] += bal;
        row.bucketCounts[bucket] += 1;
        totals.totalBalance += bal;
        totals.buckets[bucket] += bal;
        totals.bucketCounts[bucket] += 1;
      }

      const clinics = Array.from(byClinic.values())
        .map((r) => ({
          facility: r.facility,
          invoiceCount: r.invoiceCount,
          totalBalance: r.totalBalance.toFixed(2),
          buckets: {
            "0-30": r.buckets["0-30"].toFixed(2),
            "31-60": r.buckets["31-60"].toFixed(2),
            "60+": r.buckets["60+"].toFixed(2),
          },
          bucketCounts: r.bucketCounts,
        }))
        .sort((a, b) => parseFloat(b.totalBalance) - parseFloat(a.totalBalance));

      res.json({
        clinics,
        totals: {
          totalBalance: totals.totalBalance.toFixed(2),
          invoiceCount: totals.invoiceCount,
          buckets: {
            "0-30": totals.buckets["0-30"].toFixed(2),
            "31-60": totals.buckets["31-60"].toFixed(2),
            "60+": totals.buckets["60+"].toFixed(2),
          },
          bucketCounts: totals.bucketCounts,
        },
      });
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
      const payments = await storage.getInvoicePayments(id);
      res.json({ invoice, lineItems, payments });
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
          initialPaid: totalPaid.toFixed(2),
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

  app.post("/api/invoices/:id/send-email", requireBillerOrAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid invoice id" });

      const parsed = sendInvoiceEmailSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const { to, cc, subject, message, pdfBase64, pdfFilename } = parsed.data;

      const invoice = await storage.getInvoice(id);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });

      // Decode and sanity-check the attached PDF.
      const cleanedB64 = pdfBase64.replace(/^data:application\/pdf;base64,/, "");
      let pdfBuffer: Buffer;
      try {
        pdfBuffer = Buffer.from(cleanedB64, "base64");
      } catch {
        return res.status(400).json({ error: "Invoice PDF could not be decoded." });
      }
      if (pdfBuffer.length === 0) {
        return res.status(400).json({ error: "Invoice PDF is empty." });
      }
      // Quick file-type sanity check: PDFs always start with "%PDF-".
      if (pdfBuffer.slice(0, 5).toString("ascii") !== "%PDF-") {
        return res.status(400).json({ error: "Attached file is not a valid PDF." });
      }

      const safeFacility = invoice.facility.replace(/[^A-Za-z0-9-]+/g, "_");
      const filename = pdfFilename?.trim() || `${invoice.invoiceNumber}_${safeFacility}.pdf`;

      const ccList = cc ?? [];
      const sentToLabel = ccList.length > 0
        ? `${to.join(", ")} (cc: ${ccList.join(", ")})`
        : to.join(", ");

      const result = await sendOutreachEmail({
        to,
        cc: ccList.length > 0 ? ccList : undefined,
        subject,
        body: message,
        attachments: [
          {
            filename,
            content: pdfBuffer,
            contentType: "application/pdf",
          },
        ],
      });

      const updated = await storage.markInvoiceSent(id, sentToLabel);
      void logAudit(req, "send", "invoice", id, {
        to,
        cc: ccList,
        messageId: result.messageId,
      });

      if (!updated) {
        // Email did go out, but the invoice was deleted between the read and
        // the update. Surface a 409 so the UI can refetch and reflect that.
        return res.status(409).json({
          error: "Invoice was removed before it could be marked as Sent.",
          messageId: result.messageId,
        });
      }

      res.json({ ok: true, invoice: updated, messageId: result.messageId });
    } catch (err: any) {
      res.status(502).json({ error: err?.message || "Failed to send invoice email" });
    }
  });

  app.get("/api/invoices/:id/payments", requireBillerOrAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const payments = await storage.getInvoicePayments(id);
      res.json(payments);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/invoices/:id/payments", requireBillerOrAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invoice = await storage.getInvoice(id);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      if (invoice.status === "Draft") {
        return res.status(400).json({ error: "Cannot record payments on a Draft invoice. Mark it as Sent first." });
      }
      const parsed = createPaymentSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      const { amount, paymentDate, method, reference, note } = parsed.data;
      const result = await storage.createInvoicePayment({
        invoiceId: id,
        amount: amount.toFixed(2),
        paymentDate,
        method,
        reference: reference ?? null,
        note: note ?? null,
        recordedByUserId: userIdOf(req),
      });
      void logAudit(req, "create", "invoice_payment", result.payment.id, { invoiceId: id, amount: amount.toFixed(2), method });
      res.status(201).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/invoices/:id/payments/:paymentId", requireBillerOrAdmin, async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.id);
      const paymentId = parseInt(req.params.paymentId);
      if (isNaN(invoiceId) || isNaN(paymentId)) {
        return res.status(400).json({ error: "Invalid invoice or payment id" });
      }
      const result = await storage.deleteInvoicePayment(invoiceId, paymentId);
      if (!result) return res.status(404).json({ error: "Payment not found for this invoice" });
      void logAudit(req, "delete", "invoice_payment", paymentId, { invoiceId });
      res.json(result);
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
