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
import { onProcedureCompleted } from "../server/services/procedureLifecycle/procedureLifecycleOrchestration";

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
    if (outcome === "deterministic_link" && canApply()) {
      try {
        const r = await onProcedureCompleted({ procedureEventId: pe.id, expectedClinicId: pe.clinicId ?? null });
        outcome = (r.status === "created" || r.status === "reused" || r.status === "linked_pending_note" || r.status === "not_yet_eligible") ? "applied" : "apply_deferred";
      } catch { outcome = "apply_error"; }
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

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
