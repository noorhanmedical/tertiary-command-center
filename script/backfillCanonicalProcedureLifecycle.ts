/**
 * Phase 2F backfill — canonical procedure lifecycle + Procedure Note.
 *
 * Contract:
 *   • DRY-RUN by default. Classifies every completed procedure event and prints
 *     a PHI-free plan (ids + outcome codes + counts). Makes ZERO writes.
 *   • Apply requires ALL of:
 *       BACKFILL_CANONICAL_PROCEDURE_LIFECYCLE_APPLY=YES
 *       FEATURE_CANONICAL_PROCEDURE_LIFECYCLE=true
 *       FEATURE_CANONICAL_PROCEDURE_NOTE=true
 *       FEATURE_UNIFIED_ANCILLARY_DOCUMENTS=true
 *   • Apply links ONLY deterministic event→case identities (via the canonical
 *     onProcedureCompleted boundary), which preserves the original
 *     completedAt/createdAt, preserves signed bodies/signatures, NEVER generates
 *     bodies, and queues exact generation/reconciliation work.
 *   • Never modifies clinics. Never deletes data. Idempotent.
 *   • Ambiguous / multiple-candidate identities are NEVER first/newest guessed.
 */

import { db } from "../server/db";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { procedureEvents, PROCEDURE_TERMINAL_STATUSES } from "@shared/schema/procedureEvents";
import { procedureNotes } from "@shared/schema/generatedNotes";
import { ancillaryDocumentReferences, PROCEDURE_NOTE_SOURCE_TABLE } from "@shared/schema/ancillaryDocuments";
import { patientAncillaryCases, ANCILLARY_ACTIVE_LIFECYCLE_STATUSES } from "@shared/schema/ancillaryCases";
import { featureFlags } from "../server/lib/featureFlags";
import { recordAncillaryDocumentFailure } from "../server/repositories/ancillaryDocuments.repo";
import { onProcedureCompleted, ensureCanonicalProcedureNoteForAncillaryCase } from "../server/services/procedureLifecycle/procedureLifecycleOrchestration";

const APPLY = process.env.BACKFILL_CANONICAL_PROCEDURE_LIFECYCLE_APPLY === "YES";
const LIMIT = Math.min(Math.max(1, parseInt(process.env.BACKFILL_CANONICAL_PROCEDURE_LIFECYCLE_LIMIT ?? "200", 10) || 200), 1000);
const ACTIVE = new Set<string>(ANCILLARY_ACTIVE_LIFECYCLE_STATUSES as unknown as string[]);
const TERMINAL = new Set<string>(PROCEDURE_TERMINAL_STATUSES as unknown as string[]);
const ACCEPTABLE_REPORT = new Set(["uploaded", "generated", "approved", "completed", "signed"]);

// Every dry-run classification the contract requires.
type Outcome =
  | "already_canonical" | "deterministic_link" | "no_candidate_case" | "multiple_candidate_cases"
  | "cross_clinic_conflict" | "service_mismatch" | "no_clinic" | "repeated_same_service_episode_ambiguity"
  | "legacy_procedure_note_adoptable" | "multiple_legacy_notes"
  | "exact_report_evidence_available" | "exact_report_evidence_missing"
  | "procedure_note_reference_create" | "procedure_note_reference_reuse" | "procedure_note_reference_conflict"
  | "note_generation_candidate" | "generated_note_amendment_required" | "signed_evidence_conflict"
  | "voided_or_terminal_with_current_note" | "migration_missing"
  | "applied" | "apply_deferred" | "apply_error";

function canApply(): boolean {
  return APPLY && featureFlags.canonicalProcedureLifecycle && featureFlags.canonicalProcedureNote && featureFlags.unifiedAncillaryDocuments;
}

/** Read-only classification. Returns the primary event→case outcome plus any
 *  applicable secondary note/report classifications (never writes). */
async function classify(pe: typeof procedureEvents.$inferSelect): Promise<Outcome[]> {
  const out: Outcome[] = [];
  try {
    // ── procedure event already canonical (has a case) — probe note/report ──
    if (pe.ancillaryCaseId != null) {
      out.push("already_canonical");
      // Terminal/voided procedure that still has a current note needs reconciliation.
      if (TERMINAL.has(pe.procedureStatus) && pe.procedureStatus !== "complete") {
        const cur = await currentNote(pe.clinicId!, pe.ancillaryCaseId);
        if (cur) out.push("voided_or_terminal_with_current_note");
      } else {
        out.push(...(await classifyNoteAndReport(pe.clinicId, pe.ancillaryCaseId, pe.serviceType)));
      }
      return out;
    }
    if (pe.clinicId == null) { out.push("no_clinic"); return out; }
    let candidates: (typeof patientAncillaryCases.$inferSelect)[] = [];
    if (pe.executionCaseId != null) candidates = await db.select().from(patientAncillaryCases).where(eq(patientAncillaryCases.executionCaseId, pe.executionCaseId));
    else if (pe.patientScreeningId != null) candidates = await db.select().from(patientAncillaryCases).where(eq(patientAncillaryCases.originatingScreeningId, pe.patientScreeningId));
    else { out.push("no_candidate_case"); return out; }
    const sameService = candidates.filter((c) => c.serviceType === pe.serviceType);
    if (sameService.length === 0) { out.push(candidates.length > 0 ? "service_mismatch" : "no_candidate_case"); return out; }
    const sameClinic = sameService.filter((c) => c.clinicId === pe.clinicId);
    if (sameClinic.length === 0) { out.push("cross_clinic_conflict"); return out; }
    const active = sameClinic.filter((c) => ACTIVE.has(c.lifecycleStatus));
    if (active.length === 0) { out.push("no_candidate_case"); return out; }
    if (active.length > 1) { out.push("multiple_candidate_cases", "repeated_same_service_episode_ambiguity"); return out; }
    out.push("deterministic_link");
    // Deterministic link → probe note/report evidence for the resolved case.
    out.push(...(await classifyNoteAndReport(pe.clinicId, active[0].id, pe.serviceType)));
    return out;
  } catch (e) {
    if (["42P01", "42703"].includes((e as { code?: string })?.code ?? "")) return ["migration_missing"];
    throw e;
  }
}

async function currentNote(clinicId: number, caseId: number) {
  const [n] = await db.select().from(procedureNotes).where(and(
    eq(procedureNotes.clinicId, clinicId), eq(procedureNotes.ancillaryCaseId, caseId),
    eq(procedureNotes.noteType, "post_procedure_note"), isNull(procedureNotes.supersededAt),
  )).limit(1);
  return n ?? null;
}

async function classifyNoteAndReport(clinicId: number | null, caseId: number, service: string): Promise<Outcome[]> {
  if (clinicId == null) return [];
  const out: Outcome[] = [];
  // Report evidence (current report reference for the exact case+service).
  const [report] = await db.select().from(ancillaryDocumentReferences).where(and(
    eq(ancillaryDocumentReferences.clinicId, clinicId), eq(ancillaryDocumentReferences.ancillaryCaseId, caseId),
    eq(ancillaryDocumentReferences.documentKind, "report"), isNull(ancillaryDocumentReferences.supersededAt),
  )).limit(1);
  const reportOk = report != null && report.serviceType === service && ACCEPTABLE_REPORT.has(report.documentStatus);
  out.push(reportOk ? "exact_report_evidence_available" : "exact_report_evidence_missing");
  // Current note + its reference.
  const note = await currentNote(clinicId, caseId);
  if (!note) {
    // Legacy unlinked post_procedure_note adoptable?
    const legacy = await db.select().from(procedureNotes).where(and(
      eq(procedureNotes.clinicId, clinicId), eq(procedureNotes.serviceType, service),
      eq(procedureNotes.noteType, "post_procedure_note"), isNull(procedureNotes.ancillaryCaseId), isNull(procedureNotes.supersededAt),
    )).limit(5);
    if (legacy.length > 1) out.push("multiple_legacy_notes");
    else if (legacy.length === 1) out.push("legacy_procedure_note_adoptable");
    else if (reportOk) out.push("note_generation_candidate");
  } else {
    const [ref] = await db.select().from(ancillaryDocumentReferences).where(and(
      eq(ancillaryDocumentReferences.sourceTable, PROCEDURE_NOTE_SOURCE_TABLE), eq(ancillaryDocumentReferences.sourceId, note.id),
      eq(ancillaryDocumentReferences.documentKind, "procedure_note"),
    )).limit(1);
    if (!ref) out.push("procedure_note_reference_create");
    else if (ref.clinicId === clinicId && ref.ancillaryCaseId === caseId) out.push("procedure_note_reference_reuse");
    else out.push("procedure_note_reference_conflict");
    // Stale evidence on a generated/signed note → amendment / signed-conflict.
    const stale = reportOk && report != null && (note.reportDocumentReferenceId ?? null) !== report.id;
    if (stale && note.signatureStatus === "signed") out.push("signed_evidence_conflict");
    else if (stale && (note.generationStatus === "generated" || note.generationStatus === "approved")) out.push("generated_note_amendment_required");
  }
  return out;
}

/** Resolve the exact case + current note ids for apply-mode queueing (read-only). */
export async function resolveApplyContext(pe: typeof procedureEvents.$inferSelect): Promise<{ caseId: number | null; noteId: number | null }> {
  let caseId: number | null = pe.ancillaryCaseId ?? null;
  if (caseId == null && pe.clinicId != null) {
    let candidates: (typeof patientAncillaryCases.$inferSelect)[] = [];
    if (pe.executionCaseId != null) candidates = await db.select().from(patientAncillaryCases).where(eq(patientAncillaryCases.executionCaseId, pe.executionCaseId));
    else if (pe.patientScreeningId != null) candidates = await db.select().from(patientAncillaryCases).where(eq(patientAncillaryCases.originatingScreeningId, pe.patientScreeningId));
    const active = candidates.filter((c) => c.serviceType === pe.serviceType && c.clinicId === pe.clinicId && ACTIVE.has(c.lifecycleStatus));
    if (active.length === 1) caseId = active[0].id;
  }
  const noteId = (caseId != null && pe.clinicId != null) ? (await currentNote(pe.clinicId, caseId))?.id ?? null : null;
  return { caseId, noteId };
}

/**
 * APPLY-mode work for one event's classifications — link only deterministic
 * identities via the canonical hook (preserves completedAt/createdAt/signed
 * bodies, never generates a body) and QUEUE exact source-specific retries for
 * the note/report/lineage/void/signature reconciliation. Idempotent (retry
 * dedupe + idempotent hook). Report-evidence-missing stays unresolved.
 */
export type ApplyActionStatus = "completed" | "queued" | "unresolved" | "persistence_not_recorded" | "conflict";
export type QueueApplyResult = { overall: "applied" | "apply_deferred" | "apply_error"; actions: Record<string, ApplyActionStatus> };

export async function queueApplyWork(
  pe: typeof procedureEvents.$inferSelect,
  outcomes: Outcome[],
  ctx: { caseId: number | null; noteId: number | null },
): Promise<QueueApplyResult> {
  const set = new Set(outcomes);
  const clinicId = pe.clinicId;
  const actions: Record<string, ApplyActionStatus> = {};
  // Queue an exact source-specific retry; report persistence truthfully.
  const queue = async (action: Parameters<typeof recordAncillaryDocumentFailure>[0]["requestedAction"], sourceId: number | null, errorCode: string): Promise<ApplyActionStatus> => {
    try { await recordAncillaryDocumentFailure({ clinicId: clinicId!, ancillaryCaseId: ctx.caseId, documentKind: "procedure_note", sourceTable: PROCEDURE_NOTE_SOURCE_TABLE, sourceId, requestedAction: action, sourceSystem: "procedure_lifecycle_backfill", errorCode }); return "queued"; }
    catch { return "persistence_not_recorded"; }
  };
  try {
    // Deterministic link (+ deterministic legacy-note adoption) via the canonical hook.
    if (set.has("deterministic_link") || set.has("legacy_procedure_note_adoptable")) {
      // suppressGeneration:true — the completion-hook linkage route must NEVER
      // generate a body either (even with the generator flag ON).
      const r = await onProcedureCompleted({ procedureEventId: pe.id, expectedClinicId: pe.clinicId ?? null, suppressGeneration: true });
      actions.link = ["created", "reused", "linked_pending_note"].includes(r.status) ? "completed" : (r.status === "not_yet_eligible" ? "unresolved" : "conflict");
    }
    // For work needing an EXACT note (generation / reference / adoption), ENSURE
    // the canonical pending note exists (create/adopt), then RELOAD its exact id.
    let noteId = ctx.noteId;
    const needsNote = set.has("note_generation_candidate") || set.has("legacy_procedure_note_adoptable") || set.has("procedure_note_reference_create");
    if (needsNote && clinicId != null && ctx.caseId != null && noteId == null) {
      // suppressGeneration:true — the backfill creates/adopts a PENDING note and
      // queues exact generation work; it NEVER generates a body (even if the
      // generator flag is ON). Enforced in code, not operationally.
      const ensure = await ensureCanonicalProcedureNoteForAncillaryCase({ clinicId, ancillaryCaseId: ctx.caseId, source: "procedure_lifecycle_backfill", suppressGeneration: true });
      if (!["created", "reused"].includes(ensure.status)) { actions.ensure_note = "unresolved"; }
      else {
        const n = await currentNote(clinicId, ctx.caseId);
        noteId = n?.id ?? null;
        actions.ensure_note = noteId != null ? "completed" : "unresolved";
      }
    }
    if (clinicId != null) {
      // Generation is QUEUED against a NON-NULL exact note id only — never generated here.
      if (set.has("note_generation_candidate")) actions.generation = noteId != null ? await queue("generate_procedure_note", noteId, "backfill_generation_candidate") : "unresolved";
      if (set.has("procedure_note_reference_create")) actions.reference = noteId != null ? await queue("link_procedure_note", noteId, "backfill_reference_create") : "unresolved";
      // Lineage reconciliation is queued against the EXACT stale current note id
      // (never sourceTable=procedure_notes with sourceId=null).
      if (set.has("generated_note_amendment_required")) actions.amendment = ctx.noteId != null ? await queue("reconcile_procedure_note_lineage", ctx.noteId, "backfill_amendment_required") : "unresolved";
      if (set.has("signed_evidence_conflict")) actions.signed = ctx.noteId != null ? await queue("link_procedure_note_evidence", ctx.noteId, "backfill_signed_evidence_conflict") : "unresolved";
      if (set.has("voided_or_terminal_with_current_note")) actions.void = ctx.noteId != null ? await queue("void_procedure_note", ctx.noteId, "backfill_terminal_void") : "unresolved";
    }
    // §7 — missing exact report evidence is an EXPLICIT unresolved action, so a
    // deterministic link (or any other completed work) can NEVER report the case
    // as fully `applied`. Report evidence is never fabricated; no generation
    // candidate is executed and no generate retry is queued without it (classify
    // only emits note_generation_candidate WHEN report evidence is present).
    if (set.has("exact_report_evidence_missing")) actions.report = "unresolved";
    const vals = Object.values(actions);
    const overall = vals.some((v) => v === "unresolved" || v === "persistence_not_recorded" || v === "conflict") ? "apply_deferred" : "applied";
    return { overall, actions };
  } catch { return { overall: "apply_error", actions }; }
}

async function main(): Promise<void> {
  const rows = await db.select().from(procedureEvents)
    .where(and(inArray(procedureEvents.procedureStatus, ["complete", "cancelled", "no_show", "unable_to_complete"])))
    .limit(LIMIT);
  const counts: Record<string, number> = {};
  const bump = (o: string) => { counts[o] = (counts[o] ?? 0) + 1; };

  for (const pe of rows) {
    const outcomes = await classify(pe);
    let outcome: string = outcomes[0] ?? "no_candidate_case";
    for (const o of outcomes.slice(1)) bump(o);
    if (canApply() && outcomes.some((o) => ["deterministic_link", "legacy_procedure_note_adoptable", "procedure_note_reference_create", "note_generation_candidate", "generated_note_amendment_required", "signed_evidence_conflict", "voided_or_terminal_with_current_note"].includes(o))) {
      const ctx = await resolveApplyContext(pe);
      const applied = await queueApplyWork(pe, outcomes, ctx);
      outcome = applied.overall;
    }
    bump(outcome);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ procedure_event_id: pe.id, clinic_id: pe.clinicId, outcome }));
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ mode: canApply() ? "APPLY" : "DRY_RUN", scanned: rows.length, limit: LIMIT, counts }));
  if (!canApply() && APPLY) {
    // eslint-disable-next-line no-console
    console.error("Refusing to apply: FEATURE_CANONICAL_PROCEDURE_LIFECYCLE / FEATURE_CANONICAL_PROCEDURE_NOTE / FEATURE_UNIFIED_ANCILLARY_DOCUMENTS must all be true.");
  }
}

// Run only when invoked directly (never when imported by a test for
// classify/queueApplyWork behavioral coverage).
const invokedDirectly = (process.argv[1] ?? "").endsWith("backfillCanonicalProcedureLifecycle.ts");
if (invokedDirectly) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
