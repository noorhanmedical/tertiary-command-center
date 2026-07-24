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
import { and, desc, eq, isNull } from "drizzle-orm";
import { patientJourneyEvents } from "@shared/schema/executionCase";
import { procedureNotes } from "@shared/schema/generatedNotes";
import { patientAncillaryCases } from "@shared/schema/ancillaryCases";
import { ancillaryCaseAdminReviewEvents } from "@shared/schema/adminReviewEvents";
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
      // A legacy screening/service Order Note exists but cannot be
      // deterministically associated with exactly one ancillary case. We
      // NEVER auto-attach it to the newest/first case; durable retry is
      // recorded and the caller sees a truthful deferred result.
      status: "deferred_legacy_ambiguous";
      ancillaryCaseId: number;
      serviceType: string;
      reason: "multiple_candidate_cases" | "multiple_legacy_notes";
      legacyNoteIds: number[];
    }
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
      adminReviewEventId?: number;
      // TRUE when admin_review_status is 'approved' but the immutable
      // ancillary_case_admin_review_events row is not yet resolvable
      // (migration/backfill state). We surface a warning and NEVER
      // fabricate an event id.
      adminReviewEvidenceDeferred: boolean;
      adoptedLegacy: boolean;
      warnings: string[];
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

  // Immutable Admin Review evidence: the applicable approved event id.
  // adminReviewStatus === 'approved' is the current-eligibility signal
  // (already enforced above); the event id is the permanent evidence
  // link. If it is not resolvable (migration/backfill state) we warn and
  // NEVER fabricate an id.
  const adminReviewEventId = await findApprovedAdminReviewEventId(input.ancillaryCaseId);
  const adminReviewEvidenceDeferred = adminReviewEventId == null;
  const warnings: string[] = [];
  if (adminReviewEvidenceDeferred) warnings.push("admin_review_event_link_unavailable");
  const qId = eligibility.qualifyingAppointmentId ?? null;

  // Canonical Order Note identity is (ancillary_case_id, note_type). We
  // reuse the CURRENT (non-superseded) case-scoped note or create one —
  // NEVER reuse solely by screening+service (that collides across
  // episodes). A signed note is returned unchanged — never overwritten.
  let note = await findCaseScopedOrderNote(input.ancillaryCaseId);
  let reused = note != null;
  let adoptedLegacy = false;

  if (!note) {
    // No case-scoped note. Consider legacy screening/service Order Notes
    // that predate case linkage. Attach ONLY when deterministic.
    const legacy = await findLegacyUnlinkedOrderNotes(acase);
    if (legacy.length > 1) {
      await recordLegacyLinkRetry(input, acase, "legacy_notes_multiple");
      return {
        status: "deferred_legacy_ambiguous", ancillaryCaseId: input.ancillaryCaseId,
        serviceType: acase.serviceType, reason: "multiple_legacy_notes",
        legacyNoteIds: legacy.map((r) => r.id),
      };
    }
    if (legacy.length === 1) {
      const candidateCaseCount = await countCandidateCasesForLegacy(acase);
      if (candidateCaseCount !== 1) {
        // Multiple ancillary cases share this legacy note's identity — we
        // cannot know which case owns it. Defer + retry; never guess.
        await recordLegacyLinkRetry(input, acase, "legacy_note_ambiguous_case");
        return {
          status: "deferred_legacy_ambiguous", ancillaryCaseId: input.ancillaryCaseId,
          serviceType: acase.serviceType, reason: "multiple_candidate_cases",
          legacyNoteIds: legacy.map((r) => r.id),
        };
      }
      // Exactly one candidate case → deterministic. Adopt via a
      // LINK-ONLY update (never touches body/signature/signedAt/signer).
      note = await adoptLegacyOrderNote(legacy[0].id, input, acase, qId, adminReviewEventId);
      reused = true;
      adoptedLegacy = true;
    } else {
      note = await insertOrderNote(input, acase, qId, adminReviewEventId);
      reused = false;
    }
  }

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
        admin_review_event_id: adminReviewEventId ?? null,
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
      admin_review_event_id: adminReviewEventId ?? null,
      admin_review_evidence_deferred: adminReviewEvidenceDeferred,
      adopted_legacy: adoptedLegacy,
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
    adminReviewEventId: adminReviewEventId ?? undefined,
    adminReviewEvidenceDeferred,
    adoptedLegacy,
    warnings,
  };
}

type AncillaryCaseShape = {
  clinicId: number;
  globalPlexusPatientId: number | null;
  patientClinicMembershipId: number | null;
  originatingScreeningId: number | null;
  executionCaseId: number | null;
  serviceType: string;
};

/** The CURRENT (non-superseded) canonical Order Note for this case. */
async function findCaseScopedOrderNote(
  ancillaryCaseId: number,
): Promise<typeof procedureNotes.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(procedureNotes)
    .where(and(
      eq(procedureNotes.ancillaryCaseId, ancillaryCaseId),
      eq(procedureNotes.noteType, "order_note"),
      isNull(procedureNotes.supersededAt),
    ))
    .limit(1);
  return row ?? null;
}

/** Legacy order_note rows for the same screening|execution + service that
 *  predate case linkage (ancillary_case_id NULL, not superseded). */
async function findLegacyUnlinkedOrderNotes(
  acase: AncillaryCaseShape,
): Promise<Array<typeof procedureNotes.$inferSelect>> {
  const conds = [
    eq(procedureNotes.serviceType, acase.serviceType),
    eq(procedureNotes.noteType, "order_note"),
    isNull(procedureNotes.ancillaryCaseId),
    isNull(procedureNotes.supersededAt),
  ];
  if (acase.originatingScreeningId != null) {
    conds.push(eq(procedureNotes.patientScreeningId, acase.originatingScreeningId));
  } else if (acase.executionCaseId != null) {
    conds.push(eq(procedureNotes.executionCaseId, acase.executionCaseId));
  } else {
    return [];
  }
  return db.select().from(procedureNotes).where(and(...conds)).limit(5);
}

/** How many ancillary cases share this legacy note's identity? A legacy
 *  note is deterministically ownable only when the answer is exactly 1. */
async function countCandidateCasesForLegacy(acase: AncillaryCaseShape): Promise<number> {
  const conds = [
    eq(patientAncillaryCases.clinicId, acase.clinicId),
    eq(patientAncillaryCases.serviceType, acase.serviceType),
  ];
  if (acase.originatingScreeningId != null) {
    conds.push(eq(patientAncillaryCases.originatingScreeningId, acase.originatingScreeningId));
  } else if (acase.executionCaseId != null) {
    conds.push(eq(patientAncillaryCases.executionCaseId, acase.executionCaseId));
  } else {
    return 0;
  }
  const rows = await db.select({ id: patientAncillaryCases.id }).from(patientAncillaryCases).where(and(...conds)).limit(3);
  return rows.length;
}

/** The applicable approved immutable Admin Review event id, or null. */
async function findApprovedAdminReviewEventId(ancillaryCaseId: number): Promise<number | null> {
  const [row] = await db
    .select({ id: ancillaryCaseAdminReviewEvents.id })
    .from(ancillaryCaseAdminReviewEvents)
    .where(and(
      eq(ancillaryCaseAdminReviewEvents.ancillaryCaseId, ancillaryCaseId),
      eq(ancillaryCaseAdminReviewEvents.newStatus, "approved"),
    ))
    .orderBy(desc(ancillaryCaseAdminReviewEvents.actualReviewedAt))
    .limit(1);
  return row?.id ?? null;
}

async function recordLegacyLinkRetry(
  input: CreateOrReuseOrderNoteInput,
  acase: AncillaryCaseShape,
  errorCode: string,
): Promise<void> {
  try {
    await recordAncillaryDocumentFailure({
      clinicId: input.clinicId,
      ancillaryCaseId: input.ancillaryCaseId,
      patientScreeningId: acase.originatingScreeningId ?? null,
      executionCaseId: acase.executionCaseId ?? null,
      documentKind: "order_note",
      sourceTable: ORDER_NOTE_SOURCE_TABLE,
      requestedAction: "link_order_note",
      sourceSystem: input.source,
      errorCode,
    });
  } catch { /* ledger guard downstream */ }
}

/** Deterministic legacy adoption: LINK-ONLY update. Never touches the
 *  clinical body, signature status, signedAt, or signer. */
async function adoptLegacyOrderNote(
  id: number,
  input: CreateOrReuseOrderNoteInput,
  acase: AncillaryCaseShape,
  qualifyingGlobalScheduleEventId: number | null,
  adminReviewEventId: number | null,
): Promise<typeof procedureNotes.$inferSelect> {
  const [row] = await db
    .update(procedureNotes)
    .set({
      ancillaryCaseId: input.ancillaryCaseId,
      globalPlexusPatientId: acase.globalPlexusPatientId ?? null,
      patientClinicMembershipId: acase.patientClinicMembershipId ?? null,
      qualifyingGlobalScheduleEventId: qualifyingGlobalScheduleEventId ?? null,
      adminReviewEventId: adminReviewEventId ?? null,
      effectiveClinicalDate: input.effectiveClinicalDate ?? null,
      updatedAt: new Date(),
    })
    .where(eq(procedureNotes.id, id))
    .returning();
  return row;
}

async function insertOrderNote(
  input: CreateOrReuseOrderNoteInput,
  acase: AncillaryCaseShape,
  qualifyingGlobalScheduleEventId: number | null,
  adminReviewEventId: number | null,
): Promise<typeof procedureNotes.$inferSelect> {
  // actual created_at is server-owned (schema default). We never backdate
  // it. generationStatus stays 'pending' — no content is generated here.
  // signatureStatus 'needs_signature' — unresolved, never auto-signed.
  // Identity is anchored to the ancillary case (+ evidence links).
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
      ancillaryCaseId: input.ancillaryCaseId,
      globalPlexusPatientId: acase.globalPlexusPatientId ?? null,
      patientClinicMembershipId: acase.patientClinicMembershipId ?? null,
      qualifyingGlobalScheduleEventId: qualifyingGlobalScheduleEventId ?? null,
      adminReviewEventId: adminReviewEventId ?? null,
      effectiveClinicalDate: input.effectiveClinicalDate ?? null,
    })
    .returning();
  return row;
}
