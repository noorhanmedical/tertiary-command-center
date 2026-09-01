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
  ancillaryDocumentReferences,
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
      // When evidence was deferred, whether the durable retry ledger row was
      // actually persisted. FALSE means the ledger write itself failed — we
      // do NOT overstate reconciliation durability (warning + audit emitted).
      // Meaningless (false) when evidence was not deferred.
      adminReviewEvidenceRetryRecorded: boolean;
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

  // Admin Review evidence retry: the case is approved and a qualifying
  // appointment exists (eligible), but the immutable
  // ancillary_case_admin_review_events row is not yet resolvable. The Order
  // Note remains eligible and is created/reused, but we do NOT fabricate an
  // adminReviewEventId — we record a durable, PHI-free reconciliation
  // failure so a later retry links the evidence once it surfaces. The note
  // id is known now, so the retry can target exactly this note. If that
  // ledger write itself fails we surface it truthfully (never pretend the
  // reconciliation is durably queued when no row exists).
  let adminReviewEvidenceRetryRecorded = false;
  if (adminReviewEvidenceDeferred) {
    adminReviewEvidenceRetryRecorded = await recordAdminReviewEvidenceRetry(input, acase, note.id);
    if (!adminReviewEvidenceRetryRecorded) {
      warnings.push("admin_review_evidence_retry_not_recorded");
      await appendAudit({
        eventType: ANCILLARY_DOCUMENT_JOURNEY_EVENT_TYPES.evidenceRetryNotRecorded,
        patientScreeningId: acase.originatingScreeningId ?? null,
        executionCaseId: acase.executionCaseId ?? null,
        actorUserId: input.actorUserId ?? null,
        source: input.source,
        summary: `Order Note admin-review evidence retry NOT recorded (${acase.serviceType})`,
        metadata: {
          clinic_id: input.clinicId,
          ancillary_case_id: input.ancillaryCaseId,
          service_type: acase.serviceType,
          source_table: ORDER_NOTE_SOURCE_TABLE,
          source_id: note.id,
          error_code: ADMIN_REVIEW_EVENT_LINK_MISSING,
          retry_recorded: false,
        },
      });
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
      // Preserve the SOURCE note's creation instant, not the index time.
      actualCreatedAt: note.createdAt ?? null,
      createdByUserId: input.actorUserId ?? null,
      metadata: {
        qualifying_appointment_id: eligibility.qualifyingAppointmentId ?? null,
        admin_review_status: "approved",
        admin_review_event_id: adminReviewEventId ?? null,
      },
    });
    if (ref.outcome === "created") {
      referenceId = ref.row.id;
    } else if (ref.outcome === "reused_exact_source_unchanged" || ref.outcome === "reused_exact_source_updated") {
      referenceId = ref.existing.id;
    } else {
      // active_kind_conflict / source_clinic_conflict / source_case_conflict /
      // synchronization_conflict: NEVER attach the new note to another owner's
      // reference id. Defer to a reviewed supersession via a source-specific
      // retry keyed to this exact note.
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
          errorCode: ref.outcome,
        });
      } catch { /* ledger guard downstream */ }
    }
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
    adminReviewEvidenceRetryRecorded,
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

/** Durable error code for a deferred Admin Review evidence link. */
export const ADMIN_REVIEW_EVENT_LINK_MISSING = "ADMIN_REVIEW_EVENT_LINK_MISSING";

/**
 * Record a PHI-free durable retry to link the immutable Admin Review event
 * once it becomes resolvable. Never blocks Order Note creation, but — unlike
 * a swallow-everything guard — returns whether the ledger row was actually
 * persisted so the caller can report reconciliation durability truthfully.
 */
async function recordAdminReviewEvidenceRetry(
  input: CreateOrReuseOrderNoteInput,
  acase: AncillaryCaseShape,
  orderNoteId: number,
): Promise<boolean> {
  try {
    await recordAncillaryDocumentFailure({
      clinicId: input.clinicId,
      ancillaryCaseId: input.ancillaryCaseId,
      patientScreeningId: acase.originatingScreeningId ?? null,
      executionCaseId: acase.executionCaseId ?? null,
      documentKind: "order_note",
      sourceTable: ORDER_NOTE_SOURCE_TABLE,
      sourceId: orderNoteId,
      requestedAction: "link_order_note_evidence",
      sourceSystem: input.source,
      errorCode: ADMIN_REVIEW_EVENT_LINK_MISSING,
    });
    return true;
  } catch (e) {
    // Surface, do not swallow: emit a PHI-free structured log line and
    // report failure to the caller (which warns + audits).
    console.error(JSON.stringify({
      level: "error", source: "ancillary_document", kind: "evidence_retry_record_failed",
      clinic_id: input.clinicId, ancillary_case_id: input.ancillaryCaseId,
      source_id: orderNoteId, code: (e as { code?: string })?.code ?? "ledger_write_failed",
    }));
    return false;
  }
}

export type OrderNoteEvidenceRetryResult =
  | { status: "skipped_flag_off" }
  | { status: "still_deferred" }
  | { status: "cross_clinic_denied" }
  | { status: "note_case_mismatch" }
  | { status: "note_not_found" }
  | { status: "reference_update_failed" }
  | { status: "linked"; adminReviewEventId: number; orderNoteId: number };

export type OrderNoteEvidenceRetryInput = {
  clinicId: number;
  ancillaryCaseId: number | null;
  sourceId: number | null;
};

// Tagged tx error so the outer handler can distinguish which write failed.
class EvidenceRetryTxError extends Error {
  constructor(public kind: "note" | "reference") { super(kind); }
}

/**
 * Retry worker entry point: link the approved immutable Admin Review event
 * to an Order Note whose evidence link was deferred.
 *
 * FULLY TENANT-VALIDATED — nothing is updated by sourceId alone. Before any
 * write it verifies the case exists and is same-clinic; the note exists, is
 * same-clinic, belongs to the SAME ancillary case, is note_type=order_note,
 * and is not superseded; the approved review event belongs to that exact
 * case; and — when a reference exists — it belongs to the same clinic, case,
 * source note id, and documentKind=order_note. The note-evidence update and
 * the reference-metadata update are applied ATOMICALLY (single transaction);
 * a reference failure rolls back the note link and returns
 * reference_update_failed so the reconciliation stays unresolved. LINK-ONLY:
 * never the note body, signature, signedAt, or signer.
 *
 * Requires BOTH FEATURE_UNIFIED_ANCILLARY_DOCUMENTS and
 * FEATURE_CANONICAL_ORDER_NOTE; either OFF ⇒ zero reads/writes.
 */
export async function linkOrderNoteAdminReviewEvidence(
  failure: OrderNoteEvidenceRetryInput,
): Promise<OrderNoteEvidenceRetryResult> {
  if (!featureFlags.unifiedAncillaryDocuments || !featureFlags.canonicalOrderNote) {
    return { status: "skipped_flag_off" };
  }
  const { clinicId, ancillaryCaseId, sourceId } = failure;
  if (ancillaryCaseId == null || sourceId == null) return { status: "still_deferred" };

  // 1. Case must exist and belong to this clinic (case/event chain scope).
  const acase = await getAncillaryCaseById(ancillaryCaseId);
  if (!acase) return { status: "still_deferred" };
  if (acase.clinicId !== clinicId) return { status: "cross_clinic_denied" };

  // 2. Note must exist, be same-clinic, same-case, order_note, and current.
  const note = await findOrderNoteByIdRaw(sourceId);
  if (!note) return { status: "note_not_found" };
  if (note.clinicId !== clinicId) return { status: "cross_clinic_denied" };
  if (note.ancillaryCaseId !== ancillaryCaseId) return { status: "note_case_mismatch" };
  if (note.noteType !== "order_note") return { status: "note_case_mismatch" };
  if (note.supersededAt != null) return { status: "note_case_mismatch" };

  // 3. The approved immutable event for THIS exact case.
  const adminReviewEventId = await findApprovedAdminReviewEventId(ancillaryCaseId);
  if (adminReviewEventId == null) return { status: "still_deferred" };

  // 4. Reference, when present, must belong to the same clinic/case/source/kind.
  //    Absent reference ⇒ a separate link_order_note retry is still pending;
  //    link the note evidence safely and NEVER fabricate a reference.
  const ref = await findOrderNoteReferenceBySource(sourceId);
  if (ref) {
    if (
      ref.clinicId !== clinicId ||
      ref.ancillaryCaseId !== ancillaryCaseId ||
      ref.sourceId !== sourceId ||
      ref.documentKind !== "order_note"
    ) {
      return { status: "reference_update_failed" };
    }
  }

  // 5. Atomic note-evidence + reference-metadata update.
  try {
    await db.transaction(async (tx) => {
      const noteRows = await tx
        .update(procedureNotes)
        .set({ adminReviewEventId, updatedAt: new Date() })
        .where(and(
          eq(procedureNotes.id, sourceId),
          eq(procedureNotes.clinicId, clinicId),
          eq(procedureNotes.ancillaryCaseId, ancillaryCaseId),
        ))
        .returning();
      if (noteRows.length === 0) throw new EvidenceRetryTxError("note");
      if (ref) {
        const metadata = {
          ...((ref.metadata as Record<string, unknown>) ?? {}),
          admin_review_event_id: adminReviewEventId,
        };
        const refRows = await tx
          .update(ancillaryDocumentReferences)
          .set({ metadata: metadata as never, updatedAt: new Date() })
          .where(and(
            eq(ancillaryDocumentReferences.id, ref.id),
            eq(ancillaryDocumentReferences.clinicId, clinicId),
          ))
          .returning();
        if (refRows.length === 0) throw new EvidenceRetryTxError("reference");
      }
    });
  } catch (e) {
    if (e instanceof EvidenceRetryTxError && e.kind === "note") {
      return { status: "note_not_found" };
    }
    return { status: "reference_update_failed" };
  }
  return { status: "linked", adminReviewEventId, orderNoteId: sourceId };
}

/** Raw single-note read for evidence-retry validation (all scope fields). */
async function findOrderNoteByIdRaw(
  id: number,
): Promise<typeof procedureNotes.$inferSelect | null> {
  const [row] = await db.select().from(procedureNotes).where(eq(procedureNotes.id, id)).limit(1);
  return row ?? null;
}

/** The order_note reference for a given source note id, or null. */
async function findOrderNoteReferenceBySource(
  sourceId: number,
): Promise<typeof ancillaryDocumentReferences.$inferSelect | null> {
  const [ref] = await db
    .select()
    .from(ancillaryDocumentReferences)
    .where(and(
      eq(ancillaryDocumentReferences.sourceTable, ORDER_NOTE_SOURCE_TABLE),
      eq(ancillaryDocumentReferences.sourceId, sourceId),
      eq(ancillaryDocumentReferences.documentKind, "order_note"),
    ))
    .limit(1);
  return ref ?? null;
}

export type OrderNoteSignatureSyncResult =
  | { status: "skipped_flag_off" }
  | { status: "synced" }
  | { status: "no_reference"; retryRecorded: boolean }
  | { status: "cross_clinic_denied" }
  | { status: "case_mismatch" }
  | { status: "migration_missing" }
  | { status: "sync_failed"; retryRecorded: boolean };

const MIGRATION_MISSING_CODES = new Set(["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"]);

/** Record an exact, PHI-free link_order_note reconciliation row for a sync gap. */
async function recordOrderNoteSyncRetry(
  args: { clinicId: number; ancillaryCaseId: number | null; noteId: number },
  errorCode: string,
): Promise<boolean> {
  try {
    await recordAncillaryDocumentFailure({
      clinicId: args.clinicId,
      ancillaryCaseId: args.ancillaryCaseId,
      documentKind: "order_note",
      sourceTable: ORDER_NOTE_SOURCE_TABLE,
      sourceId: args.noteId,
      requestedAction: "link_order_note",
      sourceSystem: "order_note_signature_sync",
      errorCode,
    });
    return true;
  } catch { return false; }
}

/** PHI-free security/audit event for a denied cross-owner sync (no cross-clinic detail). */
async function recordOrderNoteSyncDenied(
  args: { clinicId: number; ancillaryCaseId: number | null; noteId: number },
  reason: "clinic_mismatch" | "case_mismatch",
): Promise<void> {
  await appendAudit({
    eventType: "ancillary_document_signature_sync_denied",
    patientScreeningId: null,
    executionCaseId: null,
    actorUserId: null,
    source: "order_note_signature_sync",
    summary: `Order Note signature reference sync denied (${reason})`,
    metadata: { clinic_id: args.clinicId, ancillary_case_id: args.ancillaryCaseId, source_id: args.noteId, reason },
  });
}

/**
 * Phase 2E-B4 — after a tenant-scoped Order Note signature transition
 * commits, mirror the canonical note state onto its EXACT reference row
 * (sourceTable=procedure_notes, sourceId=noteId, documentKind=order_note):
 * documentStatus + signedAt only. NEVER touches identity/ownership and NEVER
 * broadly updates. Validates clinic + ancillaryCaseId. Feature OFF → zero
 * reference reads/writes. NEVER throws — a sync failure must not reverse the
 * already-committed signature/return; it records exact, PHI-free
 * reconciliation work instead.
 */
export async function syncOrderNoteReferenceSignature(args: {
  clinicId: number;
  ancillaryCaseId: number | null;
  noteId: number;
  documentStatus: "signed" | "pending_signature";
  signedAt: Date | null;
}): Promise<OrderNoteSignatureSyncResult> {
  // Require BOTH flags — either OFF ⇒ zero reference reads/writes/ledger work.
  if (!featureFlags.unifiedAncillaryDocuments || !featureFlags.canonicalOrderNote) return { status: "skipped_flag_off" };
  try {
    const ref = await findOrderNoteReferenceBySource(args.noteId);
    if (!ref) {
      // A signed note with no reference yet — record an exact, PHI-free retry.
      const retryRecorded = await recordOrderNoteSyncRetry(args, "ORDER_NOTE_REFERENCE_MISSING_AFTER_SIGNATURE");
      return { status: "no_reference", retryRecorded };
    }
    if (ref.clinicId !== args.clinicId) {
      await recordOrderNoteSyncDenied(args, "clinic_mismatch");
      return { status: "cross_clinic_denied" };
    }
    if (args.ancillaryCaseId != null && ref.ancillaryCaseId !== args.ancillaryCaseId) {
      await recordOrderNoteSyncDenied(args, "case_mismatch");
      return { status: "case_mismatch" };
    }
    // Exact WHERE (id + clinic + case + source table/id + kind); status +
    // signedAt only; identity is never changed. `.returning()` verifies exactly
    // one affected row.
    const updated = await db
      .update(ancillaryDocumentReferences)
      .set({ documentStatus: args.documentStatus, signedAt: args.signedAt, updatedAt: new Date() })
      .where(and(
        eq(ancillaryDocumentReferences.id, ref.id),
        eq(ancillaryDocumentReferences.clinicId, args.clinicId),
        eq(ancillaryDocumentReferences.ancillaryCaseId, ref.ancillaryCaseId),
        eq(ancillaryDocumentReferences.sourceTable, ORDER_NOTE_SOURCE_TABLE),
        eq(ancillaryDocumentReferences.sourceId, args.noteId),
        eq(ancillaryDocumentReferences.documentKind, "order_note"),
      ))
      .returning();
    if (updated.length !== 1) {
      // Concurrent ownership/identity change — never report success.
      const retryRecorded = await recordOrderNoteSyncRetry(args, "reference_signature_sync_zero_row");
      return { status: "sync_failed", retryRecorded };
    }
    return { status: "synced" };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    // Missing migration → truthful, no insert into a missing retry table.
    if (code != null && MIGRATION_MISSING_CODES.has(code)) return { status: "migration_missing" };
    const retryRecorded = await recordOrderNoteSyncRetry(args, "reference_signature_sync_failed");
    return { status: "sync_failed", retryRecorded };
  }
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
