import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { db } from "../db";
import { billingRecords } from "@shared/schema";
import { eq, and, or, ilike, desc } from "drizzle-orm";
import type { InsertBillingRecord } from "../../shared/schema";
import { logAudit } from "../services/auditService";
import { evaluateCaseReadinessGate } from "../services/ancillary/ancillaryReadinessSummary";

// Billing statuses that represent a record being put forward for billing.
// Setting any of these transitions the record past "Not Billed" and is gated
// on document readiness.
const SUBMITTED_BILLING_STATUSES = new Set([
  "submitted",
  "accepted",
  "pending",
  "denied",
  "rejected",
]);

const updateBillingRecordSchema = z.object({
  dateOfService: z.string().nullable().optional(),
  patientName: z.string().min(1).optional(),
  service: z.string().nullable().optional(),
  facility: z.string().nullable().optional(),
  dob: z.string().nullable().optional(),
  mrn: z.string().nullable().optional(),
  clinician: z.string().nullable().optional(),
  insuranceInfo: z.string().nullable().optional(),
  documentationStatus: z.string().nullable().optional(),
  billingStatus: z.string().nullable().optional(),
  response: z.string().nullable().optional(),
  paidStatus: z.string().nullable().optional(),
  balanceRemaining: z.string().nullable().optional(),
  dateSubmitted: z.string().nullable().optional(),
  followUpDate: z.string().nullable().optional(),
  paidAmount: z.string().nullable().optional(),
  insurancePaidAmount: z.string().nullable().optional(),
  secondaryPaidAmount: z.string().nullable().optional(),
  totalCharges: z.string().nullable().optional(),
  allowedAmount: z.string().nullable().optional(),
  patientResponsibility: z.string().nullable().optional(),
  adjustmentAmount: z.string().nullable().optional(),
  lastBillerUpdate: z.string().nullable().optional(),
  nextAction: z.string().nullable().optional(),
  billingNotes: z.string().nullable().optional(),
});

const createBillingRecordSchema = z.object({
  patientId: z.number().int().nullable().optional(),
  batchId: z.number().int().nullable().optional(),
  service: z.string().min(1),
  facility: z.string().nullable().optional(),
  dateOfService: z.string().nullable().optional(),
  patientName: z.string().min(1),
  dob: z.string().nullable().optional(),
  mrn: z.string().nullable().optional(),
  clinician: z.string().nullable().optional(),
  insuranceInfo: z.string().nullable().optional(),
});

const requireBillerOrAdmin = (req: Request, res: Response, next: NextFunction) => {
  const role = req.session?.role;
  if (role !== "admin" && role !== "biller") {
    return res.status(403).json({ error: "Forbidden — requires admin or biller role" });
  }
  return next();
};

export function registerBillingRoutes(
  app: Express,
) {

  // GET /api/billing-records is the auto-create scan: missing billing
  // rows for completed patients with qualifying tests are inserted on
  // every read, then the full billing_records snapshot is returned.
  // Delegated to server/services/billing/billingRecordsService.ts.
  // Response shape, status codes, error envelope, write semantics, and
  // backgroundSyncBilling() fire-and-forget ordering are preserved
  // byte-for-byte; see docs/architecture/backend-route-parity-inventory.md §9.1.
  // The O(batches × patients × tests) scan is intentionally NOT optimized
  // here — orchestrator Batches 14/17 are the venues for that work.
  app.get("/api/billing-records", async (_req, res) => {
    try {
      const { listBillingRecordsWithAutoCreate } = await import(
        "../services/billing/billingRecordsService"
      );
      // Google Drive removal is a Priority 4 product decision; PR keeps the
      // sheet-sync coupling that main ships. Pass a no-op backgroundSyncBilling
      // here so the auto-create scan runs but does not enqueue a Google sync
      // in this preview restore path.
      const records = await listBillingRecordsWithAutoCreate({
        backgroundSyncBilling: () => {},
      });
      res.json(records);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/billing-records/invoice-links", requireBillerOrAdmin, async (_req, res) => {
    try {
      const links = await storage.getBillingRecordInvoiceLinks();
      res.json(links);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Cross-entity command search: match billing records by patient name, MRN,
  // service, or facility. Used by the command-rail Search popup alongside the
  // patient and document searches. Test rows are excluded.
  app.get("/api/billing-records/search", async (req, res) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const limit = Math.min(parseInt(String(req.query.limit ?? "25"), 10) || 25, 100);
      if (q.length === 0) return res.json({ rows: [] });
      const pattern = `%${q}%`;
      const rows = await db
        .select({
          id: billingRecords.id,
          patientName: billingRecords.patientName,
          service: billingRecords.service,
          facility: billingRecords.facility,
          dateOfService: billingRecords.dateOfService,
          mrn: billingRecords.mrn,
          billingStatus: billingRecords.billingStatus,
        })
        .from(billingRecords)
        .where(
          and(
            eq(billingRecords.isTest, false),
            or(
              ilike(billingRecords.patientName, pattern),
              ilike(billingRecords.service, pattern),
              ilike(billingRecords.facility, pattern),
              ilike(billingRecords.mrn, pattern),
            ),
          ),
        )
        .orderBy(desc(billingRecords.createdAt))
        .limit(limit);
      res.json({ rows });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/billing-records", async (req, res) => {
    try {
      const parsed = createBillingRecordSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      const { patientId, batchId, service, facility, patientName, dob, mrn, clinician, insuranceInfo } = parsed.data;
      let { dateOfService } = parsed.data;

      if (!dateOfService && batchId != null) {
        const batch = await storage.getScreeningBatch(batchId);
        if (batch?.scheduleDate) {
          dateOfService = batch.scheduleDate;
        }
      }

      // Document-readiness gate: block billing creation when the case's
      // required readiness items are incomplete. Only evaluated when the
      // record links to a patient screening (so a case is resolvable).
      if (patientId != null) {
        const gate = await evaluateCaseReadinessGate({
          patientScreeningId: patientId,
          serviceType: service,
        });
        if (!gate.ok) {
          return res.status(400).json({
            error: "Document readiness incomplete",
            code: "READINESS_GATE",
            missing: gate.missing,
          });
        }
      }

      const record = await storage.createBillingRecord({
        patientId: patientId ?? null,
        batchId: batchId ?? null,
        service,
        facility: facility ?? null,
        dateOfService: dateOfService ?? null,
        patientName,
        dob: dob ?? null,
        mrn: mrn ?? null,
        clinician: clinician ?? null,
        insuranceInfo: insuranceInfo ?? null,
      });
      void logAudit(req, "create", "billing_record", record.id, { patientName, service });
      res.status(201).json(record);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/billing-records/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const parsed = updateBillingRecordSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      const updates: Partial<InsertBillingRecord> = Object.fromEntries(
        Object.entries(parsed.data).filter(([, v]) => v !== undefined)
      ) as Partial<InsertBillingRecord>;

      // Document-readiness gate on submission: when the billing status is
      // transitioning to a "submitted" state, the case's required readiness
      // items must be complete first.
      if (
        typeof updates.billingStatus === "string" &&
        SUBMITTED_BILLING_STATUSES.has(updates.billingStatus.trim().toLowerCase())
      ) {
        const [existing] = await db
          .select({ patientId: billingRecords.patientId, service: billingRecords.service })
          .from(billingRecords)
          .where(eq(billingRecords.id, id))
          .limit(1);
        if (existing?.patientId != null) {
          const gate = await evaluateCaseReadinessGate({
            patientScreeningId: existing.patientId,
            serviceType: updates.service ?? existing.service,
          });
          if (!gate.ok) {
            return res.status(400).json({
              error: "Document readiness incomplete",
              code: "READINESS_GATE",
              missing: gate.missing,
            });
          }
        }
      }

      const record = await storage.updateBillingRecord(id, updates);
      if (!record) return res.status(404).json({ error: "Billing record not found" });
      void logAudit(req, "update", "billing_record", id, updates);
      res.json(record);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/billing-records/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteBillingRecord(id);
      void logAudit(req, "delete", "billing_record", id, null);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

}
