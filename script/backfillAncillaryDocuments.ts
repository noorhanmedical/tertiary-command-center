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
import { and, eq } from "drizzle-orm";
import { procedureNotes } from "@shared/schema/generatedNotes";
import { caseDocumentReadiness } from "@shared/schema/documentReadiness";
import { patientAncillaryCases } from "@shared/schema/ancillaryCases";
import { featureFlags } from "../server/lib/featureFlags";

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

async function main(): Promise<void> {
  const apply = process.env.BACKFILL_ANCILLARY_DOCUMENTS_APPLY === "YES";
  if (apply && !featureFlags.unifiedAncillaryDocuments) {
    console.error("Refusing to apply: BACKFILL_ANCILLARY_DOCUMENTS_APPLY=YES but FEATURE_UNIFIED_ANCILLARY_DOCUMENTS is not enabled.");
    process.exit(2);
  }

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
    plan.push({ source: "case_document_readiness", sourceId: r.id, documentKind: kind, clinicId: r.clinicId, ancillaryCaseId: res.id, outcome: res.outcome ?? "would_create_reference" });
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
  // Apply-mode orchestration is intentionally NOT implemented for
  // execution in Phase 2E-A. Dry-run is the only supported mode here;
  // the live reference writer + retry service land in Phase 2E-B.
  console.log(JSON.stringify({ summary, plan }, null, 2));
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
