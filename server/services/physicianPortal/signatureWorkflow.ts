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
  getProcedureNoteByIdForClinic,
  type PhysicianSignatureListFilters,
} from "../../repositories/physicianPortal.repo";
import {
  signProcedureNoteRow,
  returnProcedureNoteRow,
} from "../../repositories/generatedNotes.repo";
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

// ─── Post-sign billing re-evaluation side-effect (injectable seam) ────────────
//
// In production, billing readiness re-evaluation after a sign is
// fire-and-forget: it must never block the signing response, and its
// failures are logged and swallowed. But a bare `void fn()` leaks an
// uncontrolled async DB task that can outlive a test's fake-db harness
// (producing spurious ECONNREFUSED logs after teardown). This seam lets
// tests substitute a scheduler that drops or awaits the side-effect so no
// background work escapes the test, while production keeps the
// non-blocking default.
export type BillingReeval = () => Promise<unknown>;
const defaultBillingReevalScheduler = (fn: BillingReeval): void => {
  void fn().catch((err) =>
    console.error("[physicianPortal.signatureWorkflow] billing re-eval failed:", err),
  );
};
let scheduleBillingReeval: (fn: BillingReeval) => void = defaultBillingReevalScheduler;

/** Test-only seam. Pass null to restore the production fire-and-forget default. */
export function setBillingReevalScheduler(
  scheduler: ((fn: BillingReeval) => void) | null,
): void {
  scheduleBillingReeval = scheduler ?? defaultBillingReevalScheduler;
}

// ─── Read model: signature worklist ──────────────────────────────────────────

/**
 * Compose the signature worklist for the Physician Portal SignaturesTab.
 * Two batched queries + one join query — no per-row round-trips. Every read
 * is scoped to `filters.clinicId`, and the report/readiness lookups inherit
 * the same clinic scope.
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
    listReportUploadedKeys(screeningIds, filters.clinicId),
    listLatestBillingReadinessStatuses(screeningIds, filters.clinicId),
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
 * Sign a single note within the authenticated clinic. Runs the eligibility
 * guard against a CLINIC-SCOPED read, writes the transition through a
 * clinic-scoped, server-owned repository command, and best-effort
 * re-evaluates billing readiness.
 *
 * - `clinicId` is derived from req.clinicId at the route boundary.
 * - `authenticatedSignerUserId` is the session user id — never a body value.
 * - signedAt is stamped inside the repository from server time.
 * A note in another clinic reads as not-found (same 404), disclosing no
 * cross-tenant existence.
 */
export async function signProcedureNote(args: {
  id: number;
  clinicId: number;
  authenticatedSignerUserId: string | null;
}): Promise<SignOutcome> {
  const note = await getProcedureNoteByIdForClinic({ id: args.id, clinicId: args.clinicId });
  const guard = eligibleForSign(note);
  if (!guard.ok) return guard;

  // Clinic-scoped, server-owned write: signer = authenticated session user,
  // signedAt = server time (both stamped in the repository), promotion to
  // 'approved' preserved. WHERE requires id AND clinicId.
  const updated = await signProcedureNoteRow({
    id: args.id,
    clinicId: args.clinicId,
    signedByUserId: args.authenticatedSignerUserId,
  });
  if (!updated) return { ok: false, code: 404, error: "Note not found" };

  // Best-effort billing readiness re-evaluation — signing may have been the
  // blocker. Scheduled through the injectable seam so it never blocks the
  // response and never leaks async work past a test harness.
  if (note && note.serviceType) {
    scheduleBillingReeval(() =>
      evaluateBillingReadinessForProcedure({
        executionCaseId: note.executionCaseId,
        patientScreeningId: note.patientScreeningId,
        procedureEventId: note.procedureEventId,
        serviceType: note.serviceType,
      }),
    );
  }

  return { ok: true, note: updated };
}

/**
 * Bulk-sign the given ids within the authenticated clinic. Returns per-id
 * success/skip. Cross-clinic ids are skipped as "Note not found" without
 * any special handling — the per-note clinic scope does the filtering.
 */
export async function bulkSignNotes(
  ids: number[],
  clinicId: number,
  authenticatedSignerUserId: string | null,
): Promise<{ signed: number[]; skipped: { id: number; reason: string }[] }> {
  const results: {
    signed: number[];
    skipped: { id: number; reason: string }[];
  } = { signed: [], skipped: [] };
  for (const id of ids) {
    const r = await signProcedureNote({ id, clinicId, authenticatedSignerUserId });
    if (r.ok) results.signed.push(id);
    else results.skipped.push({ id, reason: r.error });
  }
  return results;
}

/**
 * Return a note for correction within the authenticated clinic. Requires a
 * non-empty reason. Writes the `returned_for_correction` transition through
 * a clinic-scoped, server-owned command that never fabricates signing data.
 */
export type ReturnOutcome =
  | { ok: true; note: ProcedureNote }
  | { ok: false; code: 400 | 404; error: string };

export async function returnProcedureNoteForCorrection(args: {
  id: number;
  clinicId: number;
  reason: string;
}): Promise<ReturnOutcome> {
  const trimmed = args.reason.trim();
  if (!trimmed) return { ok: false, code: 400, error: "A return reason is required" };
  const updated = await returnProcedureNoteRow({
    id: args.id,
    clinicId: args.clinicId,
    reason: trimmed,
  });
  if (!updated) return { ok: false, code: 404, error: "Note not found" };
  return { ok: true, note: updated };
}
