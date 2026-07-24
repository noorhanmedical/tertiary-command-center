/**
 * Phase 2E — canonical Order Note domain foundation.
 *
 * The canonical Order Note is a procedure_notes row (note_type =
 * 'order_note') — Phase 2E REUSES it (never a competing note store) and
 * indexes it in ancillary_document_references. It does NOT generate note
 * content or auto-sign.
 *
 * Signature is UNRESOLVED by default (may be service-specific) — we never
 * fabricate signedAt and never treat the creator as a signer.
 */

import { db } from "../../db";
import { and, eq } from "drizzle-orm";
import { patientJourneyEvents } from "@shared/schema/executionCase";
import { procedureNotes } from "@shared/schema/generatedNotes";
import { featureFlags } from "../../lib/featureFlags";
import {
  ORDER_NOTE_SOURCE_TABLE,
  ANCILLARY_DOCUMENT_JOURNEY_EVENT_TYPES,
  type OrderNoteSignatureRequirement,
} from "@shared/schema/ancillaryDocuments";
import { getAncillaryCaseById } from "../../repositories/ancillaryCases.repo";
import {
  createReference,
  recordAncillaryDocumentFailure,
} from "../../repositories/ancillaryDocuments.repo";
import { evaluateOrderNoteEligibility, type OrderNoteEligibilityResult } from "./orderNoteEligibility";

const AUDIT_SENTINEL_NAME = "[ancillary_document_audit]";

export type CreateOrReuseOrderNoteInput = {
  clinicId: number;
  ancillaryCaseId: number;
  actorUserId?: string | null;
  effectiveClinicalDate?: Date | null;
  source: string;
};

export type CreateOrReuseOrderNoteResult =
  | { status: "skipped_flag_off" }
  | { status: "case_not_found" }
  | { status: "cross_clinic_denied" }
  | { status: "ineligible"; eligibility: OrderNoteEligibilityResult }
  | {
      status: "created" | "reused";
      orderNoteId: number;
      ancillaryCaseId: number;
      serviceType: string;
      signatureRequirement: OrderNoteSignatureRequirement;
      documentStatus: string;
      referenceId?: number;
      referenceDeferred: boolean;
      qualifyingAppointmentId?: number;
    };

async function appendAudit(args: {
  eventType: string;
  patientScreeningId: number | null;
  executionCaseId: number | null;
  actorUserId: string | null;
  source: string;
  summary: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(patientJourneyEvents).values({
      patientName: AUDIT_SENTINEL_NAME,
      patientDob: null,
      patientScreeningId: args.patientScreeningId,
      executionCaseId: args.executionCaseId,
      eventType: args.eventType,
      eventSource: args.source,
      actorUserId: args.actorUserId,
      summary: args.summary,
      metadata: args.metadata,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "warn", source: "ancillary_document", kind: "audit_write_failed",
      eventType: args.eventType, code: (e as { code?: string })?.code,
    }));
  }
}

export async function createOrReuseOrderNote(
  input: CreateOrReuseOrderNoteInput,
): Promise<CreateOrReuseOrderNoteResult> {
  if (!featureFlags.canonicalOrderNote) return { status: "skipped_flag_off" };

  const acase = await getAncillaryCaseById(input.ancillaryCaseId);
  if (!acase) return { status: "case_not_found" };
  if (acase.clinicId !== input.clinicId) return { status: "cross_clinic_denied" };

  const eligibility = await evaluateOrderNoteEligibility({
    clinicId: input.clinicId,
    ancillaryCaseId: input.ancillaryCaseId,
  });

  // Always emit a PHI-free eligibility-evaluated audit event.
  await appendAudit({
    eventType: ANCILLARY_DOCUMENT_JOURNEY_EVENT_TYPES.orderNoteEligibilityEvaluated,
    patientScreeningId: acase.originatingScreeningId ?? null,
    executionCaseId: acase.executionCaseId ?? null,
    actorUserId: input.actorUserId ?? null,
    source: input.source,
    summary: `Order Note eligibility evaluated (${acase.serviceType})`,
    metadata: {
      clinic_id: input.clinicId,
      ancillary_case_id: input.ancillaryCaseId,
      service_type: acase.serviceType,
      admin_review_eligible: eligibility.adminReviewEligible,
      appointment_eligible: eligibility.appointmentEligible,
      eligible: eligibility.eligible,
      reason_codes: eligibility.reasons,
    },
  });

  if (!eligibility.eligible) {
    return { status: "ineligible", eligibility };
  }

  // Create / reuse the canonical Order Note (procedure_notes,
  // note_type='order_note'). Reuse is keyed on (screening|execution
  // case, service). A signed note is returned unchanged — never overwritten.
  const existing = await findExistingOrderNote(acase);
  const note = existing ?? await insertOrderNote(input, acase);
  const reused = existing != null;

  // Signature is UNRESOLVED in Phase 2E-A. Never auto-sign.
  const signatureRequirement: OrderNoteSignatureRequirement = "unresolved";
  const documentStatus = note.signatureStatus === "signed" ? "signed" : "pending_signature";

  // Append the unified Ancillary Documents reference (best-effort with
  // durable retry — the note already exists and must not be lost).
  let referenceId: number | undefined;
  let referenceDeferred = false;
  try {
    const ref = await createReference({
      clinicId: input.clinicId,
      globalPlexusPatientId: acase.globalPlexusPatientId ?? null,
      patientClinicMembershipId: acase.patientClinicMembershipId ?? null,
      patientScreeningId: acase.originatingScreeningId ?? null,
      executionCaseId: acase.executionCaseId ?? null,
      ancillaryCaseId: input.ancillaryCaseId,
      documentKind: "order_note",
      sourceSystem: input.source,
      sourceTable: ORDER_NOTE_SOURCE_TABLE,
      sourceId: note.id,
      serviceType: acase.serviceType,
      documentStatus,
      effectiveClinicalDate: input.effectiveClinicalDate ?? null,
      signedAt: note.signedAt ?? null,
      createdByUserId: input.actorUserId ?? null,
      metadata: {
        qualifying_appointment_id: eligibility.qualifyingAppointmentId ?? null,
        admin_review_status: "approved",
      },
    });
    referenceId = ref.created ? ref.row.id : ref.existing.id;
  } catch (e) {
    referenceDeferred = true;
    try {
      await recordAncillaryDocumentFailure({
        clinicId: input.clinicId,
        ancillaryCaseId: input.ancillaryCaseId,
        patientScreeningId: acase.originatingScreeningId ?? null,
        executionCaseId: acase.executionCaseId ?? null,
        documentKind: "order_note",
        sourceTable: ORDER_NOTE_SOURCE_TABLE,
        sourceId: note.id,
        requestedAction: "link_order_note",
        sourceSystem: input.source,
        errorCode: (e as { code?: string })?.code ?? "reference_failed",
      });
    } catch { /* ledger guard downstream */ }
  }

  await appendAudit({
    eventType: reused
      ? ANCILLARY_DOCUMENT_JOURNEY_EVENT_TYPES.orderNoteReused
      : ANCILLARY_DOCUMENT_JOURNEY_EVENT_TYPES.orderNoteCreated,
    patientScreeningId: acase.originatingScreeningId ?? null,
    executionCaseId: acase.executionCaseId ?? null,
    actorUserId: input.actorUserId ?? null,
    source: input.source,
    summary: `Order Note ${reused ? "reused" : "created"} (${acase.serviceType})`,
    metadata: {
      clinic_id: input.clinicId,
      ancillary_case_id: input.ancillaryCaseId,
      service_type: acase.serviceType,
      source_table: ORDER_NOTE_SOURCE_TABLE,
      source_id: note.id,
      document_reference_id: referenceId ?? null,
      global_schedule_event_id: eligibility.qualifyingAppointmentId ?? null,
      new_status: documentStatus,
      reference_deferred: referenceDeferred,
    },
  });
  if (documentStatus === "pending_signature") {
    await appendAudit({
      eventType: ANCILLARY_DOCUMENT_JOURNEY_EVENT_TYPES.orderNotePendingSignature,
      patientScreeningId: acase.originatingScreeningId ?? null,
      executionCaseId: acase.executionCaseId ?? null,
      actorUserId: input.actorUserId ?? null,
      source: input.source,
      summary: `Order Note pending signature (${acase.serviceType})`,
      metadata: { clinic_id: input.clinicId, ancillary_case_id: input.ancillaryCaseId, source_id: note.id },
    });
  }

  return {
    status: reused ? "reused" : "created",
    orderNoteId: note.id,
    ancillaryCaseId: input.ancillaryCaseId,
    serviceType: acase.serviceType,
    signatureRequirement,
    documentStatus,
    referenceId,
    referenceDeferred,
    qualifyingAppointmentId: eligibility.qualifyingAppointmentId,
  };
}

async function findExistingOrderNote(acase: {
  originatingScreeningId: number | null;
  executionCaseId: number | null;
  serviceType: string;
}): Promise<typeof procedureNotes.$inferSelect | null> {
  const conds = [
    eq(procedureNotes.serviceType, acase.serviceType),
    eq(procedureNotes.noteType, "order_note"),
  ];
  if (acase.originatingScreeningId != null) {
    conds.push(eq(procedureNotes.patientScreeningId, acase.originatingScreeningId));
  } else if (acase.executionCaseId != null) {
    conds.push(eq(procedureNotes.executionCaseId, acase.executionCaseId));
  } else {
    return null;
  }
  const [row] = await db.select().from(procedureNotes).where(and(...conds)).limit(1);
  return row ?? null;
}

async function insertOrderNote(
  input: CreateOrReuseOrderNoteInput,
  acase: {
    clinicId: number;
    originatingScreeningId: number | null;
    executionCaseId: number | null;
    serviceType: string;
  },
): Promise<typeof procedureNotes.$inferSelect> {
  // actual_created_at is server-owned (schema default). We never backdate
  // it. generationStatus stays 'pending' — no content is generated here.
  // signatureStatus 'needs_signature' — unresolved, never auto-signed.
  const [row] = await db
    .insert(procedureNotes)
    .values({
      clinicId: input.clinicId,
      executionCaseId: acase.executionCaseId ?? null,
      patientScreeningId: acase.originatingScreeningId ?? null,
      serviceType: acase.serviceType,
      noteType: "order_note",
      generationStatus: "pending",
      signatureStatus: "needs_signature",
    })
    .returning();
  return row;
}
