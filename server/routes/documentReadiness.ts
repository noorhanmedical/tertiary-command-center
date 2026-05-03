import type { Express, Request } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { caseDocumentReadiness } from "@shared/schema/documentReadiness";
import {
  listDocumentRequirements,
  getDocumentRequirementById,
  listCaseDocumentReadiness,
  getCaseDocumentReadinessById,
  createCaseDocumentReadiness,
  updateCaseDocumentReadiness,
} from "../repositories/documentReadiness.repo";
import { evaluateBillingReadinessForProcedure } from "../repositories/billingReadiness.repo";
import {
  appendPatientJourneyEvent,
  getExecutionCaseById,
  getExecutionCaseByScreeningId,
} from "../repositories/executionCase.repo";

const COMPLETION_DOCUMENT_TYPES = [
  "informed_consent",
  "screening_form",
  "report",
  "order_note",
  "post_procedure_note",
] as const;

// Per-document-type "passing" status the action writes when the caller
// doesn't supply documentStatus. Mirrors REQUIRED_DOC_RULES in
// billingReadiness.repo so the readiness evaluator considers the doc
// satisfied immediately after this action runs.
const DEFAULT_STATUS_BY_TYPE: Record<typeof COMPLETION_DOCUMENT_TYPES[number], string> = {
  informed_consent: "completed",
  screening_form: "completed",
  report: "uploaded",
  order_note: "generated",
  post_procedure_note: "generated",
};

const completeDocumentBodySchema = z.object({
  executionCaseId: z.number().int().optional().nullable(),
  patientScreeningId: z.number().int().optional().nullable(),
  serviceType: z.string().min(1),
  documentType: z.enum(COMPLETION_DOCUMENT_TYPES),
  documentStatus: z.string().optional().nullable(),
  documentId: z.number().int().optional().nullable(),
  storageKey: z.string().optional().nullable(),
  generatedByAi: z.boolean().optional(),
  uploadedByUserId: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
});

function sessionUserIdFromDocs(req: Request): string | null {
  const sess = (req as Request & { session?: { userId?: string } }).session;
  return sess?.userId ?? null;
}

export function registerDocumentReadinessRoutes(app: Express) {
  // GET /api/document-requirements
  // Filters: serviceType, documentType, facilityId, trigger, active, limit
  app.get("/api/document-requirements", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listDocumentRequirements>[0] = {};

      if (q.serviceType) filters.serviceType = q.serviceType;
      if (q.documentType) filters.documentType = q.documentType;
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.trigger) filters.trigger = q.trigger;
      if (q.active !== undefined) filters.active = q.active === "true";

      const rows = await listDocumentRequirements(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/document-requirements/:id
  app.get("/api/document-requirements/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getDocumentRequirementById(id);
      if (!row) return res.status(404).json({ error: "Document requirement not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/case-document-readiness
  // Filters: executionCaseId, patientScreeningId, facilityId, serviceType,
  //          documentType, documentStatus, blocksBilling, limit
  app.get("/api/case-document-readiness", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 100, 500) : 100;
      const filters: Parameters<typeof listCaseDocumentReadiness>[0] = {};

      if (q.executionCaseId) {
        const id = parseInt(q.executionCaseId, 10);
        if (!isNaN(id)) filters.executionCaseId = id;
      }
      if (q.patientScreeningId) {
        const id = parseInt(q.patientScreeningId, 10);
        if (!isNaN(id)) filters.patientScreeningId = id;
      }
      if (q.facilityId) filters.facilityId = q.facilityId;
      if (q.serviceType) filters.serviceType = q.serviceType;
      if (q.documentType) filters.documentType = q.documentType;
      if (q.documentStatus) filters.documentStatus = q.documentStatus;
      if (q.blocksBilling !== undefined) filters.blocksBilling = q.blocksBilling === "true";

      const rows = await listCaseDocumentReadiness(filters, limit);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/case-document-readiness/:id
  app.get("/api/case-document-readiness/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await getCaseDocumentReadinessById(id);
      if (!row) return res.status(404).json({ error: "Case document readiness not found" });
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/case-document-readiness/complete
  // Body: documentType (informed_consent|screening_form|report|order_note|
  //       post_procedure_note), serviceType, executionCaseId? |
  //       patientScreeningId? (one required), documentStatus?,
  //       storageKey?, documentId?, generatedByAi?, uploadedByUserId?,
  //       note?, metadata?
  // Single action that:
  //   1. Upserts the case_document_readiness row keyed by
  //      (patientScreeningId, serviceType, documentType).
  //   2. Sets documentStatus to caller value or the per-type default
  //      (informed_consent=completed, screening_form=completed,
  //       report=uploaded, order_note=generated, post_procedure_note=generated)
  //      and stamps completedAt.
  //   3. Appends a `document_completed` patient journey event.
  //   4. Re-evaluates billing readiness via
  //      evaluateBillingReadinessForProcedure — when all required docs
  //      pass, that helper auto-creates the pending billing_document_request.
  app.post("/api/case-document-readiness/complete", async (req, res) => {
    try {
      const parsed = completeDocumentBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }
      const data = parsed.data;
      const actorUserId = sessionUserIdFromDocs(req);

      // Resolve execution case + patient context
      let executionCaseId: number | null = data.executionCaseId ?? null;
      let patientScreeningId: number | null = data.patientScreeningId ?? null;
      let executionCase: Awaited<ReturnType<typeof getExecutionCaseById>> | null = null;

      if (executionCaseId !== null) {
        const ec = await getExecutionCaseById(executionCaseId);
        if (ec) {
          executionCase = ec;
          if (patientScreeningId === null) patientScreeningId = ec.patientScreeningId ?? null;
        }
      }
      if (executionCase === null && patientScreeningId !== null) {
        const ec = await getExecutionCaseByScreeningId(patientScreeningId);
        if (ec) {
          executionCase = ec;
          executionCaseId = ec.id;
        }
      }
      if (!executionCase) {
        return res.status(404).json({
          error: "Could not resolve an execution case from executionCaseId or patientScreeningId",
        });
      }

      const finalStatus = data.documentStatus ?? DEFAULT_STATUS_BY_TYPE[data.documentType];

      // Upsert by (patientScreeningId, serviceType, documentType). Falls back
      // to (executionCaseId, serviceType, documentType) when no screening id.
      const dedupConditions = [
        eq(caseDocumentReadiness.serviceType, data.serviceType),
        eq(caseDocumentReadiness.documentType, data.documentType),
      ];
      if (patientScreeningId !== null) {
        dedupConditions.push(eq(caseDocumentReadiness.patientScreeningId, patientScreeningId));
      } else if (executionCaseId !== null) {
        dedupConditions.push(eq(caseDocumentReadiness.executionCaseId, executionCaseId));
      }
      const [existing] = await db
        .select()
        .from(caseDocumentReadiness)
        .where(and(...dedupConditions))
        .limit(1);

      const completedAt = new Date();
      const mergedMetadata = {
        ...((existing?.metadata as Record<string, unknown> | null) ?? {}),
        ...(data.metadata ?? {}),
        note: data.note ?? null,
        completionSource: "document_complete_action",
      };

      let row: Awaited<ReturnType<typeof updateCaseDocumentReadiness>> | undefined;
      if (existing) {
        row = await updateCaseDocumentReadiness(existing.id, {
          documentStatus: finalStatus,
          documentId: data.documentId ?? existing.documentId ?? undefined,
          storageKey: data.storageKey ?? existing.storageKey ?? undefined,
          generatedByAi: data.generatedByAi ?? existing.generatedByAi ?? undefined,
          uploadedByUserId: data.uploadedByUserId ?? existing.uploadedByUserId ?? undefined,
          completedAt,
          metadata: mergedMetadata,
        });
      } else {
        row = await createCaseDocumentReadiness({
          executionCaseId: executionCase.id,
          patientScreeningId: patientScreeningId ?? undefined,
          patientName: executionCase.patientName,
          patientDob: executionCase.patientDob ?? undefined,
          facilityId: executionCase.facilityId ?? undefined,
          serviceType: data.serviceType,
          documentType: data.documentType,
          documentStatus: finalStatus,
          documentId: data.documentId ?? undefined,
          storageKey: data.storageKey ?? undefined,
          generatedByAi: data.generatedByAi ?? undefined,
          uploadedByUserId: data.uploadedByUserId ?? undefined,
          completedAt,
          metadata: mergedMetadata,
        });
      }

      // Append journey event (best-effort)
      let journeyEvent: Awaited<ReturnType<typeof appendPatientJourneyEvent>> | null = null;
      try {
        journeyEvent = await appendPatientJourneyEvent({
          patientName: executionCase.patientName,
          patientDob: executionCase.patientDob ?? undefined,
          patientScreeningId: patientScreeningId ?? executionCase.patientScreeningId ?? undefined,
          executionCaseId: executionCase.id,
          eventType: "document_completed",
          eventSource: "document_complete_action",
          actorUserId,
          summary: `${data.documentType} → ${finalStatus} (${data.serviceType})`,
          metadata: {
            documentType: data.documentType,
            serviceType: data.serviceType,
            documentStatus: finalStatus,
            caseDocumentReadinessId: row?.id ?? null,
            documentId: data.documentId ?? null,
            storageKey: data.storageKey ?? null,
            generatedByAi: data.generatedByAi ?? null,
            note: data.note ?? null,
            ...(data.metadata ?? {}),
          },
        });
      } catch (err: any) {
        console.error("[case-document-readiness/complete] journey event append failed:", err.message);
      }

      // Re-evaluate billing readiness. The helper itself fires
      // createPendingBillingDocumentRequestFromReadiness when readiness
      // becomes ready_to_generate, so no duplicated logic here.
      let billingReadinessCheck: Awaited<ReturnType<typeof evaluateBillingReadinessForProcedure>> | null = null;
      try {
        billingReadinessCheck = await evaluateBillingReadinessForProcedure({
          executionCaseId: executionCase.id,
          patientScreeningId: patientScreeningId ?? executionCase.patientScreeningId ?? null,
          patientName: executionCase.patientName,
          patientDob: executionCase.patientDob ?? null,
          facilityId: executionCase.facilityId ?? null,
          serviceType: data.serviceType,
        });
      } catch (err: any) {
        console.error("[case-document-readiness/complete] billing readiness re-evaluation failed:", err.message);
      }

      return res.json({
        ok: true,
        caseDocumentReadiness: row,
        journeyEvent,
        billingReadinessCheck,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });
}
