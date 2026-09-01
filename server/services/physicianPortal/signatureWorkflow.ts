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
import { syncOrderNoteReferenceSignature } from "../ancillaryDocuments/orderNoteService";
import { syncProcedureNoteReferenceSignature } from "../procedureLifecycle/procedureNoteService";
import type { ProcedureNote } from "@shared/schema/generatedNotes";

/**
 * Mirror a committed note signature transition onto its exact canonical
 * reference — Order Note (Phase 2E) or canonical Procedure Note (Phase 2F).
 * NEVER throws (a sync failure must not reverse the already-successful
 * signature/return). Feature OFF → a no-op with zero reference reads/writes.
 */
async function syncNoteReference(
  note: ProcedureNote,
  documentStatus: "signed" | "pending_signature",
): Promise<void> {
  if (note.clinicId == null) return;
  try {
    if (note.noteType === "order_note") {
      await syncOrderNoteReferenceSignature({ clinicId: note.clinicId, ancillaryCaseId: note.ancillaryCaseId ?? null, noteId: note.id, documentStatus, signedAt: note.signedAt ?? null });
    } else if (note.noteType === "post_procedure_note") {
      await syncProcedureNoteReferenceSignature({ clinicId: note.clinicId, ancillaryCaseId: note.ancillaryCaseId ?? null, noteId: note.id, documentStatus, signedAt: note.signedAt ?? null });
    }
  } catch {
    // Defence in depth — the sync already swallows + records; the signature
    // transition must remain successful regardless.
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: "error", source: "physicianPortal.signatureWorkflow", kind: "note_reference_sync_threw", note_id: note.id }));
  }
}
import {
  eligibleForSign,
  computeSignatureItem,
  orderNoteSigningEligibility,
  type PhysicianSignatureItem,
} from "./signatureRules";
import { featureFlags } from "../../lib/featureFlags";
import { getCurrentScreeningEvidence } from "../screening/screeningEvidenceService";

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
  return Promise.all(
    rows.map(async (r) => {
      const key = `${r.patientScreeningId}::${r.serviceType}`;
      // Slice B-minimal — derive the Order Note portal state from canonical
      // screening currency (only under the canonical flag; legacy order notes
      // keep the original behavior via a null context).
      let orderNoteCtx = null as
        | { requireScreening: boolean; screeningComplete: boolean; currentScreeningVersion: string | null }
        | null;
      if (
        featureFlags.canonicalOrderNote &&
        r.noteType === "order_note" &&
        r.ancillaryCaseId != null &&
        r.clinicId != null
      ) {
        const requireScreening = /brain|vital/i.test(r.serviceType ?? "");
        let screeningComplete = !requireScreening;
        let currentScreeningVersion: string | null = null;
        if (requireScreening) {
          const cur = await getCurrentScreeningEvidence({
            clinicId: r.clinicId,
            ancillaryCaseId: r.ancillaryCaseId,
            serviceType: r.serviceType,
          });
          if (cur) {
            screeningComplete = true;
            currentScreeningVersion = cur.version;
          }
        }
        orderNoteCtx = { requireScreening, screeningComplete, currentScreeningVersion };
      }
      return computeSignatureItem(r, reportKeys.has(key), billingMap.get(key) ?? "not_ready", orderNoteCtx);
    }),
  );
}

// ─── Write model: sign / return ──────────────────────────────────────────────

export type SignOutcome =
  | { ok: true; note: ProcedureNote }
  | { ok: false; code: 403 | 404 | 409; error: string; reason?: string };

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
  clinicId: number | "all";
  authenticatedSignerUserId: string | null;
  // Slice C — optional client version tokens (stale-client protection).
  expectedEvidenceFingerprint?: string | null;
  expectedScreeningVersion?: string | null;
}): Promise<SignOutcome> {
  const note = await getProcedureNoteByIdForClinic({ id: args.id, clinicId: args.clinicId });
  const guard = eligibleForSign(note);
  if (!guard.ok) return guard;
  // Admin ("all") acts on the note's OWN clinic — every downstream scoped
  // read/write uses this resolved numeric clinic, so tenant-safety is preserved.
  const effectiveClinicId = args.clinicId === "all" ? (note?.clinicId ?? null) : args.clinicId;
  if (effectiveClinicId == null) return { ok: false, code: 404, error: "Note not found" };

  // Slice C — Order Note signing gate (canonical flow only). Enforces
  // current-version, required-screening completeness, screening-version
  // currency (the note was evaluated against the CURRENT screening), and
  // optional client version tokens. Never touches the post_procedure_note
  // path or the legacy behavior.
  if (note && note.noteType === "order_note" && featureFlags.canonicalOrderNote) {
    const requireScreening = /brain|vital/i.test(note.serviceType ?? "");
    let screeningComplete = false;
    let currentScreeningVersion: string | null = null;
    if (note.ancillaryCaseId != null && note.clinicId != null) {
      const cur = await getCurrentScreeningEvidence({
        clinicId: note.clinicId,
        ancillaryCaseId: note.ancillaryCaseId,
        serviceType: note.serviceType,
      });
      if (cur) {
        screeningComplete = true;
        currentScreeningVersion = cur.version;
      }
    }
    const gate = orderNoteSigningEligibility(note, {
      requireScreening,
      screeningComplete,
      currentScreeningVersion,
      expectedEvidenceFingerprint: args.expectedEvidenceFingerprint ?? null,
      expectedScreeningVersion: args.expectedScreeningVersion ?? null,
      // Clinic-scoped authorization today; ordering-clinician match is
      // tightened in B-minimal (routing). Never cross-clinic (read is scoped).
      authorizedSigner: true,
    });
    if (!gate.ok) return gate;
  }

  // Clinic-scoped, server-owned write: signer = authenticated session user,
  // signedAt = server time (both stamped in the repository), promotion to
  // 'approved' preserved. WHERE requires id AND clinicId.
  const updated = await signProcedureNoteRow({
    id: args.id,
    clinicId: effectiveClinicId,
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

  // Mirror signed state onto the canonical Order Note reference (best-effort).
  await syncNoteReference(updated, "signed");

  // Phase 2G — a signed Procedure Note may make the case billing-ready. Awaited,
  // flag-gated (OFF ⇒ zero migration-0055 access), non-throwing; never reverses
  // the committed signature. Dynamic import avoids the note-service import cycle.
  {
    const { triggerBillingReadinessForCommittedCase } = await import("../billingLifecycle/billingLifecycleOrchestration");
    await triggerBillingReadinessForCommittedCase({ clinicId: effectiveClinicId, ancillaryCaseId: updated.ancillaryCaseId ?? null, source: "procedure_note_signed" });
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
  clinicId: number | "all",
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
  clinicId: number | "all";
  reason: string;
}): Promise<ReturnOutcome> {
  const trimmed = args.reason.trim();
  if (!trimmed) return { ok: false, code: 400, error: "A return reason is required" };
  // Admin ("all") resolves the note's own clinic so the scoped write is tenant-safe.
  const existing = await getProcedureNoteByIdForClinic({ id: args.id, clinicId: args.clinicId });
  const effectiveClinicId = args.clinicId === "all" ? (existing?.clinicId ?? null) : args.clinicId;
  if (effectiveClinicId == null) return { ok: false, code: 404, error: "Note not found" };
  const updated = await returnProcedureNoteRow({
    id: args.id,
    clinicId: effectiveClinicId,
    reason: trimmed,
  });
  if (!updated) return { ok: false, code: 404, error: "Note not found" };
  // Mirror pending-signature state onto the canonical Order Note reference.
  await syncNoteReference(updated, "pending_signature");
  // Phase 2G — returning a Procedure Note for correction invalidates billing
  // eligibility; re-evaluate (which supersedes any stale current Billing Document).
  {
    const { triggerBillingReadinessForCommittedCase } = await import("../billingLifecycle/billingLifecycleOrchestration");
    await triggerBillingReadinessForCommittedCase({ clinicId: effectiveClinicId, ancillaryCaseId: updated.ancillaryCaseId ?? null, source: "procedure_note_returned" });
  }
  return { ok: true, note: updated };
}
