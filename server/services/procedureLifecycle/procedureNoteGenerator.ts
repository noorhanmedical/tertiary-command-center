/**
 * Phase 2F-B — canonical Procedure Note generator (EVIDENCE-ONLY procedure
 * completion CERTIFICATION — option B).
 *
 * The generated document is explicitly a NON-FINDINGS procedural completion
 * certification: it certifies that the exact ancillary procedure completed and
 * that a current canonical report is associated, and points the signer to that
 * report for clinical findings. It is NOT rendered from report content and
 * makes NO clinical findings claims — nothing is fabricated.
 *
 * Runs ONLY under procedureNoteGeneratorEnabled() (full Procedure Note runtime
 * + FEATURE_PROCEDURE_NOTE_GENERATOR). Never a second note table. Concurrency-
 * safe: claims exactly one pending note (id + clinic + case + pending +
 * not-superseded) via `.returning()`; a second worker never produces a
 * duplicate. Uses only EXACT tenant/case/service/current/non-superseded report
 * + procedure evidence resolved through internal repositories (never the unsafe
 * clinic-facing download route, never bytes); if the exact report source cannot
 * be resolved, it fails with `report_content_unavailable` (never a generic
 * success). Never uses retry time as clinical time. Never auto-signs. No
 * document body appears in logs or retry rows. A failure records/preserves an
 * exact generate_procedure_note retry.
 */

import { db } from "../../db";
import { and, eq, isNull } from "drizzle-orm";
import { procedureNotes } from "@shared/schema/generatedNotes";
import { caseDocumentReadiness } from "@shared/schema/documentReadiness";
import { ancillaryDocumentReferences, PROCEDURE_NOTE_SOURCE_TABLE, REPORT_SOURCE_TABLE } from "@shared/schema/ancillaryDocuments";
import { procedureNoteGeneratorEnabled } from "../../lib/featureFlags";
import { getAncillaryCaseById } from "../../repositories/ancillaryCases.repo";
import { getProcedureEventById } from "../../repositories/procedureEvents.repo";
import { recordAncillaryDocumentFailure, getUnresolvedAncillaryDocumentFailureById } from "../../repositories/ancillaryDocuments.repo";
import { evaluateProcedureNoteEligibility, classifyGeneratorEligibilityDeferral } from "./procedureNoteEligibility";
import { syncProcedureNoteReferenceSignature } from "./procedureNoteService";
// Slice F — canonical component-aware body + exact signed Order Note association.
import { renderProcedureNoteBody } from "./procedureNoteBody";
import { resolveProcedureNoteContext, loadProcedureComponents, procedureServiceLabel } from "./procedureNoteContext";
import { procedureRequiresSignedOrderNote } from "../ancillaryDocuments/orderNoteServiceConfig";
import { serviceKeyForComponents } from "@shared/schema/procedureComponents";

const MIGRATION_MISSING_CODES = new Set(["42P01", "42703", "ANCILLARY_DOCUMENT_MIGRATION_MISSING"]);
const GENERATOR_TEMPLATE_VERSION = "procedure_completion_certification_v1";

export type GenerateProcedureNoteResult = {
  status:
    | "skipped_flag_off" | "note_not_found" | "not_pending" | "already_claimed"
    | "cross_clinic_denied" | "case_not_found" | "not_yet_eligible"
    | "not_yet_eligible_retry_recorded" | "not_yet_eligible_retry_not_recorded"
    | "report_content_unavailable_retry_recorded" | "report_content_unavailable_retry_not_recorded"
    | "generated" | "generated_reference_retry_recorded" | "generated_reference_retry_not_recorded"
    | "failed_retry_recorded" | "failed_retry_not_recorded" | "migration_missing"
    | "failure_not_verified";
  procedureNoteId?: number;
};

type GenInput = { clinicId: number; ancillaryCaseId: number; noteId: number; actorUserId?: string | null };
// The exact-failure retry MUST carry the reconciliation failure it is executing.
type RetryGenInput = GenInput & { failureId: number };
type NoteRow = typeof procedureNotes.$inferSelect;

/** Normal generator — claims ONLY a pending note. */
export async function generateProcedureNote(input: GenInput): Promise<GenerateProcedureNoteResult> {
  if (!procedureNoteGeneratorEnabled()) return { status: "skipped_flag_off" };
  try {
    const [note] = await db.select().from(procedureNotes).where(eq(procedureNotes.id, input.noteId)).limit(1);
    if (!note) return { status: "note_not_found" };
    if (note.clinicId !== input.clinicId || note.ancillaryCaseId !== input.ancillaryCaseId) return { status: "cross_clinic_denied" };
    if (note.noteType !== "post_procedure_note" || note.supersededAt != null) return { status: "not_pending" };
    if (note.signatureStatus === "signed") return { status: "not_pending" };
    if (note.generationStatus !== "pending") return { status: "not_pending" };

    // Two-condition eligibility must hold with EXACT evidence.
    const elig = await evaluateProcedureNoteEligibility({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId });
    if (!elig.eligible) {
      // K5 — the note EXISTS + is pending, but the generator's fresh eligibility read
      // cannot proceed. NOT every deferral warrants a durable generic generate retry:
      // classify WHY first so a missing migration / cross-clinic / missing case /
      // corrupt-or-ambiguous evidence never becomes an endless generic retry.
      const kind = classifyGeneratorEligibilityDeferral(elig);
      if (kind === "migration_missing") return { status: "migration_missing" };   // → 503, zero retry
      if (kind === "cross_clinic") return { status: "cross_clinic_denied" };       // denial, zero retry
      if (kind === "case_missing") return { status: "case_not_found" };            // truthful, zero retry
      if (kind !== "retryable") return { status: "not_yet_eligible" };             // terminal / integrity → reconciliation, no generic retry
      // ONLY a genuinely retryable deferral (report/procedure will arrive later)
      // records ONE durable exact `generate_procedure_note` retry (deduped by
      // clinic+case+source+action). The note stays truthfully `pending` (never
      // generated); a later worker re-runs the exact eligibility/generator path and a
      // later eligible read generates + resolves the exact retry — self-healing without
      // an external re-drive.
      const rec = await recordGenerateRetry(input.clinicId, input.ancillaryCaseId, input.noteId, "generator_not_yet_eligible");
      return { status: rec ? "not_yet_eligible_retry_recorded" : "not_yet_eligible_retry_not_recorded" };
    }

    // Atomically CLAIM the pending note → generating (second worker gets 0 rows).
    const claimed = await claimForGeneration(input, "pending");
    if (claimed !== 1) return { status: "already_claimed" };
    return await finalizeGeneratedBody(input, note);
  } catch (e) {
    return await catchToResult(input, e);
  }
}

/**
 * Exact FAILED-note regeneration (§3/§7). Bound to an EXACT unresolved
 * `generate_procedure_note` reconciliation failure: the caller (only the
 * verified retry-worker boundary) must supply the failure id, whose recorded
 * (action, source_table, source_id, clinic, case) must match this exact note —
 * no route or unrelated service can casually reclaim a failed note. Reclaims
 * ONLY the exact named `failed` note (never first/newest/current-by-case),
 * atomically failed→generating, re-evaluates exact eligibility AFTER the claim,
 * and never overwrites an already-generated body. Reverts generating→failed on
 * ineligibility / migration-missing so a note is NEVER stranded `generating`.
 */
export async function retryFailedProcedureNoteGeneration(input: RetryGenInput): Promise<GenerateProcedureNoteResult> {
  if (!procedureNoteGeneratorEnabled()) return { status: "skipped_flag_off" };
  try {
    // §6 — VERIFY the EXACT unresolved failure before any state change. EVERY
    // dimension must match exactly (no nullable-case exception, documentKind
    // required); the lookup itself enforces id + clinic + resolvedAt IS NULL.
    const failure = await getUnresolvedAncillaryDocumentFailureById({ id: input.failureId, clinicId: input.clinicId });
    if (
      !failure
      || failure.id !== input.failureId
      || failure.clinicId !== input.clinicId
      || failure.ancillaryCaseId !== input.ancillaryCaseId
      || failure.documentKind !== "procedure_note"
      || failure.requestedAction !== "generate_procedure_note"
      || failure.sourceTable !== PROCEDURE_NOTE_SOURCE_TABLE
      || failure.sourceId !== input.noteId
      || failure.resolvedAt != null
    ) {
      return { status: "failure_not_verified" };
    }

    const [note] = await db.select().from(procedureNotes).where(eq(procedureNotes.id, input.noteId)).limit(1);
    if (!note) return { status: "note_not_found" };
    if (note.clinicId !== input.clinicId || note.ancillaryCaseId !== input.ancillaryCaseId) return { status: "cross_clinic_denied" };
    if (note.noteType !== "post_procedure_note" || note.supersededAt != null) return { status: "not_pending" };
    if (note.signatureStatus === "signed") return { status: "not_pending" };
    if (note.generationStatus !== "failed") return { status: "not_pending" };

    // Atomically reclaim the EXACT failed note → generating (one worker wins).
    const claimed = await claimForGeneration(input, "failed");
    if (claimed !== 1) return { status: "already_claimed" };

    // Re-evaluate exact eligibility AFTER the claim; revert on ineligibility.
    const elig = await evaluateProcedureNoteEligibility({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId });
    if (!elig.eligible) {
      await restoreToFailed(input);
      return { status: "not_yet_eligible" };
    }
    return await finalizeGeneratedBody(input, note);
  } catch (e) {
    return await catchToResult(input, e);
  }
}

/** Atomic claim (fromStatus → generating), exact clinic/case/type/current WHERE. */
async function claimForGeneration(input: GenInput, fromStatus: "pending" | "failed"): Promise<number> {
  const rows = await db.update(procedureNotes)
    .set({ generationStatus: "generating", updatedAt: new Date() })
    .where(and(
      eq(procedureNotes.id, input.noteId), eq(procedureNotes.clinicId, input.clinicId),
      eq(procedureNotes.ancillaryCaseId, input.ancillaryCaseId),
      eq(procedureNotes.noteType, "post_procedure_note"),
      eq(procedureNotes.generationStatus, fromStatus),
      isNull(procedureNotes.supersededAt),
    ))
    .returning();
  return rows.length;
}

/** After a successful claim (note is `generating`): resolve exact evidence,
 *  preserve any pre-existing body, commit `generated`, mirror the reference. */
async function finalizeGeneratedBody(input: GenInput, note: NoteRow): Promise<GenerateProcedureNoteResult> {
  const elig = await evaluateProcedureNoteEligibility({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId });
  const acase = await getAncillaryCaseById(input.ancillaryCaseId);
  const pe = elig.qualifyingProcedureEventId != null ? await getProcedureEventById(elig.qualifyingProcedureEventId) : undefined;
  const report = await loadReportEvidence(input.clinicId, input.ancillaryCaseId, elig.qualifyingReportReferenceId ?? null);
  if (!acase || !pe || !report) {
    const recorded = await failNote(input.noteId, input.clinicId, input.ancillaryCaseId, "report_content_unavailable");
    return { status: recorded ? "report_content_unavailable_retry_recorded" : "report_content_unavailable_retry_not_recorded" };
  }
  // Slice F — render the canonical, component-aware Procedure Note body that
  // references the EXACT signed Order Note (no embed) and claims only performed
  // components. FAIL-CLOSED: if any REQUIRED canonical evidence cannot be
  // resolved, DO NOT generate a substitute (no legacy certification fallback).
  // Leave the note `failed` with a truthful code + durable retry so a transient
  // cause self-heals and a permanent one stays visible — never a document that
  // looks successful while required audit evidence is absent. Never uses retry
  // time as the DOS.
  let body: string;
  let associatedOrderNoteId: number | null = null;
  let componentsPresent = false;
  if (typeof note.generatedText === "string" && note.generatedText.length > 0) {
    body = note.generatedText; // preserve a pre-existing generated body (idempotent re-run)
  } else {
    const built = await buildCanonicalProcedureNoteBody(input.clinicId, input.ancillaryCaseId, note, pe);
    if (!built.ok) {
      // Do not mask a canonical generation failure with a certification substitute.
      const recorded = await failNote(input.noteId, input.clinicId, input.ancillaryCaseId, built.code);
      return { status: recorded ? "failed_retry_recorded" : "failed_retry_not_recorded" };
    }
    body = built.text;
    associatedOrderNoteId = built.associatedOrderNoteId;
    componentsPresent = built.componentsPresent;
  }
  const sourceData = {
    document_kind: "procedure_note",
    template: GENERATOR_TEMPLATE_VERSION,
    procedure_event_id: pe.id, procedure_completed_at: pe.completedAt?.toISOString() ?? null,
    report_document_reference_id: report.referenceId, report_source_table: REPORT_SOURCE_TABLE, report_source_id: report.sourceId,
    report_document_status: report.documentStatus,
    ancillary_case_id: input.ancillaryCaseId, service_type: note.serviceType,
    // Slice F — exact signed Order Note association + component-evidence presence.
    associated_order_note_id: associatedOrderNoteId,
    procedure_components_present: componentsPresent,
  };
  const [done] = await db.update(procedureNotes)
    .set({ generationStatus: "generated", generatedText: body, generatedByAi: false, sourceData: sourceData as never, errorMessage: null, updatedAt: new Date() })
    .where(and(eq(procedureNotes.id, input.noteId), eq(procedureNotes.clinicId, input.clinicId), eq(procedureNotes.generationStatus, "generating")))
    .returning();
  if (!done) { const rec = await failNote(input.noteId, input.clinicId, input.ancillaryCaseId, "generation_commit_conflict"); return { status: rec ? "failed_retry_recorded" : "failed_retry_not_recorded" }; }
  // §6 — synchronize the EXACT reference TRUTHFULLY (clinic + case + source +
  // kind, affected-row-checked via `.returning()`). The note stays `generated`
  // regardless; a missing / zero-row / failed projection becomes a DISTINCT
  // exact sync_procedure_note_signature retry rather than a false plain
  // `generated`. An already-pending_signature exact reference is treated as
  // synchronized (idempotent).
  const sync = await syncProcedureNoteReferenceSignature({
    clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, noteId: input.noteId,
    documentStatus: "pending_signature", signedAt: null,
  });
  if (sync.status === "synced") return { status: "generated", procedureNoteId: input.noteId };
  if (sync.status === "no_reference" || sync.status === "sync_failed") {
    return { status: sync.retryRecorded ? "generated_reference_retry_recorded" : "generated_reference_retry_not_recorded", procedureNoteId: input.noteId };
  }
  // migration_missing / cross_clinic_denied / case_mismatch — projection could not
  // complete; record a durable exact reference retry and report truthfully.
  const rec = await recordGeneratedReferenceRetry(input);
  return { status: rec ? "generated_reference_retry_recorded" : "generated_reference_retry_not_recorded", procedureNoteId: input.noteId };
}

/** §5 — restore a claimed note generating→failed with an exact affected-row
 *  WHERE, so a post-claim non-success path never strands it `generating`. */
async function restoreToFailed(input: GenInput): Promise<void> {
  await db.update(procedureNotes).set({ generationStatus: "failed", updatedAt: new Date() })
    .where(and(
      eq(procedureNotes.id, input.noteId), eq(procedureNotes.clinicId, input.clinicId),
      eq(procedureNotes.ancillaryCaseId, input.ancillaryCaseId), eq(procedureNotes.generationStatus, "generating"),
    ));
}

/** §6 — record a DISTINCT exact reference-projection retry when the generated
 *  reference could not be synchronized (kept separate from generation itself). */
async function recordGeneratedReferenceRetry(input: GenInput): Promise<boolean> {
  try {
    await recordAncillaryDocumentFailure({ clinicId: input.clinicId, ancillaryCaseId: input.ancillaryCaseId, documentKind: "procedure_note", sourceTable: PROCEDURE_NOTE_SOURCE_TABLE, sourceId: input.noteId, requestedAction: "sync_procedure_note_signature", sourceSystem: "procedure_note_generator", errorCode: "generated_reference_projection_incomplete" });
    return true;
  } catch { return false; }
}

async function catchToResult(input: GenInput, e: unknown): Promise<GenerateProcedureNoteResult> {
  if (MIGRATION_MISSING_CODES.has((e as { code?: string })?.code ?? "")) {
    // §5 — a migration error AFTER a claim must never leave the note `generating`.
    // Restoring is idempotent (WHERE generationStatus=generating); if the note
    // table itself is missing there is nothing claimed to restore.
    try { await restoreToFailed(input); } catch { /* table missing — nothing claimed */ }
    return { status: "migration_missing" };
  }
  let recorded = false;
  try { recorded = await failNote(input.noteId, input.clinicId, input.ancillaryCaseId, (e as { code?: string })?.code ?? "generation_failed"); } catch { recorded = false; }
  return { status: recorded ? "failed_retry_recorded" : "failed_retry_not_recorded" };
}

/**
 * PHI-free failure stamp (error CODE only, never note body / report content) +
 * a durable exact generate_procedure_note retry (exact clinic + case + source).
 * Returns whether the ledger row was actually persisted — the note stays
 * truthfully `failed` even when persistence fails; durability is never
 * overstated (§2/§7).
 */
/** K5 — record a durable exact `generate_procedure_note` retry WITHOUT changing the
 *  note's generation state (the note stays truthfully pending). Deduped by
 *  clinic+case+source+action. Returns whether the ledger row persisted. */
async function recordGenerateRetry(clinicId: number, ancillaryCaseId: number, noteId: number, code: string): Promise<boolean> {
  try {
    await recordAncillaryDocumentFailure({ clinicId, ancillaryCaseId, documentKind: "procedure_note", sourceTable: PROCEDURE_NOTE_SOURCE_TABLE, sourceId: noteId, requestedAction: "generate_procedure_note", sourceSystem: "procedure_note_generator", errorCode: code });
    return true;
  } catch { return false; }
}

async function failNote(noteId: number, clinicId: number, ancillaryCaseId: number, code: string): Promise<boolean> {
  await db.update(procedureNotes)
    .set({ generationStatus: "failed", errorMessage: code, updatedAt: new Date() })
    .where(and(eq(procedureNotes.id, noteId), eq(procedureNotes.clinicId, clinicId), eq(procedureNotes.generationStatus, "generating")));
  try {
    await recordAncillaryDocumentFailure({ clinicId, ancillaryCaseId, documentKind: "procedure_note", sourceTable: PROCEDURE_NOTE_SOURCE_TABLE, sourceId: noteId, requestedAction: "generate_procedure_note", sourceSystem: "procedure_note_generator", errorCode: code });
    return true;
  } catch { return false; }
}

/** Resolve the exact CURRENT report source through internal repositories only —
 *  a readiness row ALONE is insufficient; the reference must be the exact
 *  tenant/case/report kind, non-superseded, and its readiness source resolvable. */
async function loadReportEvidence(clinicId: number, ancillaryCaseId: number, referenceId: number | null): Promise<{ referenceId: number; sourceId: number; documentStatus: string } | null> {
  if (referenceId == null) return null;
  const [ref] = await db.select().from(ancillaryDocumentReferences).where(and(
    eq(ancillaryDocumentReferences.id, referenceId), eq(ancillaryDocumentReferences.clinicId, clinicId),
    eq(ancillaryDocumentReferences.ancillaryCaseId, ancillaryCaseId), eq(ancillaryDocumentReferences.documentKind, "report"),
    isNull(ancillaryDocumentReferences.supersededAt),
  )).limit(1);
  if (!ref) return null;
  // The canonical readiness source must be resolvable + tenant-consistent + in an
  // acceptable current status (never the clinic-facing download route, never bytes).
  const [src] = await db.select().from(caseDocumentReadiness).where(eq(caseDocumentReadiness.id, ref.sourceId)).limit(1);
  if (!src || (src.clinicId != null && src.clinicId !== clinicId)) return null;
  if (!ACCEPTABLE_REPORT_SOURCE_STATUSES.has(src.documentStatus)) return null;
  return { referenceId: ref.id, sourceId: ref.sourceId, documentStatus: src.documentStatus };
}

const ACCEPTABLE_REPORT_SOURCE_STATUSES = new Set(["uploaded", "generated", "approved", "completed", "signed"]);

/** Slice F — build the canonical component-aware Procedure Note body from EXACT
 *  evidence (patient/clinician, real completed_at, validated components, and the
 *  exact signed Order Note association). FAIL-CLOSED: returns { ok:false, code }
 *  when REQUIRED evidence is unresolved — the caller must NOT generate a
 *  substitute. Never fabricates. Never uses now() as the DOS. */
type CanonicalBodyResult =
  | { ok: true; text: string; associatedOrderNoteId: number | null; componentsPresent: boolean }
  | { ok: false; code: string };

async function buildCanonicalProcedureNoteBody(
  clinicId: number,
  ancillaryCaseId: number,
  note: NoteRow,
  pe: { id: number; completedAt: Date | null },
): Promise<CanonicalBodyResult> {
  // Real completed_at is REQUIRED (never now()).
  if (pe.completedAt == null) return { ok: false, code: "missing_procedure_completed_at" };
  // Exact case + patient/clinician identity (cross-clinic/missing → fail-closed).
  const ctx = await resolveProcedureNoteContext(clinicId, ancillaryCaseId);
  if (!ctx) return { ok: false, code: "procedure_note_context_unresolved" };

  // Config-driven (never service-name inference): whether an exact current
  // SIGNED Order Note is REQUIRED before a Procedure Note may be generated.
  // The signed Order Note is the clinician authorization for the procedure and
  // is required for ALL canonical ordered ancillary services (declared per
  // service in orderNoteServiceConfig.requiredEvidence.signedOrderNoteForProcedure).
  // resolveProcedureNoteContext only populates ctx.associatedOrder when the
  // EXACT current, non-superseded, same-clinic Order Note is SIGNED, so this
  // fails closed on: no signed order, superseded/invalid note, wrong case, or
  // cross-clinic. The rendered body then references that exact signed note id.
  const requiresSignedOrder = procedureRequiresSignedOrderNote(note.serviceType ?? "");
  if (requiresSignedOrder && !ctx.associatedOrder) return { ok: false, code: "missing_signed_order_note" };

  // Validated component evidence is a SEPARATE requirement that applies only to
  // services that HAVE a structured component contract (BrainWave/VitalWave).
  // This is determined by the existence of a component schema for the service
  // (serviceKeyForComponents), not by the signed-order requirement — a vascular
  // service requires a signed order but has no component schema, so it renders
  // its modular body without component evidence.
  const components = await loadProcedureComponents(pe.id, note.serviceType);
  const requiresComponentEvidence = serviceKeyForComponents(note.serviceType ?? "") != null;
  if (requiresComponentEvidence && !components) return { ok: false, code: "invalid_or_missing_component_evidence" };

  const rendered = renderProcedureNoteBody({
    service: note.serviceType,
    serviceLabel: procedureServiceLabel(note.serviceType),
    patient: { name: ctx.patient.name, dob: ctx.patient.dob, plexusId: ctx.patient.plexusId },
    orderingClinician: ctx.clinician,
    dateOfService: pe.completedAt.toISOString(), // real procedure time, never now()
    components,
    procedureStatus: "complete",
    associatedOrder: ctx.associatedOrder,
  });
  return { ok: true, text: rendered.text, associatedOrderNoteId: rendered.associatedOrderNoteId, componentsPresent: !!components };
}
