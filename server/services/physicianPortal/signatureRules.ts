// Physician Portal — signature rules (pure).
//
// Zero I/O, zero DB, zero imports of `../db`. Everything here is a pure
// function that can be unit-tested without a live database.
//
// The stateful `signatureWorkflow.ts` file consumes these to compose the
// signature list + sign/return endpoints, adding DB writes + audit +
// billing re-evaluation on top.

import type { ProcedureNote, SignatureStatus } from "@shared/schema/generatedNotes";

// Only notes whose generation status means a body actually exists are
// eligible for signing.
export const SIGNABLE_GEN_STATUSES = ["generated", "approved"] as const;

// Billing readiness statuses that mean "not blocked."
export const READY_BILLING = new Set([
  "ready_to_generate",
  "billing_document_generated",
  "sent_to_billing",
]);

// ─── Slice B-minimal — derived Order Note portal state (pure) ────────────────
export const ORDER_NOTE_PORTAL_STATES = [
  "awaiting_screening",
  "ready_for_review",
  "updated_review_required",
  "signed",
  // A previously-signed Order Note whose material canonical evidence changed
  // AFTER signature. The signed note remains immutable + in the audit trail,
  // but it no longer authorizes the procedure: a re-reviewed/re-signed v2 is
  // required. NEVER shown simply as "signed".
  "signed_stale_review_required",
  "pending",
] as const;
export type OrderNotePortalState = (typeof ORDER_NOTE_PORTAL_STATES)[number];

export type OrderNotePortalContext = {
  requireScreening: boolean;
  screeningComplete: boolean;
  currentScreeningVersion: string | null;
  // Current canonical Order Note evidence fingerprint (recomputed from live
  // evidence). When present and it differs from a SIGNED note's frozen
  // fingerprint, the note is stale. Optional so legacy/flag-off callers that
  // don't compute it keep the prior behavior.
  currentEvidenceFingerprint?: string | null;
};

/** Derive the clinician-portal-facing state of an Order Note from canonical
 *  facts (no new persistent enum). */
export function deriveOrderNotePortalState(
  note: ProcedureNote,
  ctx: OrderNotePortalContext,
): OrderNotePortalState {
  if (note.signatureStatus === "signed") {
    // A signed note is stale when current canonical evidence drifted from the
    // fingerprint frozen at signature. Only assert staleness when we actually
    // computed a current fingerprint (fail-open on display; the authoritative
    // fail-closed enforcement is at procedure_start + procedure-note generation).
    if (
      ctx.currentEvidenceFingerprint != null &&
      (note.evidenceFingerprint ?? null) !== ctx.currentEvidenceFingerprint
    ) {
      return "signed_stale_review_required";
    }
    return "signed";
  }
  const hasBody =
    !!note.generatedText &&
    SIGNABLE_GEN_STATUSES.includes(note.generationStatus as (typeof SIGNABLE_GEN_STATUSES)[number]);
  if (!hasBody) return "awaiting_screening";
  if (ctx.requireScreening) {
    if (!ctx.screeningComplete) return "awaiting_screening";
    if (!note.evaluatedScreeningEvidenceVersion || note.evaluatedScreeningEvidenceVersion !== ctx.currentScreeningVersion) {
      return "updated_review_required";
    }
  }
  return "ready_for_review";
}

// ─── Client-facing signature-item shape ──────────────────────────────────────

export type PhysicianSignatureItem = {
  id: number;
  patientScreeningId: number | null;
  executionCaseId: number | null;
  procedureEventId: number | null;
  serviceType: string;
  noteType: string;
  signatureStatus: SignatureStatus;
  returnReason: string | null;
  createdAt: Date;
  patientName: string | null;
  patientDob: string | null;
  patientAge: number | null;
  patientGender: string | null;
  patientInsurance: string | null;
  patientFacility: string | null;
  reportUploaded: boolean;
  billingStatus: string;
  billingBlocked: boolean;
  signable: boolean;
  flags: {
    missingReport: boolean;
    notSignable: boolean;
    billingBlocked: boolean;
  };
  // Slice B-minimal — Order Note lifecycle (order_note rows only; else null).
  orderNotePortalState: OrderNotePortalState | null;
  screeningComplete: boolean | null;
  // Version tokens the client MUST echo on sign (Slice C stale-client guard).
  expectedEvidenceFingerprint: string | null;
  expectedScreeningVersion: string | null;
};

// Shape of a joined row from the physicianPortal repository. Kept
// duplicated here so the test file doesn't pull the db-touching module.
export type SignatureCandidateRow = ProcedureNote & {
  patientName: string | null;
  patientDob: string | null;
  patientAge: number | null;
  patientGender: string | null;
  patientInsurance: string | null;
  patientFacility: string | null;
  diagnoses: string | null;
  history: string | null;
  medications: string | null;
};

// ─── Transition guards (pure) ────────────────────────────────────────────────

export type SignEligibility =
  | { ok: true }
  | { ok: false; code: 403 | 404 | 409; error: string; reason?: string };

// ─── Slice C — Order Note signing gate (pure) ────────────────────────────────
// Additional, order-note-specific eligibility beyond eligibleForSign. Enforces
// current-version, required-screening completeness, screening-version currency
// (the note must have been evaluated against the CURRENT completed screening),
// optional client version tokens (stale-client protection), and signer
// authorization. Purely functional; the workflow gathers the gate context.
export type OrderNoteSignGate = {
  // BW/VW require current structured screening before signing.
  requireScreening: boolean;
  // A current completed structured screening exists for the case+service.
  screeningComplete: boolean;
  // The current FULL screening evidence version (A0).
  currentScreeningVersion: string | null;
  // Optional client-submitted tokens proving they viewed the current doc.
  expectedEvidenceFingerprint?: string | null;
  expectedScreeningVersion?: string | null;
  // Whether the authenticated clinician is authorized to sign this note.
  authorizedSigner: boolean;
};

export function orderNoteSigningEligibility(
  note: ProcedureNote,
  gate: OrderNoteSignGate,
): SignEligibility {
  // Must be the CURRENT (non-superseded) version.
  if (note.supersededAt != null) {
    return { ok: false, code: 409, reason: "ORDER_NOTE_STALE", error: "A newer version of this Order Note exists. Please review the current Order Note before signing." };
  }
  if (note.ancillaryCaseId == null) {
    return { ok: false, code: 409, reason: "ORDER_NOTE_NOT_READY", error: "Order Note is not linked to an ancillary case." };
  }
  if (gate.requireScreening) {
    if (!gate.screeningComplete) {
      return { ok: false, code: 409, reason: "REQUIRED_SCREENING_INCOMPLETE", error: "Required screening is not complete." };
    }
    // The note must have been evaluated against the CURRENT screening version.
    if (!note.evaluatedScreeningEvidenceVersion || note.evaluatedScreeningEvidenceVersion !== gate.currentScreeningVersion) {
      return { ok: false, code: 409, reason: "ORDER_NOTE_STALE", error: "Clinical information has changed. Please review the current Order Note before signing." };
    }
  }
  // Stale-client protection: reject a signature against a version the client no
  // longer reflects.
  if (gate.expectedScreeningVersion != null && gate.expectedScreeningVersion !== gate.currentScreeningVersion) {
    return { ok: false, code: 409, reason: "ORDER_NOTE_STALE", error: "Clinical information has changed. Please review the current Order Note before signing." };
  }
  if (gate.expectedEvidenceFingerprint != null && gate.expectedEvidenceFingerprint !== (note.evidenceFingerprint ?? null)) {
    return { ok: false, code: 409, reason: "ORDER_NOTE_STALE", error: "This Order Note was updated. Please review the current version before signing." };
  }
  if (!gate.authorizedSigner) {
    return { ok: false, code: 403, reason: "CLINICIAN_NOT_AUTHORIZED", error: "You are not authorized to sign this Order Note." };
  }
  return { ok: true };
}

/**
 * Can this procedure_notes row transition to `signed` right now?
 * Pure function — no I/O.
 */
export function eligibleForSign(
  note: ProcedureNote | undefined,
): SignEligibility {
  if (!note) return { ok: false, code: 404, error: "Note not found" };
  if (note.signatureStatus === "signed") {
    return { ok: false, code: 409, error: "Already signed" };
  }
  if (
    !SIGNABLE_GEN_STATUSES.includes(
      note.generationStatus as (typeof SIGNABLE_GEN_STATUSES)[number],
    ) ||
    !note.generatedText
  ) {
    return {
      ok: false,
      code: 409,
      error: "Note has no generated content to sign",
    };
  }
  return { ok: true };
}

/**
 * Compute the per-row `signable` + flag block the client renders. Pure —
 * takes a joined row + the batch-computed `reportUploaded` + billing status.
 */
export function computeSignatureItem(
  row: SignatureCandidateRow,
  reportUploaded: boolean,
  billingStatus: string,
  orderNoteCtx?: OrderNotePortalContext | null,
): PhysicianSignatureItem {
  const signatureStatus = (row.signatureStatus ??
    "needs_signature") as SignatureStatus;
  const hasBody =
    !!row.generatedText &&
    SIGNABLE_GEN_STATUSES.includes(
      row.generationStatus as (typeof SIGNABLE_GEN_STATUSES)[number],
    );
  const reportRequired = row.noteType === "post_procedure_note";
  const isOrderNote = row.noteType === "order_note";
  // Order Note lifecycle state (only when we have the screening context).
  const orderNotePortalState =
    isOrderNote && orderNoteCtx ? deriveOrderNotePortalState(row, orderNoteCtx) : null;
  const signable = isOrderNote && orderNoteCtx
    // Canonical Order Note: signable in the UI only when READY FOR REVIEW
    // (current screening + evaluated against current version). The server C
    // gate is authoritative; this keeps the button honest. Legacy/flag-off
    // order notes (no context) keep the original body-based rule.
    ? orderNotePortalState === "ready_for_review"
    : hasBody && (!reportRequired || reportUploaded) && signatureStatus !== "signed";
  const billingBlocked = !READY_BILLING.has(billingStatus);
  return {
    orderNotePortalState,
    screeningComplete: isOrderNote && orderNoteCtx ? orderNoteCtx.screeningComplete : null,
    expectedEvidenceFingerprint: isOrderNote ? (row.evidenceFingerprint ?? null) : null,
    expectedScreeningVersion: isOrderNote && orderNoteCtx ? orderNoteCtx.currentScreeningVersion : null,
    id: row.id,
    patientScreeningId: row.patientScreeningId,
    executionCaseId: row.executionCaseId,
    procedureEventId: row.procedureEventId,
    serviceType: row.serviceType,
    noteType: row.noteType,
    signatureStatus,
    returnReason: row.returnReason,
    createdAt: row.createdAt,
    patientName: row.patientName,
    patientDob: row.patientDob,
    patientAge: row.patientAge,
    patientGender: row.patientGender,
    patientInsurance: row.patientInsurance,
    patientFacility: row.patientFacility,
    reportUploaded,
    billingStatus,
    billingBlocked,
    signable,
    flags: {
      missingReport: reportRequired && !reportUploaded,
      notSignable: !signable,
      billingBlocked,
    },
  };
}
