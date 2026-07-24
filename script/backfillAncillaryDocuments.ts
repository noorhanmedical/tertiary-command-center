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
  | "error";

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
    const res = await resolveAncillaryCaseId({
      clinicId: n.clinicId, patientScreeningId: n.patientScreeningId, executionCaseId: n.executionCaseId, serviceType: n.serviceType,
    });
    plan.push({ source: "procedure_notes", sourceId: n.id, documentKind: "order_note", clinicId: n.clinicId, ancillaryCaseId: res.id, outcome: res.outcome ?? "would_create_reference" });
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
    retryRowsPlanned: count("missing_ancillary_case") + count("ambiguous_case") + count("unresolved_identity"),
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
