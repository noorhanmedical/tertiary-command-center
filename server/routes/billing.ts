import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { db } from "../db";
import { billingRecords } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { InsertBillingRecord } from "../../shared/schema";
import { logAudit } from "../services/auditService";

type BackgroundSyncBilling = () => void | Promise<void>;

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
  deps: { backgroundSyncBilling: BackgroundSyncBilling }
) {
  const { backgroundSyncBilling } = deps;

  app.get("/api/billing-records", async (_req, res) => {
    try {
      const batches = await storage.getAllScreeningBatches();
      const allScreenedPatients: any[] = [];
      for (const batch of batches) {
        const patients = await storage.getPatientScreeningsByBatch(batch.id);
        for (const p of patients) {
          if (p.status === "completed" && p.qualifyingTests && p.qualifyingTests.length > 0) {
            allScreenedPatients.push({ patient: p, batch });
          }
        }
      }

      let billingAutoCreated = 0;
      for (const { patient, batch } of allScreenedPatients) {
        const tests: string[] = patient.qualifyingTests || [];
        for (const test of tests) {
          const existing = await storage.getBillingRecordByPatientAndService(patient.id, test);
          if (!existing) {
            await storage.createBillingRecord({
              patientId: patient.id,
              batchId: batch.id,
              service: test,
              facility: batch.facility || null,
              dateOfService: batch.scheduleDate || null,
              patientName: patient.name,
              clinician: batch.clinicianName || null,
              billingStatus: "Not Billed",
              paidStatus: "Unpaid",
            });
            billingAutoCreated++;
          }
        }
      }

      if (billingAutoCreated > 0) {
        void backgroundSyncBilling();
      }

      const records = await storage.getAllBillingRecords();
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
      void backgroundSyncBilling();
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
      const record = await storage.updateBillingRecord(id, updates);
      if (!record) return res.status(404).json({ error: "Billing record not found" });
      void logAudit(req, "update", "billing_record", id, updates);
      res.json(record);
      void backgroundSyncBilling();
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
      void backgroundSyncBilling();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/billing-records/import-from-sheet", async (_req, res) => {
    try {
      const { readSheetData } = await import("../integrations/googleSheets");
      const { getSetting } = await import("../dbSettings");

      const COL_MAP: Record<number, keyof InsertBillingRecord> = {
        0: "dateOfService",
        1: "service",
        2: "patientName",
        3: "dob",
        4: "mrn",
        5: "clinician",
        6: "insuranceInfo",
        12: "paidAmount",
        13: "insurancePaidAmount",
        14: "secondaryPaidAmount",
        15: "patientResponsibility",
        16: "billingStatus",
        17: "lastBillerUpdate",
        18: "nextAction",
        19: "billingNotes",
      };

      const spreadsheetId = (await getSetting("BILLING_SPREADSHEET_ID")) ||
        (await getSetting("GOOGLE_SHEETS_BILLING_ID")) ||
        process.env.GOOGLE_SHEETS_BILLING_ID || null;

      if (!spreadsheetId) {
        return res.json({ success: true, created: 0, updated: 0, skipped: 0, total: 0, message: "No billing spreadsheet configured." });
      }

      let rows: string[][];
      try {
        rows = await readSheetData(spreadsheetId, "Billing Records");
      } catch (e) {
        return res.status(500).json({ error: `Could not read billing sheet: ${(e as Error).message}` });
      }

      if (rows.length < 2) {
        return res.json({ success: true, created: 0, updated: 0, skipped: 0, total: 0, message: "Sheet has no data rows." });
      }

      const existingRecords = await storage.getAllBillingRecords();
      const seenKeys = new Set<string>(
        existingRecords.map((r) =>
          `${r.patientName.toLowerCase()}|${r.dateOfService ?? ""}|${r.service}`
        )
      );
      let created = 0;
      let updated = 0;
      let skipped = 0;

      type BillingCreateOp = InsertBillingRecord;
      type BillingUpdateOp = { id: number; updates: Partial<InsertBillingRecord> };
      const createOps: BillingCreateOp[] = [];
      const updateOps: BillingUpdateOp[] = [];

      const dataRows = rows.slice(1);

      for (const row of dataRows) {
        const patientName = row[2]?.trim() || "";
        const service = row[1]?.trim() || "";
        if (!patientName || !service) { skipped++; continue; }

        const dateOfService = row[0]?.trim() || null;
        const rowKey = `${patientName.toLowerCase()}|${dateOfService ?? ""}|${service}`;

        const existing = existingRecords.find((r) =>
          r.patientName.toLowerCase() === patientName.toLowerCase() &&
          (r.dateOfService ?? "") === (dateOfService ?? "") &&
          r.service === service
        );

        const updates: Partial<InsertBillingRecord> = {};
        for (const [colStr, field] of Object.entries(COL_MAP)) {
          const val = row[parseInt(colStr)]?.trim() || null;
          (updates as Record<string, string | null>)[field as string] = val;
        }

        if (existing) {
          updateOps.push({ id: existing.id, updates });
          updated++;
        } else if (!seenKeys.has(rowKey)) {
          seenKeys.add(rowKey);
          createOps.push({
            patientId: null,
            batchId: null,
            patientName,
            service,
            dateOfService: updates.dateOfService ?? null,
            dob: updates.dob ?? null,
            mrn: updates.mrn ?? null,
            clinician: updates.clinician ?? null,
            insuranceInfo: updates.insuranceInfo ?? null,
            billingStatus: updates.billingStatus ?? null,
            paidAmount: updates.paidAmount ?? null,
            insurancePaidAmount: updates.insurancePaidAmount ?? null,
            secondaryPaidAmount: updates.secondaryPaidAmount ?? null,
            patientResponsibility: updates.patientResponsibility ?? null,
            lastBillerUpdate: updates.lastBillerUpdate ?? null,
            nextAction: updates.nextAction ?? null,
            billingNotes: updates.billingNotes ?? null,
          });
          created++;
        } else {
          skipped++;
        }
      }

      if (createOps.length > 0 || updateOps.length > 0) {
        await db.transaction(async (tx) => {
          if (createOps.length > 0) {
            await tx.insert(billingRecords).values(createOps);
          }
          for (const { id, updates } of updateOps) {
            await tx.update(billingRecords).set(updates).where(eq(billingRecords.id, id));
          }
        });
      }

      res.json({ success: true, created, updated, skipped, total: created + updated });
    } catch (error: any) {
      console.error("Import from sheet error:", error);
      res.status(500).json({ error: error.message });
    }
  });
}
