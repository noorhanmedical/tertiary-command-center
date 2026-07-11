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
  | { ok: false; code: 404 | 409; error: string };

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
): PhysicianSignatureItem {
  const signatureStatus = (row.signatureStatus ??
    "needs_signature") as SignatureStatus;
  const hasBody =
    !!row.generatedText &&
    SIGNABLE_GEN_STATUSES.includes(
      row.generationStatus as (typeof SIGNABLE_GEN_STATUSES)[number],
    );
  const reportRequired = row.noteType === "post_procedure_note";
  const signable =
    hasBody && (!reportRequired || reportUploaded) && signatureStatus !== "signed";
  const billingBlocked = !READY_BILLING.has(billingStatus);
  return {
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
