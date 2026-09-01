/**
 * Phase 2G backfill — canonical billing readiness + Billing Document.
 *
 * Contract:
 *   • DRY-RUN by default. Classifies each active, admin-approved ancillary case
 *     and prints a PHI-free plan (ids + outcome codes + counts). ZERO writes.
 *   • Apply requires ALL of:
 *       BACKFILL_CANONICAL_BILLING_APPLY=YES
 *       + billingReadinessRuntimeEnabled() (every upstream canonical flag + the
 *         canonical billing-readiness flag).
 *   • Apply evaluates readiness from EXACT evidence (the evaluator supersedes the
 *     prior snapshot), creates pending Billing Document work when ready, and
 *     QUEUES exact generation/reference retries. It NEVER generates a packet body
 *     and never fabricates evidence. Idempotent. Never modifies clinics. Never
 *     deletes data. Ambiguous / multiple-candidate identities are NEVER guessed.
 */

import { db } from "../server/db";
import { and, eq, isNull, inArray, desc } from "drizzle-orm";
import { patientAncillaryCases, ANCILLARY_ACTIVE_LIFECYCLE_STATUSES } from "@shared/schema/ancillaryCases";
import { procedureEvents } from "@shared/schema/procedureEvents";
import { ancillaryDocumentReferences, BILLING_DOCUMENT_SOURCE_TABLE } from "@shared/schema/ancillaryDocuments";
import { canonicalBillingReadinessChecks as billingReadinessChecks } from "@shared/schema/billingReadiness";
import { canonicalBillingDocumentRequests as billingDocumentRequests } from "@shared/schema/billingDocuments";
import { procedureNotes } from "@shared/schema/generatedNotes";
import { billingReadinessRuntimeEnabled } from "../server/lib/featureFlags";
import { recordAncillaryDocumentFailure } from "../server/repositories/ancillaryDocuments.repo";
import { evaluateCanonicalBillingReadiness } from "../server/services/billingLifecycle/billingReadinessEvaluator";
import { createOrAdoptCanonicalBillingDocument } from "../server/services/billingLifecycle/billingDocumentGenerator";

const APPLY = process.env.BACKFILL_CANONICAL_BILLING_APPLY === "YES";
const LIMIT = Math.min(Math.max(1, parseInt(process.env.BACKFILL_CANONICAL_BILLING_LIMIT ?? "200", 10) || 200), 1000);
const ACTIVE = new Set<string>(ANCILLARY_ACTIVE_LIFECYCLE_STATUSES as unknown as string[]);
const ACCEPTABLE_REPORT = new Set(["uploaded", "generated", "approved", "completed", "signed"]);
const TERMINAL_INVALID = new Set(["cancelled", "no_show", "unable_to_complete"]);

export type Outcome =
  | "already_canonical" | "deterministic_case_link" | "no_candidate_case" | "multiple_candidate_cases"
  | "cross_clinic_conflict" | "service_mismatch" | "repeated_episode_ambiguity"
  | "exact_procedure_available" | "exact_procedure_missing"
  | "exact_report_available" | "exact_report_missing"
  | "exact_order_note_available" | "exact_order_note_missing"
  | "order_note_signature_ready" | "order_note_signature_blocked" | "order_note_signature_unresolved"
  | "exact_procedure_note_available" | "exact_procedure_note_missing"
  | "procedure_note_signed" | "procedure_note_unsigned"
  | "billing_blocked" | "claim_blocked_only" | "readiness_candidate"
  | "existing_current_readiness" | "stale_readiness"
  | "billing_document_candidate" | "existing_current_billing_document" | "billing_document_reference_missing"
  | "migration_missing" | "applied" | "apply_deferred" | "apply_error";

export function canApply(): boolean {
  return APPLY && billingReadinessRuntimeEnabled();
}

async function currentRef(clinicId: number, caseId: number, kind: string) {
  const rows = await db.select().from(ancillaryDocumentReferences).where(and(
    eq(ancillaryDocumentReferences.clinicId, clinicId), eq(ancillaryDocumentReferences.ancillaryCaseId, caseId),
    eq(ancillaryDocumentReferences.documentKind, kind), isNull(ancillaryDocumentReferences.supersededAt),
  )).orderBy(desc(ancillaryDocumentReferences.actualCreatedAt)).limit(1);
  return rows[0] ?? null;
}

/** Read-only classification for one ancillary case (never writes). */
export async function classify(acase: typeof patientAncillaryCases.$inferSelect): Promise<Outcome[]> {
  const out: Outcome[] = [];
  try {
    if (acase.clinicId == null) { out.push("no_candidate_case"); return out; }
    if (!ACTIVE.has(acase.lifecycleStatus)) { out.push("no_candidate_case"); return out; }
    if (acase.adminReviewStatus !== "approved") { out.push("billing_blocked"); return out; }
    out.push("already_canonical", "deterministic_case_link");
    const clinicId = acase.clinicId; const service = acase.serviceType;

    // Procedure evidence.
    const peRows = await db.select().from(procedureEvents).where(and(
      eq(procedureEvents.ancillaryCaseId, acase.id), eq(procedureEvents.clinicId, clinicId),
    )).orderBy(desc(procedureEvents.completedAt));
    const svc = peRows.filter((r) => r.serviceType === service);
    const completed = svc.filter((r) => r.procedureStatus === "complete" && r.completedAt != null);
    const terminalInvalid = svc.find((r) => r.procedureStatus != null && TERMINAL_INVALID.has(r.procedureStatus));
    if (completed.length > 1) { out.push("repeated_episode_ambiguity"); }
    out.push(completed.length >= 1 ? "exact_procedure_available" : "exact_procedure_missing");
    if (terminalInvalid && completed.length === 0) out.push("billing_blocked");

    // Report / Order Note / Procedure Note evidence.
    const report = await currentRef(clinicId, acase.id, "report");
    out.push(report != null && report.serviceType === service && ACCEPTABLE_REPORT.has(report.documentStatus) ? "exact_report_available" : "exact_report_missing");
    const orderNote = await currentRef(clinicId, acase.id, "order_note");
    out.push(orderNote != null ? "exact_order_note_available" : "exact_order_note_missing");
    if (orderNote) out.push(orderNote.documentStatus === "signed" ? "order_note_signature_ready" : "order_note_signature_unresolved");
    const pnRef = await currentRef(clinicId, acase.id, "procedure_note");
    out.push(pnRef != null ? "exact_procedure_note_available" : "exact_procedure_note_missing");
    if (pnRef) {
      const [note] = await db.select().from(procedureNotes).where(eq(procedureNotes.id, pnRef.sourceId)).limit(1);
      out.push(note && note.signatureStatus === "signed" && pnRef.documentStatus === "signed" ? "procedure_note_signed" : "procedure_note_unsigned");
    }

    // Existing canonical readiness + document.
    const [readiness] = await db.select().from(billingReadinessChecks).where(and(
      eq(billingReadinessChecks.clinicId, clinicId), eq(billingReadinessChecks.ancillaryCaseId, acase.id), isNull(billingReadinessChecks.supersededAt),
    )).limit(1);
    if (readiness?.canonicalStatus) out.push("existing_current_readiness"); else out.push("readiness_candidate");
    const [doc] = await db.select().from(billingDocumentRequests).where(and(
      eq(billingDocumentRequests.clinicId, clinicId), eq(billingDocumentRequests.ancillaryCaseId, acase.id), isNull(billingDocumentRequests.supersededAt),
    )).limit(1);
    if (doc?.canonicalStatus && ["pending", "generating", "generated", "approved"].includes(doc.canonicalStatus)) {
      out.push("existing_current_billing_document");
      const bref = await currentRef(clinicId, acase.id, "billing_document");
      if (!bref) out.push("billing_document_reference_missing");
    } else if (out.includes("exact_report_available") && out.includes("procedure_note_signed") && out.includes("exact_procedure_available")) {
      out.push("billing_document_candidate");
    }
    return out;
  } catch (e) {
    if (["42P01", "42703"].includes((e as { code?: string })?.code ?? "")) return ["migration_missing"];
    throw e;
  }
}

export type ApplyActionStatus = "completed" | "queued" | "unresolved" | "persistence_not_recorded" | "conflict";
export type QueueApplyResult = { overall: "applied" | "apply_deferred" | "apply_error"; actions: Record<string, ApplyActionStatus> };

/** APPLY-mode work for one case: evaluate readiness from EXACT evidence, create
 *  pending Billing Document work when ready, and QUEUE exact generation. NEVER
 *  generates a body. Idempotent (retry dedupe + evaluator supersession). */
export async function queueApplyWork(acase: typeof patientAncillaryCases.$inferSelect): Promise<QueueApplyResult> {
  const actions: Record<string, ApplyActionStatus> = {};
  const clinicId = acase.clinicId!;
  try {
    const evalResult = await evaluateCanonicalBillingReadiness({ clinicId, ancillaryCaseId: acase.id, source: "billing_backfill" });
    if (evalResult.status === "migration_missing") return { overall: "apply_error", actions };
    actions.readiness = evalResult.status === "ready_to_generate" || evalResult.status === "missing_requirements" ? "completed" : "unresolved";
    if (evalResult.status === "ready_to_generate") {
      const created = await createOrAdoptCanonicalBillingDocument({ clinicId, ancillaryCaseId: acase.id, source: "billing_backfill" });
      if (created.status === "created" || created.status === "reused") {
        actions.document = "completed";
        // Queue exact generation against the non-null document id — never a body here.
        try { await recordAncillaryDocumentFailure({ clinicId, ancillaryCaseId: acase.id, documentKind: "billing_document", sourceTable: BILLING_DOCUMENT_SOURCE_TABLE, sourceId: created.billingDocumentId!, requestedAction: "generate_billing_document", sourceSystem: "billing_backfill", errorCode: "backfill_billing_document_candidate" }); actions.generation = "queued"; }
        catch { actions.generation = "persistence_not_recorded"; }
      } else {
        actions.document = "unresolved";
      }
    }
    const vals = Object.values(actions);
    const overall = vals.some((v) => v === "unresolved" || v === "persistence_not_recorded" || v === "conflict") ? "apply_deferred" : "applied";
    return { overall, actions };
  } catch { return { overall: "apply_error", actions }; }
}

async function main(): Promise<void> {
  const rows = await db.select().from(patientAncillaryCases)
    .where(and(inArray(patientAncillaryCases.lifecycleStatus, ["new", "active", "on_hold"] as never)))
    .limit(LIMIT);
  const counts: Record<string, number> = {};
  const bump = (o: string) => { counts[o] = (counts[o] ?? 0) + 1; };
  for (const acase of rows) {
    const outcomes = await classify(acase);
    let outcome: string = outcomes[0] ?? "no_candidate_case";
    for (const o of outcomes.slice(1)) bump(o);
    if (canApply() && outcomes.includes("readiness_candidate") || (canApply() && outcomes.includes("billing_document_candidate"))) {
      const applied = await queueApplyWork(acase);
      outcome = applied.overall;
    }
    bump(outcome);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ancillary_case_id: acase.id, clinic_id: acase.clinicId, outcome }));
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ mode: canApply() ? "APPLY" : "DRY_RUN", scanned: rows.length, limit: LIMIT, counts }));
  if (!canApply() && APPLY) {
    // eslint-disable-next-line no-console
    console.error("Refusing to apply: every upstream canonical flag + FEATURE_CANONICAL_BILLING_READINESS must be ON.");
  }
}

const invokedDirectly = (process.argv[1] ?? "").endsWith("backfillCanonicalBillingReadiness.ts");
if (invokedDirectly) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
