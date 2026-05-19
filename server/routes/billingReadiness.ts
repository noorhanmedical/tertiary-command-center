import type { Express, Request } from "express";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  listBillingReadinessChecks,
  getBillingReadinessCheckById,
  evaluateBillingReadinessForProcedure,
} from "../repositories/billingReadiness.repo";
import { procedureEvents } from "@shared/schema/procedureEvents";
import { storage } from "../storage";
import {
  appendPatientJourneyEvent,
  getExecutionCaseById,
  getExecutionCaseByScreeningId,
} from "../repositories/executionCase.repo";

function sessionUserId(req: Request): string | null {
  const sess = (req as Request & { session?: { userId?: string } }).session;
  return sess?.userId ?? null;
}

export function registerBillingReadinessRoutes(app: Express) {
  // GET /api/billing-readiness-checks
  // Filters: executionCaseId, patientScreeningId, procedureEventId,
  //          serviceType, readinessStatus, limit
  app.get("/api/billing-readiness-checks", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listBillingReadinessChecks>[0] = {};

      if (q.executionCaseId) {
        const id = parseInt(q.executionCaseId, 10);
        if (!isNaN(id)) filters.executionCaseId = id;
      }
      if (q.patientScreeningId) {
        const id = parseInt(q.patientScreeningId, 10);
        if (!isNaN(id)) filters.patientScreeningId = id;
      }
      if (q.procedureEventId) {
        const id = parseInt(q.procedureEventId, 10);
        if (!isNaN(id)) filters.procedureEventId = id;
      }
      if (q.serviceType) filters.serviceType = q.serviceType;
      if (q.readinessStatus) filters.readinessStatus = q.readinessStatus;

      const checks = await listBillingReadinessChecks(filters, limit);
      res.json(checks);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/billing-readiness-checks/:id
  app.get("/api/billing-readiness-checks/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const check = await getBillingReadinessCheckById(id);
      if (!check) return res.status(404).json({ error: "Billing readiness check not found" });
      res.json(check);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/billing-readiness-checks/recompute
  // Body: { patientScreeningId?, executionCaseId?, procedureEventId?, serviceType? }
  //
  // Wraps `evaluateBillingReadinessForProcedure` (the same helper the
  // document-readiness routes already call) with an explicit
  // recompute action. Resolves the executionCase/procedureEvent from
  // the provided ids and records a `billing_readiness_recomputed`
  // journey event so the audit trail has the manual trigger separate
  // from the side-effect re-evaluations.
  const recomputeSchema = z.object({
    patientScreeningId: z.number().int().optional().nullable(),
    executionCaseId: z.number().int().optional().nullable(),
    procedureEventId: z.number().int().optional().nullable(),
    serviceType: z.string().min(1).optional().nullable(),
    reason: z.string().optional().nullable(),
  });

  app.post("/api/billing-readiness-checks/recompute", async (req, res) => {
    try {
      const parsed = recomputeSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const data = parsed.data;
      const actorUserId = sessionUserId(req);

      // Resolve executionCase + serviceType + procedureEvent.
      let executionCase: Awaited<ReturnType<typeof getExecutionCaseById>> | null = null;
      let executionCaseId: number | null = data.executionCaseId ?? null;
      let patientScreeningId: number | null = data.patientScreeningId ?? null;
      let serviceType: string | null = data.serviceType ?? null;
      let procedureEventId: number | null = data.procedureEventId ?? null;

      if (procedureEventId != null) {
        const [pe] = await db
          .select()
          .from(procedureEvents)
          .where(eq(procedureEvents.id, procedureEventId))
          .limit(1);
        if (pe) {
          if (executionCaseId === null) executionCaseId = pe.executionCaseId ?? null;
          if (patientScreeningId === null) patientScreeningId = pe.patientScreeningId ?? null;
          if (!serviceType) serviceType = pe.serviceType;
        }
      }
      if (executionCaseId !== null) {
        executionCase = await getExecutionCaseById(executionCaseId);
        if (executionCase && patientScreeningId === null) {
          patientScreeningId = executionCase.patientScreeningId ?? null;
        }
      }
      if (executionCase === null && patientScreeningId !== null) {
        executionCase = await getExecutionCaseByScreeningId(patientScreeningId);
      }
      if (!executionCase) {
        return res.status(404).json({
          error: "Could not resolve an execution case from procedureEventId, executionCaseId, or patientScreeningId",
        });
      }

      if (!serviceType) {
        // Fall back to the most-recent procedure for this patient
        if (patientScreeningId != null) {
          const [pe] = await db
            .select()
            .from(procedureEvents)
            .where(eq(procedureEvents.patientScreeningId, patientScreeningId))
            .orderBy(desc(procedureEvents.id))
            .limit(1);
          if (pe) {
            serviceType = pe.serviceType;
            if (procedureEventId === null) procedureEventId = pe.id;
          }
        }
      }
      if (!serviceType) {
        return res.status(400).json({
          error: "serviceType is required and could not be resolved",
        });
      }

      const check = await evaluateBillingReadinessForProcedure({
        executionCaseId: executionCase.id,
        patientScreeningId: patientScreeningId ?? executionCase.patientScreeningId ?? null,
        procedureEventId,
        patientName: executionCase.patientName,
        patientDob: executionCase.patientDob ?? null,
        facilityId: executionCase.facilityId ?? null,
        serviceType,
      });

      try {
        // Optional patient context for the journey event
        const patient = patientScreeningId != null
          ? await storage.getPatientScreening(patientScreeningId).catch(() => null)
          : null;
        await appendPatientJourneyEvent({
          patientScreeningId: patientScreeningId ?? executionCase.patientScreeningId ?? undefined,
          executionCaseId: executionCase.id,
          patientName: patient?.name ?? executionCase.patientName ?? undefined,
          patientDob: patient?.dob ?? executionCase.patientDob ?? undefined,
          eventType: "billing_readiness_recomputed",
          eventSource: "billing_readiness_recompute",
          actorUserId,
          summary: `Billing readiness recomputed for ${serviceType} → ${check.readinessStatus}`,
          metadata: {
            serviceType,
            billingReadinessCheckId: check.id,
            readinessStatus: check.readinessStatus,
            missingRequirements: check.missingRequirements,
            procedureEventId,
            reason: data.reason ?? null,
          },
        });
      } catch (err: any) {
        console.error("[billing-readiness/recompute] journey event append failed:", err.message);
      }

      return res.json({ ok: true, billingReadinessCheck: check });
    } catch (error: any) {
      console.error("[billing-readiness/recompute] failed:", error);
      return res.status(500).json({ error: error.message ?? "Failed to recompute" });
    }
  });
}
