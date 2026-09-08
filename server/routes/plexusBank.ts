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
import { requirePermission, legacyRequireAdmin, legacyRequireAnyRole, permissionEnforcementEnabled, ensureAccessContext } from "../middleware/accessControl";
import { clinicOrganizationId } from "../services/access/accessAdminService";

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
  // Phase 3.5: Plexus Bank is FINANCE. Reads → finance.view; writes →
  // finance.manage. Enforcement OFF → legacy fallback preserves prior behavior
  // (reads admin|biller, writes admin). NOTE: per-clinic financial scope for
  // org-scoped finance roles requires clinic→org resolution — deferred to
  // Phase 4 (capability is enforced here; see report).
  const requireFinanceView = requirePermission("finance.view", { legacy: legacyRequireAnyRole("admin", "biller") });
  const requireFinanceManage = requirePermission("finance.manage", { legacy: legacyRequireAdmin });

  // ─── LIST bank events ────────────────────────────────────────────────────
  app.get("/api/plexus-bank/events", requireFinanceView, async (req: Request, res: Response) => {
    try {
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
  app.get("/api/plexus-bank/events/:id", requireFinanceView, async (req: Request, res: Response) => {
    try {
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
  app.get("/api/plexus-bank/summary/:clinicId", requireFinanceView, async (req: Request, res: Response) => {
    try {
      const clinicId = parseInt(String(req.params.clinicId), 10);
      if (!Number.isFinite(clinicId)) return res.status(400).json({ error: "Invalid clinic ID" });
      // Phase 4A: organization-scope enforcement via PERSISTED clinic→org
      // ownership. An org-scoped finance user may read a clinic's balances only
      // when that clinic belongs to their organization (or is in clinic scope).
      if (permissionEnforcementEnabled()) {
        const actor = await ensureAccessContext(req);
        if (actor && !actor.scope.platform) {
          const orgId = await clinicOrganizationId(clinicId);
          const inOrg = orgId != null && actor.scope.organizationIds.includes(orgId);
          const inClinic = actor.scope.clinicIds.includes(clinicId);
          if (!inOrg && !inClinic) return res.status(403).json({ error: "Forbidden — clinic outside your organization scope" });
        }
      }
      const summary = await getFacilityBalanceSummary(clinicId);
      res.json(summary);
    } catch (error: any) {
      console.error("[plexus-bank] summary error:", error?.message ?? error);
      res.status(500).json({ error: "Failed to get balance summary" });
    }
  });

  // ─── CREATE bank event (admin only) ──────────────────────────────────────
  app.post("/api/plexus-bank/events", requireFinanceManage, async (req: Request, res: Response) => {
    try {
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
  app.post("/api/plexus-bank/events/:id/reconcile", requireFinanceManage, async (req: Request, res: Response) => {
    try {
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
