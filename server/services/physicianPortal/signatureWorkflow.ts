// Physician Portal — signature workflow service.
//
// Owns the transitions the /api/physician-portal/signature-items/* routes
// need. Never touches the DB directly: DB reads live in
// server/repositories/physicianPortal.repo.ts and DB writes go through
// server/repositories/generatedNotes.repo.ts. Routes validate + delegate
// only. Downstream side-effects (billing readiness re-eval) are queued
// as best-effort (never block the response).
//
// Pure decision helpers (eligibleForSign, computeSignatureItem) live in
// signatureRules.ts so tests can import them without a DB connection.

import {
  listSignatureCandidateRows,
  listReportUploadedKeys,
  listLatestBillingReadinessStatuses,
  getProcedureNoteById,
  type PhysicianSignatureListFilters,
} from "../../repositories/physicianPortal.repo";
import { applyProcedureNoteSignatureUpdate } from "../../repositories/generatedNotes.repo";
import { evaluateBillingReadinessForProcedure } from "../../repositories/billingReadiness.repo";
import type { ProcedureNote } from "@shared/schema/generatedNotes";
import {
  eligibleForSign,
  computeSignatureItem,
  type PhysicianSignatureItem,
} from "./signatureRules";

// Re-export the pure surface + types so route + client code has one
// import path for physicianPortal signature primitives.
export {
  SIGNABLE_GEN_STATUSES,
  READY_BILLING,
  eligibleForSign,
  computeSignatureItem,
  type PhysicianSignatureItem,
  type SignEligibility,
  type SignatureCandidateRow,
} from "./signatureRules";

// ─── Read model: signature worklist ──────────────────────────────────────────

/**
 * Compose the signature worklist for the Physician Portal SignaturesTab.
 * Two batched queries + one join query — no per-row round-trips.
 */
export async function listSignatureItems(
  filters: PhysicianSignatureListFilters,
): Promise<PhysicianSignatureItem[]> {
  const rows = await listSignatureCandidateRows(filters);
  const screeningIds = Array.from(
    new Set(
      rows
        .map((n) => n.patientScreeningId)
        .filter((v): v is number => v != null),
    ),
  );
  const [reportKeys, billingMap] = await Promise.all([
    listReportUploadedKeys(screeningIds),
    listLatestBillingReadinessStatuses(screeningIds),
  ]);
  return rows.map((r) => {
    const key = `${r.patientScreeningId}::${r.serviceType}`;
    return computeSignatureItem(
      r,
      reportKeys.has(key),
      billingMap.get(key) ?? "not_ready",
    );
  });
}

// ─── Write model: sign / return ──────────────────────────────────────────────

export type SignOutcome =
  | { ok: true; note: ProcedureNote }
  | { ok: false; code: 404 | 409; error: string };

/**
 * Sign a single note. Runs the eligibility guard, writes the transition
 * via the repository, and best-effort re-evaluates billing readiness.
 *
 * `signedByUserId` is captured from the caller's session at the route
 * boundary — never from the client body.
 */
export async function signNote(
  id: number,
  signedByUserId: string | null,
): Promise<SignOutcome> {
  const note = await getProcedureNoteById(id);
  const guard = eligibleForSign(note);
  if (!guard.ok) return guard;

  // Signature transition via the dedicated, server-owned contract. The
  // signer id is the session user captured at the route boundary; signedAt
  // is stamped from server time inside the repository. Promotion to
  // 'approved' (for billing readiness) is a server-owned side effect there.
  const updated = await applyProcedureNoteSignatureUpdate(id, {
    signatureStatus: "signed",
    signedAt: new Date(),
    signedByUserId,
  });
  if (!updated) return { ok: false, code: 404, error: "Note not found" };

  // Best-effort billing readiness re-evaluation — signing may have been
  // the blocker. Never awaited; failures are logged and swallowed.
  if (note && note.serviceType) {
    void evaluateBillingReadinessForProcedure({
      executionCaseId: note.executionCaseId,
      patientScreeningId: note.patientScreeningId,
      procedureEventId: note.procedureEventId,
      serviceType: note.serviceType,
    }).catch((err) =>
      console.error(
        "[physicianPortal.signatureWorkflow] billing re-eval failed:",
        err,
      ),
    );
  }

  return { ok: true, note: updated };
}

/**
 * Bulk-sign the given ids. Returns per-id success/skip so the client can
 * render which notes moved and which were rejected.
 */
export async function bulkSignNotes(
  ids: number[],
  signedByUserId: string | null,
): Promise<{ signed: number[]; skipped: { id: number; reason: string }[] }> {
  const results: {
    signed: number[];
    skipped: { id: number; reason: string }[];
  } = { signed: [], skipped: [] };
  for (const id of ids) {
    const r = await signNote(id, signedByUserId);
    if (r.ok) results.signed.push(id);
    else results.skipped.push({ id, reason: r.error });
  }
  return results;
}

/**
 * Return a note for correction. Requires a non-empty reason. Writes the
 * `returned_for_correction` transition + return_reason via the repository.
 */
export type ReturnOutcome =
  | { ok: true; note: ProcedureNote }
  | { ok: false; code: 400 | 404; error: string };

export async function returnNoteForCorrection(
  id: number,
  reason: string,
): Promise<ReturnOutcome> {
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, code: 400, error: "A return reason is required" };
  const updated = await applyProcedureNoteSignatureUpdate(id, {
    signatureStatus: "returned_for_correction",
    returnReason: trimmed,
  });
  if (!updated) return { ok: false, code: 404, error: "Note not found" };
  return { ok: true, note: updated };
}
