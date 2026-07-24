/**
 * Phase 2E backfill — unified ancillary document references.
 *
 * Contract:
 *   • DRY-RUN by default. Prints the plan; makes zero writes.
 *   • Apply requires BOTH:
 *       BACKFILL_ANCILLARY_DOCUMENTS_APPLY=YES
 *       FEATURE_UNIFIED_ANCILLARY_DOCUMENTS=true
 *   • Never copies document bytes / note text — only indexes canonical
 *     (source_table, source_id).
 *   • Never reinterprets doctor_visit as a document.
 *   • Never attaches across clinics. Never modifies clinics.
 *   • Ambiguous / missing links → retry plan, never fabricated links.
 *   • PHI-free output (ids + outcome codes + counts only).
 *
 * Sources:
 *   • procedure_notes (note_type='order_note')  → order_note references
 *   • case_document_readiness (report / informed_consent / screening_form)
 *       → report / consent / screening_form references
 *   • post_procedure_note rows are DEFERRED to Phase 2F.
 *   • billing_document rows are DEFERRED to Phase 2G.
 */

import { db } from "../server/db";
import { and, eq, isNull } from "drizzle-orm";
import { procedureNotes } from "@shared/schema/generatedNotes";
import { caseDocumentReadiness } from "@shared/schema/documentReadiness";
import { patientAncillaryCases } from "@shared/schema/ancillaryCases";
import { featureFlags } from "../server/lib/featureFlags";
import {
  createReference,
  recordAncillaryDocumentFailure,
} from "../server/repositories/ancillaryDocuments.repo";
import {
  ORDER_NOTE_SOURCE_TABLE,
  type AncillaryDocumentKind,
  type AncillaryDocumentFailureAction,
} from "@shared/schema/ancillaryDocuments";

// Retry actions per kind — deterministic-only backfill queues ambiguity.
const RETRY_ACTION_BY_KIND: Record<string, AncillaryDocumentFailureAction> = {
  order_note: "link_order_note",
  report: "link_report",
  consent: "link_consent",
  screening_form: "link_screening_form",
};
const RETRYABLE_OUTCOMES = new Set<PlanOutcome>([
  "missing_ancillary_case", "ambiguous_case", "unresolved_identity",
  "multiple_candidate_cases", "no_candidate_case", "service_mismatch",
]);

type ApplyCounts = {
  referencesCreated: number;
  referencesReused: number;
  orderNoteCaseLinksWritten: number;
  retriesRecorded: number;
  orderNoteSkippedFlagOff: number;
  applyErrors: number;
};

type PlanOutcome =
  | "would_create_reference"
  | "already_present"
  | "duplicate_source_reference"
  | "missing_ancillary_case"
  | "service_mismatch"
  | "tenant_mismatch"
  | "unresolved_identity"
  | "ambiguous_case"
  | "deferred_procedure_note_2f"
  | "deferred_billing_document_2g"
  | "unsupported_kind"
  | "error"
  // Phase 2E-A2 — canonical order_note case-association outcomes.
  | "deterministic_case_link"
  | "already_case_linked"
  | "multiple_candidate_cases"
  | "no_candidate_case"
  | "legacy_note_superseded"
  | "retry_planned";

type PlanRow = {
  source: "procedure_notes" | "case_document_readiness";
  sourceId: number;
  documentKind: string | null;
  clinicId: number | null;
  ancillaryCaseId?: number;
  outcome: PlanOutcome;
};

const DOC_TYPE_TO_KIND: Record<string, "report" | "consent" | "screening_form" | "order_note" | "__2f__" | "__2g__" | undefined> = {
  report: "report",
  informed_consent: "consent",
  screening_form: "screening_form",
  order_note: "order_note",
  post_procedure_note: "__2f__",
  billing_document: "__2g__",
};

async function resolveAncillaryCaseId(args: {
  clinicId: number | null;
  patientScreeningId: number | null;
  executionCaseId: number | null;
  serviceType: string;
}): Promise<{ id?: number; outcome?: PlanOutcome }> {
  if (args.clinicId == null) return { outcome: "tenant_mismatch" };
  const conds = [
    eq(patientAncillaryCases.clinicId, args.clinicId),
    eq(patientAncillaryCases.serviceType, args.serviceType),
  ];
  if (args.patientScreeningId != null) {
    conds.push(eq(patientAncillaryCases.originatingScreeningId, args.patientScreeningId));
  } else if (args.executionCaseId != null) {
    conds.push(eq(patientAncillaryCases.executionCaseId, args.executionCaseId));
  } else {
    return { outcome: "unresolved_identity" };
  }
  const rows = await db.select({ id: patientAncillaryCases.id }).from(patientAncillaryCases).where(and(...conds)).limit(2);
  if (rows.length === 0) return { outcome: "missing_ancillary_case" };
  if (rows.length > 1) return { outcome: "ambiguous_case" };
  return { id: rows[0].id };
}

/**
 * Phase 2E-A2 — deterministically associate a LEGACY order_note row with
 * exactly one ancillary case. Never picks the first/newest when multiple
 * candidates exist; ambiguity becomes a PHI-free retry plan.
 */
async function resolveLegacyOrderNoteCase(n: {
  clinicId: number | null;
  patientScreeningId: number | null;
  executionCaseId: number | null;
  serviceType: string;
  ancillaryCaseId: number | null;
  supersededAt: Date | null;
}): Promise<{ id?: number; outcome: PlanOutcome }> {
  if (n.supersededAt != null) return { outcome: "legacy_note_superseded" };
  if (n.ancillaryCaseId != null) return { id: n.ancillaryCaseId, outcome: "already_case_linked" };
  if (n.clinicId == null) return { outcome: "tenant_mismatch" };
  if (n.patientScreeningId == null && n.executionCaseId == null) return { outcome: "no_candidate_case" };

  // All ancillary cases for this clinic + patient identity, ANY service.
  const idConds = [eq(patientAncillaryCases.clinicId, n.clinicId)];
  if (n.patientScreeningId != null) {
    idConds.push(eq(patientAncillaryCases.originatingScreeningId, n.patientScreeningId));
  } else if (n.executionCaseId != null) {
    idConds.push(eq(patientAncillaryCases.executionCaseId, n.executionCaseId));
  }
  const candidates = await db
    .select({ id: patientAncillaryCases.id, serviceType: patientAncillaryCases.serviceType })
    .from(patientAncillaryCases)
    .where(and(...idConds))
    .limit(10);
  if (candidates.length === 0) return { outcome: "no_candidate_case" };

  const sameService = candidates.filter((c) => c.serviceType === n.serviceType);
  if (sameService.length === 1) return { id: sameService[0].id, outcome: "deterministic_case_link" };
  if (sameService.length > 1) return { outcome: "multiple_candidate_cases" };
  // Cases exist for this patient identity but none match the note's service.
  return { outcome: "service_mismatch" };
}

/** Idempotent: index a reference for a resolved readiness row. */
async function applyReadinessReference(
  r: typeof caseDocumentReadiness.$inferSelect,
  kind: "report" | "consent" | "screening_form",
  ancillaryCaseId: number,
  applied: ApplyCounts,
): Promise<void> {
  try {
    const ref = await createReference({
      clinicId: r.clinicId as number,
      patientScreeningId: r.patientScreeningId ?? null,
      executionCaseId: r.executionCaseId ?? null,
      ancillaryCaseId,
      documentKind: kind as AncillaryDocumentKind,
      sourceSystem: "backfill_2e",
      sourceTable: "case_document_readiness",
      sourceId: r.id,
      serviceType: r.serviceType,
      documentStatus: r.documentStatus,
      effectiveClinicalDate: null,
      signedAt: null,
      createdByUserId: null,
      metadata: { document_kind: kind, download_reference: r.documentId != null ? `documents:${r.documentId}` : null },
    });
    if (ref.created) applied.referencesCreated++; else applied.referencesReused++;
  } catch { applied.applyErrors++; }
}

/**
 * Idempotent: link a legacy order_note to its single owning case (only when
 * ancillary_case_id is NULL — preserving already-linked rows), then index the
 * order_note reference. Order Note work additionally requires
 * FEATURE_CANONICAL_ORDER_NOTE; otherwise it is skipped (never guessed).
 * Never mutates the note body, signature, signedAt, or signer.
 */
async function applyOrderNoteBackfill(
  n: typeof procedureNotes.$inferSelect,
  ancillaryCaseId: number,
  linkCaseFk: boolean,
  applied: ApplyCounts,
): Promise<void> {
  if (!featureFlags.canonicalOrderNote) { applied.orderNoteSkippedFlagOff++; return; }
  try {
    if (linkCaseFk) {
      const linked = await db
        .update(procedureNotes)
        .set({ ancillaryCaseId, updatedAt: new Date() })
        .where(and(eq(procedureNotes.id, n.id), isNull(procedureNotes.ancillaryCaseId)))
        .returning();
      if (linked.length > 0) applied.orderNoteCaseLinksWritten++;
    }
    const ref = await createReference({
      clinicId: n.clinicId as number,
      patientScreeningId: n.patientScreeningId ?? null,
      executionCaseId: n.executionCaseId ?? null,
      ancillaryCaseId,
      documentKind: "order_note",
      sourceSystem: "backfill_2e",
      sourceTable: ORDER_NOTE_SOURCE_TABLE,
      sourceId: n.id,
      serviceType: n.serviceType,
      documentStatus: n.signatureStatus === "signed" ? "signed" : "pending_signature",
      effectiveClinicalDate: n.effectiveClinicalDate ?? null,
      signedAt: n.signedAt ?? null,
      createdByUserId: null,
      metadata: { document_kind: "order_note" },
    });
    if (ref.created) applied.referencesCreated++; else applied.referencesReused++;
  } catch { applied.applyErrors++; }
}

/** Idempotent-ish: queue a durable retry for an ambiguous/unresolved link. */
async function applyRetry(
  args: { clinicId: number | null; ancillaryCaseId?: number; kind: string; sourceTable: string; sourceId: number; patientScreeningId?: number | null; executionCaseId?: number | null; },
  applied: ApplyCounts,
): Promise<void> {
  const action = RETRY_ACTION_BY_KIND[args.kind];
  if (args.clinicId == null || !action) return;
  try {
    await recordAncillaryDocumentFailure({
      clinicId: args.clinicId,
      ancillaryCaseId: args.ancillaryCaseId ?? null,
      patientScreeningId: args.patientScreeningId ?? null,
      executionCaseId: args.executionCaseId ?? null,
      documentKind: args.kind,
      sourceTable: args.sourceTable,
      sourceId: args.sourceId,
      requestedAction: action,
      sourceSystem: "backfill_2e",
      errorCode: "backfill_deferred",
    });
    applied.retriesRecorded++;
  } catch { applied.applyErrors++; }
}

async function main(): Promise<void> {
  const apply = process.env.BACKFILL_ANCILLARY_DOCUMENTS_APPLY === "YES";
  if (apply && !featureFlags.unifiedAncillaryDocuments) {
    console.error("Refusing to apply: BACKFILL_ANCILLARY_DOCUMENTS_APPLY=YES but FEATURE_UNIFIED_ANCILLARY_DOCUMENTS is not enabled.");
    process.exit(2);
  }

  const applied: ApplyCounts = { referencesCreated: 0, referencesReused: 0, orderNoteCaseLinksWritten: 0, retriesRecorded: 0, orderNoteSkippedFlagOff: 0, applyErrors: 0 };
  const plan: PlanRow[] = [];

  // Section 1 — Order Notes (procedure_notes, note_type='order_note').
  const orderNotes = await db
    .select()
    .from(procedureNotes)
    .where(eq(procedureNotes.noteType, "order_note"))
    .limit(1000);
  for (const n of orderNotes) {
    // Phase 2E-A2: canonical Order Notes are ancillary-case-scoped. Attempt
    // a DETERMINISTIC single-candidate case association; ambiguity never
    // auto-attaches — it is queued for retry.
    const res = await resolveLegacyOrderNoteCase({
      clinicId: n.clinicId, patientScreeningId: n.patientScreeningId, executionCaseId: n.executionCaseId,
      serviceType: n.serviceType, ancillaryCaseId: n.ancillaryCaseId, supersededAt: n.supersededAt,
    });
    plan.push({ source: "procedure_notes", sourceId: n.id, documentKind: "order_note", clinicId: n.clinicId, ancillaryCaseId: res.id, outcome: res.outcome });
    if (apply) {
      if ((res.outcome === "deterministic_case_link" || res.outcome === "already_case_linked") && res.id != null) {
        await applyOrderNoteBackfill(n, res.id, res.outcome === "deterministic_case_link", applied);
      } else if (RETRYABLE_OUTCOMES.has(res.outcome)) {
        await applyRetry({ clinicId: n.clinicId, kind: "order_note", sourceTable: ORDER_NOTE_SOURCE_TABLE, sourceId: n.id, patientScreeningId: n.patientScreeningId, executionCaseId: n.executionCaseId }, applied);
      }
    }
  }
  // post_procedure_note rows are deferred to Phase 2F.
  const procNotes = await db.select({ id: procedureNotes.id, clinicId: procedureNotes.clinicId }).from(procedureNotes).where(eq(procedureNotes.noteType, "post_procedure_note")).limit(1000);
  for (const n of procNotes) plan.push({ source: "procedure_notes", sourceId: n.id, documentKind: "post_procedure_note", clinicId: n.clinicId, outcome: "deferred_procedure_note_2f" });

  // Section 2 — report / consent / screening_form from readiness rows
  // that reference an actual source document (documentId present).
  const readinessRows = await db.select().from(caseDocumentReadiness).limit(2000);
  for (const r of readinessRows) {
    const kind = DOC_TYPE_TO_KIND[r.documentType];
    if (kind === "__2f__") { plan.push({ source: "case_document_readiness", sourceId: r.id, documentKind: r.documentType, clinicId: r.clinicId, outcome: "deferred_procedure_note_2f" }); continue; }
    if (kind === "__2g__") { plan.push({ source: "case_document_readiness", sourceId: r.id, documentKind: r.documentType, clinicId: r.clinicId, outcome: "deferred_billing_document_2g" }); continue; }
    if (kind === "order_note") continue; // covered via procedure_notes
    if (!kind) { plan.push({ source: "case_document_readiness", sourceId: r.id, documentKind: r.documentType, clinicId: r.clinicId, outcome: "unsupported_kind" }); continue; }
    if (r.documentId == null) continue; // no canonical source document yet
    const res = await resolveAncillaryCaseId({
      clinicId: r.clinicId, patientScreeningId: r.patientScreeningId, executionCaseId: r.executionCaseId, serviceType: r.serviceType,
    });
    const outcome = res.outcome ?? "would_create_reference";
    plan.push({ source: "case_document_readiness", sourceId: r.id, documentKind: kind, clinicId: r.clinicId, ancillaryCaseId: res.id, outcome });
    if (apply) {
      if (outcome === "would_create_reference" && res.id != null) {
        await applyReadinessReference(r, kind, res.id, applied);
      } else if (RETRYABLE_OUTCOMES.has(outcome)) {
        await applyRetry({ clinicId: r.clinicId, kind, sourceTable: "case_document_readiness", sourceId: r.id, patientScreeningId: r.patientScreeningId, executionCaseId: r.executionCaseId }, applied);
      }
    }
  }

  const count = (o: PlanOutcome) => plan.filter((p) => p.outcome === o).length;
  const summary = {
    mode: apply ? "APPLIED" : "DRY_RUN",
    sourceRecordsScanned: plan.length,
    orderNotesScanned: orderNotes.length,
    readinessRowsScanned: readinessRows.length,
    referencesPlanned: count("would_create_reference"),
    referencesAlreadyPresent: count("already_present"),
    duplicateSourceReferences: count("duplicate_source_reference"),
    missingAncillaryCase: count("missing_ancillary_case"),
    serviceMismatch: count("service_mismatch"),
    tenantMismatch: count("tenant_mismatch"),
    unresolvedIdentity: count("unresolved_identity"),
    ambiguousCase: count("ambiguous_case"),
    // Phase 2E-A2 — canonical order_note case-association outcomes.
    orderNoteDeterministicCaseLinks: count("deterministic_case_link"),
    orderNoteAlreadyCaseLinked: count("already_case_linked"),
    orderNoteMultipleCandidateCases: count("multiple_candidate_cases"),
    orderNoteNoCandidateCase: count("no_candidate_case"),
    orderNoteLegacySuperseded: count("legacy_note_superseded"),
    retryRowsPlanned:
      count("missing_ancillary_case") + count("ambiguous_case") + count("unresolved_identity")
      + count("multiple_candidate_cases") + count("no_candidate_case") + count("service_mismatch"),
    unsupportedFutureKinds: count("unsupported_kind"),
    procedureNoteRowsDeferredTo2F: count("deferred_procedure_note_2f"),
    billingDocumentRowsDeferredTo2G: count("deferred_billing_document_2g"),
    errors: count("error"),
  };
  // Phase 2E-B — apply-mode orchestration. Deterministic links only; ambiguous
  // rows become durable retries; createReference is idempotent by source and
  // the order_note case-FK link only writes when currently NULL, so reruns are
  // safe. No file bytes copied, no clinic modified, no note generation. This
  // block runs ONLY under the BACKFILL_ANCILLARY_DOCUMENTS_APPLY=YES +
  // FEATURE_UNIFIED_ANCILLARY_DOCUMENTS gate (order_note also needs
  // FEATURE_CANONICAL_ORDER_NOTE). It is NOT executed in this phase.
  console.log(JSON.stringify({ summary, applied: apply ? applied : null, plan }, null, 2));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(JSON.stringify({
      level: "error", source: "ancillary_documents_backfill",
      code: (err as { code?: string })?.code, message: (err as Error)?.message ?? String(err),
    }));
    process.exit(1);
  },
);
