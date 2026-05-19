import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { procedureNotes, type NoteType } from "@shared/schema/generatedNotes";
import { procedureEvents } from "@shared/schema/procedureEvents";
import { billingDocumentRequests } from "@shared/schema/billingDocuments";
import {
  appendPatientJourneyEvent,
  getExecutionCaseByScreeningId,
} from "../repositories/executionCase.repo";

// Document-generation request routes. There is no AI/template
// orchestrator wired yet — each route creates or returns the pending
// canonical row (procedure_notes for order/procedure notes,
// billing_document_requests for billing docs) so the workflow surface
// can show "pending generation" without anyone faking a completed
// document. The repos already enforce dedup so re-firing is safe.
//
// When the generator pipeline lands, it should:
//   1. Pick up rows with generationStatus='pending' / requestStatus='pending'.
//   2. Run the template/AI step.
//   3. Update the row to 'generated' and link generatedText / generatedDocumentId.

function sessionUserId(req: Request): string | null {
  const sess = (req as Request & { session?: { userId?: string } }).session;
  return sess?.userId ?? null;
}

const generateBodySchema = z.object({
  serviceType: z.string().optional().nullable(),
  procedureEventId: z.number().int().optional().nullable(),
  note: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
});

type GenerateBody = z.infer<typeof generateBodySchema>;

async function resolveServiceType(
  body: GenerateBody,
  patientScreeningId: number,
): Promise<{ serviceType: string | null; procedureEventId: number | null }> {
  if (body.serviceType && body.serviceType.trim()) {
    return {
      serviceType: body.serviceType.trim(),
      procedureEventId: body.procedureEventId ?? null,
    };
  }
  // Fall back to the most-recent procedure_events row for the patient.
  if (body.procedureEventId != null) {
    const [pe] = await db
      .select()
      .from(procedureEvents)
      .where(eq(procedureEvents.id, body.procedureEventId))
      .limit(1);
    if (pe) return { serviceType: pe.serviceType, procedureEventId: pe.id };
  }
  const [pe] = await db
    .select()
    .from(procedureEvents)
    .where(eq(procedureEvents.patientScreeningId, patientScreeningId))
    .orderBy(desc(procedureEvents.id))
    .limit(1);
  if (pe) return { serviceType: pe.serviceType, procedureEventId: pe.id };
  return { serviceType: null, procedureEventId: null };
}

async function ensurePendingProcedureNote(params: {
  patientScreeningId: number;
  executionCaseId: number | null;
  procedureEventId: number | null;
  serviceType: string;
  noteType: NoteType;
}) {
  const [existing] = await db
    .select()
    .from(procedureNotes)
    .where(
      and(
        eq(procedureNotes.patientScreeningId, params.patientScreeningId),
        eq(procedureNotes.serviceType, params.serviceType),
        eq(procedureNotes.noteType, params.noteType),
      ),
    )
    .limit(1);

  if (existing) {
    if (
      existing.generationStatus === "pending" ||
      existing.generationStatus === "failed" ||
      existing.generationStatus === "generating"
    ) {
      return { row: existing, status: "pending" as const };
    }
    return { row: existing, status: existing.generationStatus };
  }

  const [created] = await db
    .insert(procedureNotes)
    .values({
      patientScreeningId: params.patientScreeningId,
      executionCaseId: params.executionCaseId ?? undefined,
      procedureEventId: params.procedureEventId ?? undefined,
      serviceType: params.serviceType,
      noteType: params.noteType,
      generationStatus: "pending",
      generatedByAi: false,
      sourceData: {},
    })
    .returning();
  return { row: created ?? null, status: "pending" as const };
}

export function registerAncillaryDocumentRequestRoutes(app: Express) {
  // POST /api/ancillary-documents/:patientScreeningId/generate-order-note
  // POST /api/ancillary-documents/:patientScreeningId/generate-procedure-note
  //
  // Body: { serviceType?, procedureEventId?, note?, metadata? }
  // Creates or returns the pending procedure_notes row for this
  // patient + serviceType + noteType. Appends a `document_generation_requested`
  // journey event. Never fakes a generated document.
  async function handleGenerateNote(
    req: Request,
    res: Response,
    noteType: NoteType,
  ) {
    try {
      const patientScreeningId = Number.parseInt(String(req.params.patientScreeningId), 10);
      if (!Number.isFinite(patientScreeningId)) {
        return res.status(400).json({ error: "Invalid patientScreeningId" });
      }
      const parsed = generateBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }

      const patient = await storage.getPatientScreening(patientScreeningId);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      const executionCase = await getExecutionCaseByScreeningId(patientScreeningId);

      const { serviceType, procedureEventId } = await resolveServiceType(
        parsed.data,
        patientScreeningId,
      );
      if (!serviceType) {
        return res.status(400).json({
          error: "serviceType is required and could not be resolved from procedureEventId",
        });
      }

      const ensured = await ensurePendingProcedureNote({
        patientScreeningId,
        executionCaseId: executionCase?.id ?? null,
        procedureEventId,
        serviceType,
        noteType,
      });

      try {
        await appendPatientJourneyEvent({
          patientScreeningId,
          executionCaseId: executionCase?.id,
          patientName: patient.name,
          patientDob: patient.dob ?? undefined,
          eventType: "document_generation_requested",
          eventSource: "ancillary_documents",
          actorUserId: sessionUserId(req),
          summary: `${noteType} generation requested for ${serviceType}`,
          metadata: {
            noteType,
            serviceType,
            procedureEventId,
            requestStatus: ensured.status,
            procedureNoteId: ensured.row?.id ?? null,
            note: parsed.data.note ?? null,
            ...(parsed.data.metadata ?? {}),
          },
        });
      } catch (err: any) {
        console.error("[ancillary-documents] journey event append failed:", err.message);
      }

      return res.json({
        ok: true,
        requestStatus: ensured.status === "generated" ? "already_generated" : "pending",
        procedureNote: ensured.row,
        reason:
          ensured.status === "generated"
            ? "An existing generated note already exists for this patient + service."
            : "Generation pipeline is not yet wired — request recorded as pending.",
      });
    } catch (error: any) {
      console.error("[ancillary-documents] generate-note failed:", error);
      return res.status(500).json({ error: error.message ?? "Failed to record request" });
    }
  }

  app.post("/api/ancillary-documents/:patientScreeningId/generate-order-note", (req, res) =>
    handleGenerateNote(req, res, "order_note"),
  );
  app.post("/api/ancillary-documents/:patientScreeningId/generate-procedure-note", (req, res) =>
    handleGenerateNote(req, res, "post_procedure_note"),
  );

  // POST /api/ancillary-documents/:patientScreeningId/generate-billing-document
  // Creates or returns a pending billing_document_request row. Same
  // honest-not-fake contract: a separate downstream worker is expected
  // to flip requestStatus from `pending` to `generated`.
  app.post(
    "/api/ancillary-documents/:patientScreeningId/generate-billing-document",
    async (req: Request, res: Response) => {
      try {
        const patientScreeningId = Number.parseInt(String(req.params.patientScreeningId), 10);
        if (!Number.isFinite(patientScreeningId)) {
          return res.status(400).json({ error: "Invalid patientScreeningId" });
        }
        const parsed = generateBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
        }
        const patient = await storage.getPatientScreening(patientScreeningId);
        if (!patient) return res.status(404).json({ error: "Patient not found" });
        const executionCase = await getExecutionCaseByScreeningId(patientScreeningId);

        const { serviceType, procedureEventId } = await resolveServiceType(
          parsed.data,
          patientScreeningId,
        );
        if (!serviceType) {
          return res.status(400).json({
            error: "serviceType is required and could not be resolved from procedureEventId",
          });
        }

        const conditions = [
          eq(billingDocumentRequests.patientScreeningId, patientScreeningId),
          eq(billingDocumentRequests.serviceType, serviceType),
        ];
        const [existing] = await db
          .select()
          .from(billingDocumentRequests)
          .where(and(...conditions))
          .orderBy(desc(billingDocumentRequests.id))
          .limit(1);

        let row = existing ?? null;
        let status: "pending" | "already_generated" = "pending";
        if (existing && (existing.requestStatus === "generated" || existing.requestStatus === "sent_to_billing")) {
          status = "already_generated";
        } else if (!existing) {
          const [created] = await db
            .insert(billingDocumentRequests)
            .values({
              executionCaseId: executionCase?.id ?? undefined,
              patientScreeningId,
              procedureEventId: procedureEventId ?? undefined,
              patientName: patient.name,
              patientDob: patient.dob ?? undefined,
              facilityId: patient.facility ?? executionCase?.facilityId ?? undefined,
              serviceType,
              requestStatus: "pending",
              metadata: parsed.data.metadata ?? {},
            })
            .returning();
          row = created ?? null;
        }

        try {
          await appendPatientJourneyEvent({
            patientScreeningId,
            executionCaseId: executionCase?.id,
            patientName: patient.name,
            patientDob: patient.dob ?? undefined,
            eventType: "document_generation_requested",
            eventSource: "ancillary_documents",
            actorUserId: sessionUserId(req),
            summary: `billing_document generation requested for ${serviceType}`,
            metadata: {
              documentKind: "billing_document",
              serviceType,
              procedureEventId,
              billingDocumentRequestId: row?.id ?? null,
              requestStatus: status,
              ...(parsed.data.metadata ?? {}),
            },
          });
        } catch (err: any) {
          console.error("[ancillary-documents] journey event append failed:", err.message);
        }

        return res.json({
          ok: true,
          requestStatus: status,
          billingDocumentRequest: row,
          reason:
            status === "already_generated"
              ? "An existing generated billing document already exists for this patient + service."
              : "Generation pipeline is not yet wired — request recorded as pending.",
        });
      } catch (error: any) {
        console.error("[ancillary-documents] generate-billing-document failed:", error);
        return res.status(500).json({ error: error.message ?? "Failed to record request" });
      }
    },
  );
}
