/**
 * Phase 10 — Plexus Bank routes.
 *
 * Read endpoints available to admin + biller roles.
 * Write endpoints (create events, reconcile) require admin.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  createBankEvent,
  listBankEvents,
  getBankEvent,
  getFacilityBalanceSummary,
  reconcileBankEvent,
} from "../repositories/plexusBank.repo";
import { BANK_EVENT_TYPES, COUNTERPARTY_TYPES, RECONCILIATION_STATUSES } from "@shared/schema/plexusBankEvents";

const createEventSchema = z.object({
  clinicId: z.number().int().optional().nullable(),
  facilityId: z.string().max(200).optional().nullable(),
  eventType: z.enum(BANK_EVENT_TYPES),
  eventSubtype: z.string().max(100).optional().nullable(),
  amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Must be a valid decimal amount"),
  currency: z.string().max(3).optional(),
  patientScreeningId: z.number().int().optional().nullable(),
  ancillaryCaseId: z.number().int().optional().nullable(),
  serviceType: z.string().max(100).optional().nullable(),
  invoiceId: z.number().int().optional().nullable(),
  invoicePaymentId: z.number().int().optional().nullable(),
  billingRecordId: z.number().int().optional().nullable(),
  counterpartyType: z.enum(COUNTERPARTY_TYPES).optional().nullable(),
  counterpartyName: z.string().max(200).optional().nullable(),
  reference: z.string().max(500).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
  transactionDate: z.string().min(10).max(10),
});

export function registerPlexusBankRoutes(app: Express) {
  const requireFinanceAccess = (req: Request, res: Response): boolean => {
    const role = req.session.role ?? "";
    if (!["admin", "biller"].includes(role)) {
      res.status(403).json({ error: "Admin or biller access required" });
      return false;
    }
    return true;
  };

  // ─── LIST bank events ────────────────────────────────────────────────────
  app.get("/api/plexus-bank/events", async (req: Request, res: Response) => {
    try {
      if (!requireFinanceAccess(req, res)) return;
      const q = req.query as Record<string, string | undefined>;
      const events = await listBankEvents({
        clinicId: q.clinicId ? parseInt(q.clinicId, 10) : undefined,
        facilityId: q.facilityId || undefined,
        eventType: q.eventType || undefined,
        ancillaryCaseId: q.ancillaryCaseId ? parseInt(q.ancillaryCaseId, 10) : undefined,
        invoiceId: q.invoiceId ? parseInt(q.invoiceId, 10) : undefined,
        reconciliationStatus: q.reconciliationStatus || undefined,
        counterpartyType: q.counterpartyType || undefined,
        limit: q.limit ? parseInt(q.limit, 10) : undefined,
      });
      res.json(events);
    } catch (error: any) {
      console.error("[plexus-bank] list error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to list bank events" });
    }
  });

  // ─── GET single event ────────────────────────────────────────────────────
  app.get("/api/plexus-bank/events/:id", async (req: Request, res: Response) => {
    try {
      if (!requireFinanceAccess(req, res)) return;
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
      const event = await getBankEvent(id);
      if (!event) return res.status(404).json({ error: "Event not found" });
      res.json(event);
    } catch (error: any) {
      console.error("[plexus-bank] get error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to get bank event" });
    }
  });

  // ─── GET facility balance summary ────────────────────────────────────────
  app.get("/api/plexus-bank/summary/:clinicId", async (req: Request, res: Response) => {
    try {
      if (!requireFinanceAccess(req, res)) return;
      const clinicId = parseInt(String(req.params.clinicId), 10);
      if (!Number.isFinite(clinicId)) return res.status(400).json({ error: "Invalid clinic ID" });
      const summary = await getFacilityBalanceSummary(clinicId);
      res.json(summary);
    } catch (error: any) {
      console.error("[plexus-bank] summary error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to get balance summary" });
    }
  });

  // ─── CREATE bank event (admin only) ──────────────────────────────────────
  app.post("/api/plexus-bank/events", async (req: Request, res: Response) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }
      const parsed = createEventSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const event = await createBankEvent({
        ...parsed.data,
        createdByUserId: req.session.userId ?? undefined,
      });
      res.status(201).json(event);
    } catch (error: any) {
      console.error("[plexus-bank] create error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to create bank event" });
    }
  });

  // ─── RECONCILE event (admin only) ────────────────────────────────────────
  app.post("/api/plexus-bank/events/:id/reconcile", async (req: Request, res: Response) => {
    try {
      if (req.session.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid ID" });
      const event = await reconcileBankEvent(id, req.session.userId!);
      if (!event) return res.status(404).json({ error: "Event not found" });
      res.json(event);
    } catch (error: any) {
      console.error("[plexus-bank] reconcile error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to reconcile event" });
    }
  });
}
