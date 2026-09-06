import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { caseDocumentReadiness } from "@shared/schema/documentReadiness";
import {
  createCaseDocumentReadiness,
  updateCaseDocumentReadiness,
} from "../repositories/documentReadiness.repo";
import { getExecutionCaseById } from "../repositories/executionCase.repo";
import { evaluateBillingReadinessForProcedure } from "../repositories/billingReadiness.repo";
import {
  resolveTeamPortalScope,
  scopeCapabilityForClinic,
} from "../services/teamPortalScope";
import { appendJourneyEvent } from "../services/journey/appendJourneyEvent";
import { saveBlob } from "../services/blobStore";
import {
  READINESS_DOC_INFORMED_CONSENT,
  READINESS_DOC_SCREENING_FORM,
  READINESS_DOC_BRAINWAVE_PDF,
  requirementsForService,
} from "../services/ancillary/ancillaryReadinessSummary";

const ALLOWED_PDF_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Mirrors the global `/api/*` auth gate; readiness mutations require a session.
const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const sess = (req as Request & { session?: { userId?: string } }).session;
  if (!sess?.userId) return res.status(401).json({ error: "Authentication required" });
  return next();
};

function sessionUserId(req: Request): string | null {
  const sess = (req as Request & { session?: { userId?: string } }).session;
  return sess?.userId ?? null;
}

const markBodySchema = z.object({
  itemType: z.enum([READINESS_DOC_INFORMED_CONSENT, READINESS_DOC_SCREENING_FORM]),
  status: z.string().optional(),
  serviceType: z.string().optional().nullable(),
  // Durable per-service ancillary occurrence id, when the client knows it.
  // Stored in readiness metadata so the readiness resolver can bind completion
  // to the exact occurrence (never carried forward across occurrences).
  ancillaryCaseId: z.number().optional().nullable(),
});

/** Resolve the serviceType to persist on the readiness row. Prefer an
 *  explicit body value, fall back to the case's first selected service. */
function resolveServiceType(
  bodyServiceType: string | null | undefined,
  caseServices: string[] | null | undefined,
): string {
  if (bodyServiceType && bodyServiceType.trim()) return bodyServiceType.trim();
  const first = (caseServices ?? []).find((s) => !!s && s.trim());
  return first ?? "ancillary";
}

/** Upsert a case_document_readiness row keyed by
 *  (executionCaseId, serviceType, documentType). */
async function upsertReadiness(params: {
  executionCaseId: number;
  patientScreeningId: number | null;
  /** Canonical procedure OCCURRENCE id (patient_ancillary_cases.id). When
   *  supplied, readiness is keyed to THIS occurrence so two occurrences of the
   *  same service on one execution case never collide (migration 0081). */
  ancillaryCaseId?: number | null;
  patientName: string | null;
  patientDob: string | null;
  facilityId: string | null;
  serviceType: string;
  documentType: string;
  documentStatus: string;
  storageKey?: string | null;
  uploadedByUserId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  // Occurrence-aware dedup: with an occurrence id, match ONLY that occurrence's
  // row; without one, match ONLY legacy NULL-occurrence rows so an occurrence-
  // keyed row is never overwritten by an occurrence-less write (and vice versa).
  const occurrenceId = params.ancillaryCaseId ?? null;
  const [existing] = await db
    .select()
    .from(caseDocumentReadiness)
    .where(
      and(
        eq(caseDocumentReadiness.executionCaseId, params.executionCaseId),
        eq(caseDocumentReadiness.serviceType, params.serviceType),
        eq(caseDocumentReadiness.documentType, params.documentType),
        occurrenceId != null
          ? eq(caseDocumentReadiness.ancillaryCaseId, occurrenceId)
          : isNull(caseDocumentReadiness.ancillaryCaseId),
      ),
    )
    .limit(1);

  const completedAt = new Date();
  const mergedMetadata = {
    ...((existing?.metadata as Record<string, unknown> | null) ?? {}),
    ...(params.metadata ?? {}),
    completionSource: "acs_readiness_action",
  };

  if (existing) {
    return updateCaseDocumentReadiness(existing.id, {
      documentStatus: params.documentStatus,
      storageKey: params.storageKey ?? existing.storageKey ?? undefined,
      uploadedByUserId: params.uploadedByUserId ?? existing.uploadedByUserId ?? undefined,
      completedAt,
      metadata: mergedMetadata,
    });
  }
  return createCaseDocumentReadiness({
    executionCaseId: params.executionCaseId,
    ancillaryCaseId: occurrenceId ?? undefined,
    patientScreeningId: params.patientScreeningId ?? undefined,
    patientName: params.patientName ?? undefined,
    patientDob: params.patientDob ?? undefined,
    facilityId: params.facilityId ?? undefined,
    serviceType: params.serviceType,
    documentType: params.documentType,
    documentStatus: params.documentStatus,
    storageKey: params.storageKey ?? undefined,
    uploadedByUserId: params.uploadedByUserId ?? undefined,
    completedAt,
    metadata: mergedMetadata,
  });
}

/**
 * Per-clinic authorization for a readiness action. The TARGET CLINIC is derived
 * from the execution case (server-owned), NEVER from the client. Admin preserves
 * the existing cross-tenant behavior. A non-admin caller must have the case's
 * facility in their authorized set (team-portal scope); WRITE actions
 * (mark / upload) additionally require ACS capability at that clinic, because
 * consent/screening/report readiness ownership is ACS-only (mirrors
 * procedureEvents.authorizeProcedureCompletion + resolvePortalCapabilities).
 *
 * Returns true when authorized; otherwise writes a 401/403 and returns false.
 * Fails closed when the case has no resolvable facility.
 */
async function authorizeReadinessCase(
  req: Request,
  res: Response,
  ec: { facilityId?: string | null },
  opts: { requireAcs: boolean },
): Promise<boolean> {
  const sess = (req as Request & { session?: { role?: string; userId?: string } }).session;
  // Admin is cross-tenant by design across this app — preserve unchanged.
  if ((sess?.role ?? "") === "admin") return true;

  const userId = sess?.userId ?? null;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  const targetFacility = ec.facilityId ?? null;
  if (!targetFacility) {
    // No resolvable clinic on the case → cannot authorize a non-admin. Fail closed.
    res.status(403).json({ error: "Case clinic not resolvable" });
    return false;
  }
  const scope = await resolveTeamPortalScope(userId);
  if (!scope.authorizedFacilities.includes(targetFacility)) {
    res.status(403).json({ error: "Forbidden — clinic not assigned to this user" });
    return false;
  }
  if (opts.requireAcs) {
    const cap = scopeCapabilityForClinic(scope, targetFacility);
    if (!cap.acs) {
      res.status(403).json({ error: "Not authorized to modify readiness at this clinic" });
      return false;
    }
  }
  return true;
}

export function registerPortalCaseReadinessRoutes(app: Express) {
  // GET /api/portal/case-readiness/:executionCaseId?serviceType=&ancillaryCaseId=
  // Returns the canonical AncillaryReadinessSummary for a single case+service.
  // Reuses buildAncillaryReadinessSummaries (the exact resolver the ancillary
  // schedule uses) so there is ONE source of truth for readiness — this is a
  // read-only projection, not a parallel computation.
  app.get(
    "/api/portal/case-readiness/:executionCaseId",
    requireAuth,
    async (req, res) => {
      try {
        const executionCaseId = parseInt(String(req.params.executionCaseId), 10);
        if (isNaN(executionCaseId)) {
          return res.status(400).json({ error: "Invalid executionCaseId" });
        }
        const ec = await getExecutionCaseById(executionCaseId);
        if (!ec) return res.status(404).json({ error: "Execution case not found" });
        // Clinic scope (read): non-admin must have this case's facility authorized.
        if (!(await authorizeReadinessCase(req, res, ec, { requireAcs: false }))) return;

        const serviceType = resolveServiceType(
          typeof req.query.serviceType === "string" ? req.query.serviceType : null,
          ec.selectedServices,
        );
        const ancillaryCaseId = (() => {
          const raw = req.query.ancillaryCaseId;
          const v = typeof raw === "string" ? parseInt(raw, 10) : NaN;
          return Number.isFinite(v) ? v : null;
        })();

        const { buildAncillaryReadinessSummaries } = await import(
          "../services/ancillary/ancillaryReadinessSummary"
        );
        const summaries = await buildAncillaryReadinessSummaries([
          {
            id: executionCaseId,
            executionCaseId,
            patientScreeningId: ec.patientScreeningId ?? null,
            ancillaryCaseId,
            serviceType,
          },
        ]);
        const readiness = summaries.get(String(executionCaseId)) ?? null;
        return res.json({ readiness });
      } catch (error: any) {
        return res.status(500).json({ error: error.message });
      }
    },
  );

  // POST /api/portal/case-readiness/:executionCaseId/mark
  // Body: { itemType: informed_consent|screening_form, status?, serviceType? }
  // Marks an informed-consent or screening-form readiness item complete.
  app.post(
    "/api/portal/case-readiness/:executionCaseId/mark",
    requireAuth,
    async (req, res) => {
      try {
        const executionCaseId = parseInt(String(req.params.executionCaseId), 10);
        if (isNaN(executionCaseId)) {
          return res.status(400).json({ error: "Invalid executionCaseId" });
        }
        const parsed = markBodySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
        }
        const ec = await getExecutionCaseById(executionCaseId);
        if (!ec) return res.status(404).json({ error: "Execution case not found" });
        // Clinic scope (write): non-admin needs ACS capability at the case's clinic.
        if (!(await authorizeReadinessCase(req, res, ec, { requireAcs: true }))) return;

        const serviceType = resolveServiceType(parsed.data.serviceType, ec.selectedServices);
        const documentStatus = parsed.data.status ?? "completed";

        const row = await upsertReadiness({
          executionCaseId,
          ancillaryCaseId: parsed.data.ancillaryCaseId ?? null,
          patientScreeningId: ec.patientScreeningId ?? null,
          patientName: ec.patientName,
          patientDob: ec.patientDob ?? null,
          facilityId: ec.facilityId ?? null,
          serviceType,
          documentType: parsed.data.itemType,
          documentStatus,
          uploadedByUserId: sessionUserId(req),
          metadata: {
            markedVia: "mark_endpoint",
            ...(parsed.data.ancillaryCaseId != null
              ? { ancillaryCaseId: parsed.data.ancillaryCaseId }
              : {}),
          },
        });

        try {
          await appendJourneyEvent({
            patientName: ec.patientName,
            patientDob: ec.patientDob ?? undefined,
            patientScreeningId: ec.patientScreeningId ?? undefined,
            executionCaseId,
            eventType: "document_completed",
            eventSource: "acs_readiness_action",
            actorUserId: sessionUserId(req),
            summary: `${parsed.data.itemType} → ${documentStatus} (${serviceType})`,
            metadata: { documentType: parsed.data.itemType, serviceType, documentStatus },
          });
        } catch (err: any) {
          console.error("[case-readiness/mark] journey append failed:", err.message);
        }

        try {
          await evaluateBillingReadinessForProcedure({
            executionCaseId,
            patientScreeningId: ec.patientScreeningId ?? null,
            patientName: ec.patientName,
            patientDob: ec.patientDob ?? null,
            facilityId: ec.facilityId ?? null,
            serviceType,
          });
        } catch (err: any) {
          console.error("[case-readiness/mark] billing readiness re-eval failed:", err.message);
        }

        return res.json({ ok: true, caseDocumentReadiness: row });
      } catch (error: any) {
        return res.status(500).json({ error: error.message });
      }
    },
  );

  // POST /api/portal/case-readiness/:executionCaseId/upload-brainwave-pdf
  // Multipart field "file". Stores the BrainWave Result PDF and marks the
  // brainwave_pdf readiness item complete. BrainWave services only.
  app.post(
    "/api/portal/case-readiness/:executionCaseId/upload-brainwave-pdf",
    requireAuth,
    upload.single("file"),
    async (req: Request & { file?: Express.Multer.File }, res: Response) => {
      try {
        const executionCaseId = parseInt(String(req.params.executionCaseId), 10);
        if (isNaN(executionCaseId)) {
          return res.status(400).json({ error: "Invalid executionCaseId" });
        }
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });
        const contentType = req.file.mimetype || "application/octet-stream";
        if (!ALLOWED_PDF_MIME.has(contentType)) {
          return res.status(400).json({ error: `Unsupported file type: ${contentType}` });
        }

        const ec = await getExecutionCaseById(executionCaseId);
        if (!ec) return res.status(404).json({ error: "Execution case not found" });
        // Clinic scope (write): non-admin needs ACS capability at the case's clinic.
        if (!(await authorizeReadinessCase(req, res, ec, { requireAcs: true }))) return;

        const bodyServiceType =
          typeof req.body?.serviceType === "string" ? req.body.serviceType : null;
        const serviceType = resolveServiceType(bodyServiceType, ec.selectedServices);
        const bodyAncillaryCaseId = (() => {
          const raw = req.body?.ancillaryCaseId;
          const v = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
          return Number.isFinite(v) ? v : null;
        })();
        const req2 = requirementsForService(serviceType);
        if (!req2.brainwavePdf) {
          return res.status(400).json({
            error: "BrainWave Result PDF only applies to BrainWave services",
          });
        }

        const blob = await saveBlob({
          ownerType: "brainwave_result",
          ownerId: executionCaseId,
          filename: req.file.originalname || "brainwave-result.pdf",
          contentType,
          buffer: req.file.buffer,
        });

        const row = await upsertReadiness({
          executionCaseId,
          ancillaryCaseId: bodyAncillaryCaseId ?? null,
          patientScreeningId: ec.patientScreeningId ?? null,
          patientName: ec.patientName,
          patientDob: ec.patientDob ?? null,
          facilityId: ec.facilityId ?? null,
          serviceType,
          documentType: READINESS_DOC_BRAINWAVE_PDF,
          documentStatus: "uploaded",
          storageKey: String(blob.id),
          uploadedByUserId: sessionUserId(req),
          metadata: {
            blobId: blob.id,
            filename: req.file.originalname ?? null,
            ...(bodyAncillaryCaseId != null ? { ancillaryCaseId: bodyAncillaryCaseId } : {}),
          },
        });

        try {
          await appendJourneyEvent({
            patientName: ec.patientName,
            patientDob: ec.patientDob ?? undefined,
            patientScreeningId: ec.patientScreeningId ?? undefined,
            executionCaseId,
            eventType: "document_completed",
            eventSource: "acs_readiness_action",
            actorUserId: sessionUserId(req),
            summary: `brainwave_pdf → uploaded (${serviceType})`,
            metadata: { documentType: READINESS_DOC_BRAINWAVE_PDF, serviceType, blobId: blob.id },
          });
        } catch (err: any) {
          console.error("[case-readiness/upload-brainwave-pdf] journey append failed:", err.message);
        }

        return res.json({ ok: true, caseDocumentReadiness: row, blobId: blob.id });
      } catch (error: any) {
        return res.status(500).json({ error: error.message });
      }
    },
  );
}
